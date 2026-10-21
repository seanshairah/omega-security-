/**
 * Call-triggered attendance verification, joined to the database.
 *
 * The flow, each step idempotent so a replayed event or a restarted server changes nothing:
 *
 *   1. `ensureExpectation`  — the shift approaches its start; a check-in row is opened (AWAITING).
 *   2. `handleCall`         — a call from the guard's registered phone qualifies; the row moves to
 *                             CALL_RECEIVED and a fresh GPS request goes to that phone (GPS_PENDING).
 *   3. `applyFix`           — the fix comes back; it is classified against the site's geofence, the
 *                             lateness is computed from the capture time, and attendance is written.
 *   4. `escalate`           — nothing acceptable arrived in time; the row becomes MISSED and the
 *                             supervisor is notified once.
 *   5. `decide`             — a supervisor overrides, always recorded as MANUAL, never as GPS.
 *
 * The attendance decision is only ever written here, inside a transaction keyed on the shift, so
 * two events arriving together cannot produce two different answers.
 */
import type { AttendanceCheckIn, CallLog, GatewayDevice, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { getSettings } from "@/lib/settings";
import { classifyFix, type LocationState } from "@/lib/geofence";
import { effectiveGeofence } from "@/lib/site-config";
import { createLocationRequest, LocationRequestError } from "@/lib/gateway/location-requests";
import { recordEvent } from "@/lib/services/shifts";
import { fmtTime } from "@/lib/time";
import {
  autoFixBelongs, autoRequestDue, callQualifies, computeLateness, describeOutcome, escalatedStatus, escalationState, exceptionDue, fixCorrelates, resolveGrace,
  statusForVerifiedFix, trustedTimestamp, VERIFIED_STATUSES, type CallPolicy, type CheckInStatus,
} from "./check-in";
import { getSettingNumber } from "@/lib/settings";

export type CheckInConfig = {
  enabled: boolean;
  graceMinutes: number;
  windowBeforeMinutes: number;
  windowAfterMinutes: number;
  correlationMinutes: number;
  escalationMinutes: number;
  maxGpsAttempts: number;
  authorizedNumbers: string[];
  maxClockSkewMinutes: number;
  accuracyMaxM: number;
  /** Ask the guard's phone for its position at shift start without waiting for a call. */
  autoGps: boolean;
  /** Minutes before the start that a fix already counts, and the first automatic request goes out. */
  autoBeforeMinutes: number;
  /** Whether a verified position is enough, or the company also requires the check-in call. */
  callPolicy: CallPolicy;
};

export async function checkInConfig(): Promise<CheckInConfig> {
  const s = await getSettings();
  const num = (k: string, d: number) => { const n = Number(s[k]); return Number.isFinite(n) ? n : d; };
  const raw = (s["checkin.numbers"] ?? "").trim();
  return {
    enabled: (s["checkin.enabled"] ?? "true") === "true",
    graceMinutes: num("checkin.graceMinutes", 5),
    windowBeforeMinutes: num("checkin.windowBeforeMinutes", 60),
    windowAfterMinutes: num("checkin.windowAfterMinutes", 120),
    correlationMinutes: num("checkin.correlationMinutes", 10),
    escalationMinutes: num("checkin.escalationMinutes", 15),
    maxGpsAttempts: num("checkin.maxGpsAttempts", 3),
    authorizedNumbers: raw ? raw.split(",").map((n) => n.trim()).filter(Boolean) : [],
    maxClockSkewMinutes: num("checkin.maxClockSkewMinutes", 10),
    accuracyMaxM: num("geofence.accuracyMaxM", 100),
    autoGps: (s["checkin.autoGps"] ?? "true") === "true",
    autoBeforeMinutes: num("checkin.autoBeforeMinutes", 10),
    callPolicy: s["checkin.callRequired"] === "true" ? "REQUIRED" : "OPTIONAL",
  };
}

const SHIFT_FOR_CHECKIN = { guard: true, location: true, attendance: true, attendanceCheckIn: true, supervisor: true } satisfies Prisma.ShiftInclude;
type ShiftForCheckIn = Prisma.ShiftGetPayload<{ include: typeof SHIFT_FOR_CHECKIN }>;

/** The grace period that applies to one shift: the shift's own, else its site's, else the company's. */
export function graceFor(shift: { checkInGraceMinutes: number | null; location: { checkInGraceMinutes: number | null } }, cfg: CheckInConfig) {
  return resolveGrace({ company: cfg.graceMinutes, site: shift.location.checkInGraceMinutes, shift: shift.checkInGraceMinutes });
}

/**
 * Open the check-in expectation for a shift. Safe to call repeatedly: the unique shiftId makes a
 * second call a no-op rather than a second attendance decision.
 */
export async function ensureExpectation(shift: ShiftForCheckIn, cfg: CheckInConfig, now = new Date()): Promise<AttendanceCheckIn | null> {
  if (!cfg.enabled) return null;
  if (shift.status === "CANCELLED" || shift.status === "COMPLETED" || shift.status === "MISSED") return null;
  const existing = shift.attendanceCheckIn ?? (await db.attendanceCheckIn.findUnique({ where: { shiftId: shift.id } }));
  if (existing) return existing;
  const device = await db.gatewayDevice.findFirst({ where: { guardId: shift.guardId, mode: "GUARD", activationStatus: "ACTIVE", status: { notIn: ["REVOKED", "DISABLED"] } }, orderBy: { lastSeenAt: "desc" } });
  const grace = graceFor(shift, cfg);
  try {
    return await db.attendanceCheckIn.create({
      data: {
        shiftId: shift.id, guardId: shift.guardId, gatewayDeviceId: device?.id ?? null,
        status: "AWAITING", scheduledStartAt: shift.startAt, graceMinutes: grace.minutes,
        // The policy as it stood when the shift was opened, so changing the setting later does not
        // rewrite what yesterday's shifts were asked to do.
        callRequired: cfg.callPolicy === "REQUIRED",
        // A guard without an Android device can never be GPS-verified; say so from the start.
        source: device ? "NONE" : "SMS_ONLY",
        exceptionReason: device ? null : "No activated Android guard phone: attendance cannot be verified by GPS.",
      },
    });
  } catch {
    void now;
    return db.attendanceCheckIn.findUnique({ where: { shiftId: shift.id } }); // created concurrently
  }
}

/**
 * A call has been recorded. If it qualifies as a check-in for one unambiguous shift, move the row
 * to CALL_RECEIVED and ask the phone for a fresh fix.
 *
 * Returns a short outcome string for the caller's log; never throws into the call pipeline, because
 * a failure here must not lose the call record itself.
 */
export async function handleCall(call: CallLog, device: GatewayDevice, now = new Date()): Promise<string> {
  const cfg = await checkInConfig();
  if (!cfg.enabled) return "check-in disabled";
  if (!call.guardId) return "no guard on the call";
  // Only the guard's own registered phone can report a check-in: caller ID alone is not identity.
  if (device.mode !== "GUARD" || device.guardId !== call.guardId) return "not the guard's registered device";

  const window = { beforeMinutes: cfg.windowBeforeMinutes, afterMinutes: cfg.windowAfterMinutes };
  const earliest = new Date(call.startedAt.getTime() - cfg.windowAfterMinutes * 60_000);
  const latest = new Date(call.startedAt.getTime() + cfg.windowBeforeMinutes * 60_000);
  const shifts = await db.shift.findMany({
    where: { guardId: call.guardId, status: { notIn: ["CANCELLED", "COMPLETED", "MISSED"] }, startAt: { gte: earliest, lte: latest } },
    include: SHIFT_FOR_CHECKIN, orderBy: { startAt: "asc" },
  });
  if (!shifts.length) return "no shift expecting a check-in";

  const open = shifts.filter((s) => {
    const r = callQualifies(
      { startedAt: call.startedAt, direction: call.direction, normalizedPhoneNumber: call.normalizedPhoneNumber, fromGuardDevice: true },
      { id: s.id, startAt: s.startAt, endAt: s.endAt, cancelled: false, alreadyVerified: VERIFIED_STATUSES.includes((s.attendanceCheckIn?.status ?? "AWAITING") as CheckInStatus) },
      window, cfg.authorizedNumbers,
    );
    return r.ok;
  });
  if (!open.length) {
    // Presence may already be verified by GPS. The call is still the check-in call the policy may
    // require, so it is recorded against that shift rather than turned away as a duplicate.
    const verified = shifts.filter((s) => {
      const r = s.attendanceCheckIn;
      if (!r || !(VERIFIED_STATUSES.includes(r.status as CheckInStatus) || r.status === "MANUALLY_APPROVED") || r.callAt) return false;
      return callQualifies(
        { startedAt: call.startedAt, direction: call.direction, normalizedPhoneNumber: call.normalizedPhoneNumber, fromGuardDevice: true },
        { id: s.id, startAt: s.startAt, endAt: s.endAt, cancelled: false, alreadyVerified: false }, window, cfg.authorizedNumbers,
      ).ok;
    });
    if (verified.length === 1) {
      const s = verified[0];
      await db.attendanceCheckIn.update({ where: { id: s.attendanceCheckIn!.id }, data: { callLogId: call.id, callAt: call.startedAt } });
      await db.callLog.update({ where: { id: call.id }, data: { shiftId: s.id, note: call.note ?? "Shift check-in call" } });
      await recordEvent(s.id, s.guardId, "CALL_INCOMING", { at: call.startedAt, source: "APP", note: `Check-in call recorded at ${fmtTime(call.startedAt)}. Presence was already verified by GPS.` });
      return "call recorded: presence already verified";
    }
    return "no qualifying shift for this call";
  }

  if (open.length > 1) {
    // Overlapping rota: a person decides which shift this was, rather than the system guessing.
    for (const s of open) {
      const row = await ensureExpectation(s, cfg, now);
      if (row) await db.attendanceCheckIn.update({ where: { id: row.id }, data: { status: "MANUAL_REVIEW", callLogId: call.id, callAt: call.startedAt, exceptionReason: `The guard has ${open.length} shifts whose check-in windows contain this call. A supervisor must say which one it belongs to.` } });
    }
    return `ambiguous: ${open.length} shifts`;
  }

  const shift = open[0];
  const row = await ensureExpectation(shift, cfg, now);
  if (!row) return "no check-in row";
  if (VERIFIED_STATUSES.includes(row.status as CheckInStatus) || row.status === "MANUALLY_APPROVED") return "already verified";
  if (row.callLogId === call.id && row.status === "GPS_PENDING") return "already handled";

  await db.attendanceCheckIn.update({ where: { id: row.id }, data: { status: "CALL_RECEIVED", callLogId: call.id, callAt: call.startedAt, exceptionReason: null } });
  await db.callLog.update({ where: { id: call.id }, data: { shiftId: shift.id, note: call.note ?? "Shift check-in call" } });
  await recordEvent(shift.id, shift.guardId, "CALL_INCOMING", { at: call.startedAt, source: "APP", note: `Check-in call recorded at ${fmtTime(call.startedAt)}. Requesting a GPS fix to verify arrival.` });

  return await requestFix(row.id, shift, now);
}

/** Ask the guard's phone for a fresh fix, bounded by the configured attempt limit. */
export async function requestFix(checkInId: string, shift: ShiftForCheckIn, now = new Date()): Promise<string> {
  const cfg = await checkInConfig();
  const row = await db.attendanceCheckIn.findUniqueOrThrow({ where: { id: checkInId } });
  if (row.attempts >= cfg.maxGpsAttempts) {
    await db.attendanceCheckIn.update({ where: { id: row.id }, data: { status: "LOCATION_UNAVAILABLE", exceptionReason: `The phone did not return a usable fix after ${row.attempts} attempts.` } });
    return "attempt limit reached";
  }
  // Name the specific reason when the guard's phone exists but cannot be used: "no phone" would
  // send an operator looking for a device that is sitting right there, revoked.
  const known = await db.gatewayDevice.findFirst({ where: { guardId: shift.guardId, mode: "GUARD" }, orderBy: { lastSeenAt: "desc" } });
  if (known && (known.status === "REVOKED" || known.status === "DISABLED" || known.activationStatus !== "ACTIVE")) {
    const why = known.status === "REVOKED" ? "revoked" : known.status === "DISABLED" ? "disabled" : "not activated";
    await db.attendanceCheckIn.update({ where: { id: row.id }, data: { status: "LOCATION_UNAVAILABLE", exceptionReason: `${shift.guard.firstName} ${shift.guard.lastName}'s phone (${known.deviceName}) is ${why}, so it cannot be asked for a position.`, attempts: { increment: 1 } } });
    return `device ${why}`;
  }
  try {
    const { request } = await createLocationRequest({ guardId: shift.guardId, actor: { userId: null, name: "system (check-in)" }, purpose: "CHECKIN", locationId: shift.locationId, maxAccuracyM: cfg.accuracyMaxM }, now);
    await db.attendanceCheckIn.update({ where: { id: row.id }, data: { status: "GPS_PENDING", locationRequestId: request.id, gatewayDeviceId: request.gatewayDeviceId, attempts: { increment: 1 } } });
    return `gps requested (${request.id})`;
  } catch (e) {
    const msg = e instanceof LocationRequestError ? e.message : (e as Error).message;
    await db.attendanceCheckIn.update({ where: { id: row.id }, data: { status: "LOCATION_UNAVAILABLE", exceptionReason: msg, attempts: { increment: 1 } } });
    return `gps request failed: ${msg}`;
  }
}

export type IncomingFix = {
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  /** The phone's own capture time. Validated against `receivedAt` before it is trusted. */
  capturedAt: Date;
  mock: boolean;
  locationRequestId?: string | null;
  locationEventId?: string | null;
  source: "CALL_GPS" | "MONITORING" | "AUTO_GPS";
  /**
   * The capture time is already on the server's clock, corrected by the offset measured in the
   * same upload. Then an old timestamp means a delayed upload, not a clock set back.
   */
  clockVerified?: boolean;
};

/**
 * Apply a fix to an open check-in and write the attendance decision.
 *
 * The verified arrival time is the fix's capture time, not the moment the server finished
 * processing it, so a slow upload cannot make a punctual guard late. A phone clock that disagrees
 * with the server beyond the configured skew is replaced by the server's receipt time, so a clock
 * set backwards cannot make a late guard punctual either.
 */
export async function applyFix(checkInId: string, fix: IncomingFix, receivedAt = new Date()): Promise<{ status: CheckInStatus; outcome: string }> {
  const cfg = await checkInConfig();
  const row = await db.attendanceCheckIn.findUniqueOrThrow({ where: { id: checkInId }, include: { shift: { include: SHIFT_FOR_CHECKIN } } });
  if (row.status === "MANUALLY_APPROVED" || row.status === "MANUALLY_REJECTED") return { status: row.status as CheckInStatus, outcome: "already settled" };
  // Already verified: only an inside fix captured EARLIER can change anything, by moving the
  // arrival back. Phones sync out of order after an outage, and the first evidence of presence is
  // the arrival, not the first one that happened to reach the server.
  const alreadyVerified = VERIFIED_STATUSES.includes(row.status as CheckInStatus);
  if (alreadyVerified && (!row.verifiedArrivalAt || fix.capturedAt >= row.verifiedArrivalAt || fix.mock)) return { status: row.status as CheckInStatus, outcome: "already settled" };
  const shift = row.shift;

  if (fix.mock) {
    await db.attendanceCheckIn.update({ where: { id: row.id }, data: { status: "MANUAL_REVIEW", mock: true, exceptionReason: "The phone reported a mock (fake) location provider. This fix cannot verify attendance." } });
    await raiseException(row.id, shift, "A mock location provider was reported during check-in.");
    return { status: "MANUAL_REVIEW", outcome: "mock location" };
  }

  const t = fix.clockVerified ? { at: fix.capturedAt, adjusted: false as const, reason: undefined } : trustedTimestamp(fix.capturedAt, receivedAt, cfg.maxClockSkewMinutes);
  const capturedAt = t.at;

  // A fix must belong to this arrival: too early, too late or too stale and it is not evidence.
  // A fix answering the call is held to the call's time; one the phone took on its own, or that
  // the server asked for at the start, to the shift's own window, so last night's position or one
  // from the drive in an hour early never counts.
  const corr = fix.source === "CALL_GPS" && row.callAt
    ? fixCorrelates(row.callAt, capturedAt, receivedAt, { maxMinutesAfterCall: cfg.correlationMinutes, maxMinutesBeforeCall: 5, maxFixAgeMinutes: cfg.correlationMinutes + 5 })
    : autoFixBelongs(shift.startAt, shift.endAt, capturedAt, { beforeMinutes: cfg.autoBeforeMinutes });
  if (!corr.ok) {
    if (!alreadyVerified) await db.attendanceCheckIn.update({ where: { id: row.id }, data: { exceptionReason: `Fix not used: ${corr.reason}.` } });
    return { status: row.status as CheckInStatus, outcome: `fix rejected: ${corr.reason}` };
  }
  // Out of order: a vaguer or outside fix older than the evidence already held changes nothing.
  if (!alreadyVerified && row.gpsCapturedAt && capturedAt < row.gpsCapturedAt) {
    const peek = effectiveGeofence(shift, shift.location);
    const inside = peek && classifyFix({ latitude: fix.latitude, longitude: fix.longitude, accuracyM: fix.accuracyM }, { latitude: peek.fence.latitude, longitude: peek.fence.longitude, radiusM: peek.fence.radiusM }, cfg.accuracyMaxM).state === "INSIDE";
    if (!inside) return { status: row.status as CheckInStatus, outcome: "older than the evidence already held" };
  }

  const fence = effectiveGeofence(shift, shift.location);
  if (!fence) {
    await db.attendanceCheckIn.update({ where: { id: row.id }, data: { status: "SITE_NOT_CONFIGURED", geofenceReason: "no_site_coordinates", gpsCapturedAt: capturedAt, accuracyM: fix.accuracyM, exceptionReason: `${shift.location.name} has no coordinates, so GPS cannot confirm arrival.` } });
    return { status: "SITE_NOT_CONFIGURED", outcome: "site has no coordinates" };
  }

  const cls = classifyFix({ latitude: fix.latitude, longitude: fix.longitude, accuracyM: fix.accuracyM }, { latitude: fence.fence.latitude, longitude: fence.fence.longitude, radiusM: fence.fence.radiusM }, cfg.accuracyMaxM);
  const grace = graceFor(shift, cfg);
  const lateness = computeLateness(shift.startAt, capturedAt, grace.minutes);
  const status = statusForVerifiedFix(cls.state as LocationState, cls.reason, lateness);
  const verified = VERIFIED_STATUSES.includes(status);
  if (alreadyVerified && !verified) return { status: row.status as CheckInStatus, outcome: "already settled" };
  // Outside, or too vague, before the grace period is over: a guard still on the way. Recorded as
  // evidence, but nobody is alerted and the attendance record is left alone until there has been
  // time to arrive.
  const exceptionNow = exceptionDue(shift.startAt, receivedAt, grace.minutes);

  // One transaction so the check-in row and the attendance record can never disagree.
  await db.$transaction(async (tx) => {
    await tx.attendanceCheckIn.update({
      where: { id: row.id },
      data: {
        status, source: fix.source,
        locationRequestId: fix.locationRequestId ?? row.locationRequestId,
        locationEventId: fix.locationEventId ?? row.locationEventId,
        gpsCapturedAt: capturedAt,
        verifiedArrivalAt: verified ? capturedAt : null,
        geofenceState: cls.state, geofenceReason: cls.reason ?? null,
        accuracyM: fix.accuracyM, distanceM: cls.distanceM, mock: false,
        graceMinutes: grace.minutes,
        minutesAfterStart: lateness.minutesAfterStart,
        lateMinutes: lateness.lateMinutes,
        exceptionReason: verified ? null : CHECK_IN_EXCEPTION[status] ?? null,
        ...(t.adjusted ? { decisionReason: `Device timestamp replaced: ${t.reason}.` } : {}),
      },
    });
    if (verified) {
      await tx.attendance.update({
        where: { shiftId: shift.id },
        data: {
          status: lateness.late ? "LATE" : "PRESENT",
          arrivalConfirmedAt: capturedAt,
          lateMinutes: lateness.lateMinutes,
          locationVerification: "VERIFIED",
          locationVerifiedAt: capturedAt,
        },
      });
      if (shift.status === "SCHEDULED" || shift.status === "AWAITING_ARRIVAL" || shift.status === "LATE" || shift.status === "NOT_CONFIRMED") {
        await tx.shift.update({ where: { id: shift.id }, data: { status: "ON_DUTY", pendingPrompt: "NONE" } });
      }
    } else if (!exceptionNow) {
      // Too early to call it: leave the attendance record as it was.
    } else if (status === "OUTSIDE_AREA") {
      await tx.attendance.update({ where: { shiftId: shift.id }, data: { locationVerification: "EXCEPTION" } });
    } else {
      await tx.attendance.update({ where: { shiftId: shift.id }, data: { locationVerification: "UNAVAILABLE" } });
    }
  });

  const line = describeOutcome(status, lateness);
  const how = fix.source === "CALL_GPS" ? "after the check-in call" : fix.source === "AUTO_GPS" ? "requested at shift start" : "from the phone's own monitoring";
  // An earlier fix correcting a verified arrival, or evidence before the grace period ends, is noted
  // quietly; only a decision earns a timeline line of its own.
  if (verified || exceptionNow) {
    await recordEvent(shift.id, shift.guardId, verified ? "LOCATION_VERIFIED" : "LOCATION_EXCEPTION", {
      at: capturedAt, source: "APP",
      note: `${alreadyVerified ? "Arrival moved earlier" : "Check-in"}: ${line}, ${how}. ${Math.round(cls.distanceM)} m from ${shift.location.name}${fix.accuracyM != null ? ` · ±${Math.round(fix.accuracyM)} m` : ""}.`,
    });
  }
  if (!verified && exceptionNow) await raiseException(row.id, shift, line);
  if (verified) {
    // The unified evidence list: a GPS fix inside the geofence is the only "GPS verified" there is.
    const { recordEvidence } = await import("@/lib/attendance/evidence");
    await recordEvidence({
      shiftId: shift.id, guardId: shift.guardId, kind: "CHECK_IN", source: "GPS", status: "CONFIRMED", occurredAt: capturedAt,
      dedupeKey: `gps:checkin:${row.id}`, note: `${line}, ${how}. ${Math.round(cls.distanceM)} m from the site${fix.accuracyM != null ? `, ±${Math.round(fix.accuracyM)} m` : ""}.`,
    }).catch(() => undefined);
  }
  if (verified && !alreadyVerified) {
    const { onCheckInVerified } = await import("@/lib/client-notifications/rules");
    await onCheckInVerified(row.id).catch(() => undefined);
  }
  return { status, outcome: line };
}

const CHECK_IN_EXCEPTION: Partial<Record<CheckInStatus, string>> = {
  OUTSIDE_AREA: "The verified position is outside the assigned site.",
  LOCATION_UNCERTAIN: "GPS accuracy cannot confirm whether the guard is inside the site.",
  LOCATION_UNAVAILABLE: "No usable GPS fix was received.",
};

/** Tell the supervisor once per check-in, so a retrying phone cannot spam the control room. */
async function raiseException(checkInId: string, shift: ShiftForCheckIn, line: string) {
  const row = await db.attendanceCheckIn.findUniqueOrThrow({ where: { id: checkInId } });
  if (row.notifiedAt) return;
  await db.attendanceCheckIn.update({ where: { id: checkInId }, data: { notifiedAt: new Date() } });
  await notify({
    type: "LOCATION_EXCEPTION", severity: "WARNING",
    title: `Check-in exception · ${shift.guard.firstName} ${shift.guard.lastName}`,
    body: `${shift.location.name}, shift from ${fmtTime(shift.startAt)}. ${line}.`,
    guardId: shift.guardId, shiftId: shift.id, url: `/attendance/check-ins`,
  });
}

/**
 * Engine step: open expectations for shifts about to start, and escalate the ones that have run out
 * of time. Idempotent — `escalatedAt` and `notifiedAt` stop repeat work.
 */
export async function runCheckInStep(now = new Date()): Promise<{ opened: number; escalated: number; autoRequested: number; callsOutstanding: number; errors: string[] }> {
  const out = { opened: 0, escalated: 0, autoRequested: 0, callsOutstanding: 0, errors: [] as string[] };
  const cfg = await checkInConfig();
  if (!cfg.enabled) return out;

  const soon = new Date(now.getTime() + cfg.windowBeforeMinutes * 60_000);
  const upcoming = await db.shift.findMany({
    where: { status: { notIn: ["CANCELLED", "COMPLETED", "MISSED"] }, startAt: { lte: soon }, endAt: { gt: now }, attendanceCheckIn: { is: null } },
    include: SHIFT_FOR_CHECKIN, take: 200,
  });
  for (const s of upcoming) {
    try { if (await ensureExpectation(s, cfg, now)) out.opened++; } catch (e) { out.errors.push(`expectation ${s.id}: ${(e as Error).message}`); }
  }

  // Ask the guard's phone where it is, without waiting for a call: ten minutes before the start,
  // at the start, and at the end of the grace period. The phone's own monitoring usually answers
  // first; these requests cover a phone whose monitoring is not running or has drifted.
  if (cfg.autoGps) {
    const pending = await db.attendanceCheckIn.findMany({
      where: { status: { in: ["AWAITING", "GPS_PENDING", "OUTSIDE_AREA", "LOCATION_UNCERTAIN", "LOCATION_UNAVAILABLE"] }, escalatedAt: null, source: { not: "SMS_ONLY" }, scheduledStartAt: { lte: new Date(now.getTime() + cfg.autoBeforeMinutes * 60_000) } },
      include: { shift: { include: SHIFT_FOR_CHECKIN } }, take: 200,
    });
    for (const row of pending) {
      const grace = graceFor(row.shift, cfg);
      if (!autoRequestDue(row.scheduledStartAt, now, row.autoRequestedAt, { beforeMinutes: cfg.autoBeforeMinutes, graceMinutes: grace.minutes })) continue;
      try { if (await requestAutoFix(row.id, row.shift, now)) out.autoRequested++; } catch (e) { out.errors.push(`auto gps ${row.id}: ${(e as Error).message}`); }
    }
  }

  // A guard without an Android phone is never escalated by this feature: their attendance is
  // decided by the SMS arrival flow, which has its own reminder and escalation. Raising them here
  // as "missed" would be a second, contradictory verdict on the same shift.
  const open = await db.attendanceCheckIn.findMany({
    where: { status: { in: ["AWAITING", "CALL_RECEIVED", "GPS_PENDING", "LOCATION_UNAVAILABLE", "LOCATION_UNCERTAIN", "OUTSIDE_AREA"] }, escalatedAt: null, source: { not: "SMS_ONLY" } },
    include: { shift: { include: SHIFT_FOR_CHECKIN }, gatewayDevice: true }, take: 200,
  });
  const offlineMinutes = (await getSettingNumber("gateway.offlineMinutes")) || 5;
  for (const row of open) {
    const grace = graceFor(row.shift, cfg);
    const phase = escalationState(row.scheduledStartAt, now, { graceMinutes: grace.minutes, escalationMinutes: cfg.escalationMinutes });
    if (phase.phase !== "ESCALATE") continue;
    try {
      const device = row.gatewayDevice ?? (await db.gatewayDevice.findFirst({ where: { guardId: row.guardId, mode: "GUARD" }, orderBy: { lastSeenAt: "desc" } }));
      const online = Boolean(device?.lastSeenAt && now.getTime() - device.lastSeenAt.getTime() <= offlineMinutes * 60_000);
      const next = escalatedStatus(row.status as CheckInStatus, online);
      const who = `${row.shift.guard.firstName} ${row.shift.guard.lastName}`;
      const reason =
        next === "MISSED" ? `No usable position within ${grace.minutes + cfg.escalationMinutes} minutes of the scheduled start, though the phone was online.`
        : next === "DEVICE_OFFLINE" ? `${device?.deviceName ?? "The guard's phone"} has not reported since ${device?.lastSeenAt ? fmtTime(device.lastSeenAt) : "before the shift"}. This is not the same as absent: call the guard.`
        : row.exceptionReason;
      await db.attendanceCheckIn.update({ where: { id: row.id }, data: { status: next, escalatedAt: now, exceptionReason: reason ?? row.exceptionReason } });
      await recordEvent(row.shiftId, row.guardId, "LOCATION_OVERDUE", { at: now, note: `Check-in not verified ${phase.minutesAfterStart} min after the start: ${CHECK_IN_TITLE[next] ?? next.toLowerCase().replace(/_/g, " ")}.` });
      if (!row.notifiedAt) {
        await db.attendanceCheckIn.update({ where: { id: row.id }, data: { notifiedAt: now } });
        await notify({
          type: "GUARD_NOT_REPORTED", severity: next === "MISSED" || next === "OUTSIDE_AREA" ? "CRITICAL" : "WARNING",
          title: `${CHECK_IN_TITLE[next] ?? "Check-in not verified"} · ${who}`,
          body: `${row.shift.location.name}, shift from ${fmtTime(row.scheduledStartAt)}. ${reason ?? ""} Call ${row.shift.guard.phone}.`.replace(/\s+/g, " "),
          guardId: row.guardId, shiftId: row.shiftId, url: "/attendance/check-ins",
        });
      }
      const { onCheckInEscalated } = await import("@/lib/client-notifications/rules");
      await onCheckInEscalated(row.id, next).catch(() => undefined);
      out.escalated++;
    } catch (e) {
      out.errors.push(`escalate ${row.id}: ${(e as Error).message}`);
    }
  }

  // Presence verified, but the company also requires the call and it has not come. A smaller
  // problem than absence, and reported as exactly that, once.
  const callDue = await db.attendanceCheckIn.findMany({
    where: { callRequired: true, callAt: null, callOutstandingNotifiedAt: null, status: { in: ["VERIFIED_ON_TIME", "VERIFIED_WITHIN_GRACE", "VERIFIED_LATE", "MANUALLY_APPROVED"] } },
    include: { shift: { include: SHIFT_FOR_CHECKIN } }, take: 200,
  });
  for (const row of callDue) {
    const grace = graceFor(row.shift, cfg);
    if (escalationState(row.scheduledStartAt, now, { graceMinutes: grace.minutes, escalationMinutes: cfg.escalationMinutes }).phase !== "ESCALATE") continue;
    await db.attendanceCheckIn.update({ where: { id: row.id }, data: { callOutstandingNotifiedAt: now } });
    await notify({
      type: "CHECK_IN_CALL_OUTSTANDING", severity: "WARNING",
      title: `Check-in call outstanding · ${row.shift.guard.firstName} ${row.shift.guard.lastName}`,
      body: `${row.shift.location.name}: the phone was verified on site${row.verifiedArrivalAt ? ` at ${fmtTime(row.verifiedArrivalAt)}` : ""}, but the required check-in call has not been made.`,
      guardId: row.guardId, shiftId: row.shiftId, url: "/attendance/check-ins",
    });
    out.callsOutstanding++;
  }
  return out;
}

const CHECK_IN_TITLE: Partial<Record<CheckInStatus, string>> = {
  MISSED: "Check-in missed",
  DEVICE_OFFLINE: "Guard phone offline at shift start",
  OUTSIDE_AREA: "Outside the assigned site at shift start",
  LOCATION_UNCERTAIN: "Location uncertain at shift start",
  LOCATION_UNAVAILABLE: "No usable position at shift start",
};

/**
 * Ask the guard's phone for a fix because the shift is starting, not because anyone rang. Never
 * burns the check-in into an exception on its own: a refused or failed request is retried at the
 * next scheduled moment, and escalation decides what the shift becomes.
 */
export async function requestAutoFix(checkInId: string, shift: ShiftForCheckIn, now = new Date()): Promise<boolean> {
  const cfg = await checkInConfig();
  const row = await db.attendanceCheckIn.findUniqueOrThrow({ where: { id: checkInId } });
  try {
    const { request } = await createLocationRequest({ guardId: shift.guardId, actor: { userId: null, name: "system (shift start)" }, purpose: "CHECKIN", locationId: shift.locationId, maxAccuracyM: cfg.accuracyMaxM }, now);
    // The request id is unique per check-in; a request reused from another purpose stays its own.
    const linked = await db.attendanceCheckIn.findUnique({ where: { locationRequestId: request.id } });
    await db.attendanceCheckIn.update({
      where: { id: row.id },
      data: {
        autoRequestedAt: now, gatewayDeviceId: request.gatewayDeviceId,
        ...(linked && linked.id !== row.id ? {} : { locationRequestId: request.id }),
        ...(row.status === "AWAITING" ? { status: "GPS_PENDING" as const } : {}),
      },
    });
    return true;
  } catch (e) {
    const msg = e instanceof LocationRequestError ? e.message : (e as Error).message;
    await db.attendanceCheckIn.update({ where: { id: row.id }, data: { autoRequestedAt: now, exceptionReason: `Automatic position request not sent: ${msg}` } });
    return false;
  }
}

/**
 * A fix the phone took on its own (shift monitoring, a call-time fix) reached the server. If its
 * shift has a check-in that is not yet settled, it is evidence.
 */
export async function applyMonitoringFix(input: { shiftId: string; latitude: number; longitude: number; accuracyM: number | null; capturedAt: Date; mock: boolean; locationEventId: string; clockVerified?: boolean }, receivedAt = new Date()): Promise<string> {
  const cfg = await checkInConfig();
  if (!cfg.enabled || !cfg.autoGps) return "automatic check-in off";
  const shift = await db.shift.findUnique({ where: { id: input.shiftId }, include: SHIFT_FOR_CHECKIN });
  if (!shift) return "no shift";
  const row = await ensureExpectation(shift, cfg, receivedAt);
  if (!row || row.source === "SMS_ONLY") return "no check-in for this shift";
  const res = await applyFix(row.id, { latitude: input.latitude, longitude: input.longitude, accuracyM: input.accuracyM, capturedAt: input.capturedAt, mock: input.mock, locationEventId: input.locationEventId, source: "MONITORING", clockVerified: input.clockVerified }, receivedAt);
  return `check-in ${res.status}: ${res.outcome}`;
}

/**
 * A supervisor resolves an exception by hand. The result is always recorded as a manual decision,
 * never as a GPS verification, and the previous status is kept so the override is reconstructable.
 */
export async function decide(checkInId: string, decision: "APPROVE" | "REJECT", actor: { userId: string; name: string }, reason: string) {
  if (!reason.trim()) throw new Error("A reason is required for a manual attendance decision.");
  const row = await db.attendanceCheckIn.findUniqueOrThrow({ where: { id: checkInId }, include: { shift: { include: SHIFT_FOR_CHECKIN } } });
  const status: CheckInStatus = decision === "APPROVE" ? "MANUALLY_APPROVED" : "MANUALLY_REJECTED";
  const shift = row.shift;
  const grace = graceFor(shift, await checkInConfig());
  const arrival = row.gpsCapturedAt ?? row.callAt ?? new Date();
  const lateness = computeLateness(shift.startAt, arrival, grace.minutes);

  await db.$transaction(async (tx) => {
    await tx.attendanceCheckIn.update({
      where: { id: row.id },
      data: {
        status, source: "MANUAL", previousStatus: row.status, decidedById: actor.userId, decidedAt: new Date(), decisionReason: reason,
        ...(decision === "APPROVE" ? { verifiedArrivalAt: arrival, minutesAfterStart: lateness.minutesAfterStart, lateMinutes: lateness.lateMinutes } : { verifiedArrivalAt: null }),
      },
    });
    await tx.attendance.update({
      where: { shiftId: shift.id },
      data: decision === "APPROVE"
        ? { status: lateness.late ? "LATE" : "PRESENT", arrivalConfirmedAt: arrival, lateMinutes: lateness.lateMinutes, locationVerification: row.geofenceState === "INSIDE" ? "VERIFIED" : "UNAVAILABLE" }
        : { status: "NOT_REPORTED", arrivalConfirmedAt: null, locationVerification: "UNAVAILABLE" },
    });
  });

  await recordEvent(shift.id, shift.guardId, "ADMIN_NOTE", { source: "ADMIN", at: new Date(), note: `Check-in ${decision === "APPROVE" ? "approved" : "rejected"} by ${actor.name}: ${reason}` });
  await audit({ userId: actor.userId, actor: actor.name, action: decision === "APPROVE" ? "CHECKIN_APPROVED" : "CHECKIN_REJECTED", entity: "AttendanceCheckIn", entityId: row.id, details: { shiftId: shift.id, guardId: row.guardId, previousStatus: row.status, status, reason, verifiedArrivalAt: decision === "APPROVE" ? arrival.toISOString() : null, lateMinutes: decision === "APPROVE" ? lateness.lateMinutes : null } });
  return status;
}
