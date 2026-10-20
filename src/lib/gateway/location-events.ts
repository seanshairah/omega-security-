/**
 * Location events from guard devices. The phone decides INSIDE / OUTSIDE / UNKNOWN locally
 * (same rules as src/lib/geofence.ts); the server re-computes the distance from the site it
 * knows, stores the event with its sync status, writes the shift timeline, correlates the SMS
 * arrival confirmation, and raises alerts without spamming.
 */
import { db } from "@/lib/db";
import type { GatewayDevice, LocationEventType, LocationState, Prisma } from "@prisma/client";
import { classifyFix, haversineM, syncStatusFor } from "@/lib/geofence";
import { effectiveGeofence } from "@/lib/site-config";
import { getSettingNumber } from "@/lib/settings";
import { notify } from "@/lib/notifications";
import { findLiveShiftForGuard, recordEvent } from "@/lib/services/shifts";
import { fmtTime } from "@/lib/time";
import { saneTimestamp } from "./call-state";

export const LOCATION_EVENT_TYPES = ["SHIFT_STARTED", "LOCATION_CHECK", "LOCATION_EXIT", "LOCATION_OUTSIDE", "LOCATION_RETURNED", "LOCATION_UNAVAILABLE", "LOCATION_CALL"] as const;
export type IncomingLocationEvent = {
  eventId: string;
  eventType: (typeof LOCATION_EVENT_TYPES)[number];
  timestamp: string | Date;
  latitude?: number;
  longitude?: number;
  accuracyM?: number;
  distanceM?: number;
  geofenceRadiusM?: number;
  locationState?: LocationState;
  provider?: string;
  speed?: number;
  bearing?: number;
  mock?: boolean;
  reason?: string;
  durationOutsideSeconds?: number;
  shiftId?: string;
  siteId?: string;
  callId?: string;
  meta?: Record<string, unknown>;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export function validateLocationEvent(raw: Record<string, unknown>, eventId: string, eventType: string): { ok: true; event: IncomingLocationEvent } | { ok: false; error: string } {
  if (!(LOCATION_EVENT_TYPES as readonly string[]).includes(eventType)) return { ok: false, error: `unknown eventType ${eventType}` };
  const lat = num(raw.latitude), lon = num(raw.longitude);
  if ((lat !== undefined && (lat < -90 || lat > 90)) || (lon !== undefined && (lon < -180 || lon > 180))) return { ok: false, error: "invalid coordinates" };
  const st = raw.locationState;
  const locationState = st === "INSIDE" || st === "OUTSIDE" || st === "UNKNOWN" ? st : undefined;
  return { ok: true, event: {
    eventId, eventType: eventType as IncomingLocationEvent["eventType"],
    timestamp: typeof raw.timestamp === "string" || raw.timestamp instanceof Date ? raw.timestamp : new Date().toISOString(),
    latitude: lat, longitude: lon, accuracyM: num(raw.accuracyM ?? raw.accuracy), distanceM: num(raw.distanceM), geofenceRadiusM: num(raw.geofenceRadiusM),
    locationState, provider: typeof raw.provider === "string" ? raw.provider.slice(0, 20) : undefined, speed: num(raw.speed), bearing: num(raw.bearing),
    mock: raw.mock === true, reason: typeof raw.reason === "string" ? raw.reason.slice(0, 60) : undefined, durationOutsideSeconds: num(raw.durationOutsideSeconds),
    shiftId: typeof raw.shiftId === "string" ? raw.shiftId : undefined, siteId: typeof raw.siteId === "string" ? raw.siteId : undefined, callId: typeof raw.callId === "string" ? raw.callId : undefined,
    meta: typeof raw.meta === "object" && raw.meta ? (raw.meta as Record<string, unknown>) : undefined,
  } };
}

/** Store one location event. Returns a one-line outcome for the raw event log. */
export async function applyLocationEvent(device: GatewayDevice, ev: IncomingLocationEvent, opts: { simulated?: boolean; clockVerified?: boolean } = {}): Promise<{ outcome: string; locationEventId: string }> {
  const now = new Date();
  const at = saneTimestamp(ev.timestamp, now);
  if (device.mode !== "GUARD" || !device.guardId) {
    const e = await db.locationEvent.create({ data: { eventId: ev.eventId, gatewayDeviceId: device.id, eventType: ev.eventType, locationState: "UNKNOWN", occurredAt: at, syncStatus: syncStatusFor(at, now), simulated: Boolean(opts.simulated), reason: "device_not_guard_mode", metadata: ev.meta as Prisma.InputJsonObject | undefined } });
    return { outcome: "stored; device is not in guard mode", locationEventId: e.id };
  }
  const guard = await db.guard.findUnique({ where: { id: device.guardId } });
  if (!guard) throw new Error("Device's guard not found");
  // Shift: the phone names it if it cached one; otherwise the live shift at that time.
  const shift = (ev.shiftId ? await db.shift.findFirst({ where: { id: ev.shiftId, guardId: guard.id }, include: { location: true } }) : null) ?? (await findLiveShiftForGuard(guard.id, at));
  const site = shift?.location ?? null;
  // The fence in force for this shift: its override when set, else the site's.
  const fence = shift ? effectiveGeofence(shift, shift.location)?.fence ?? null : null;
  const accuracyMax = await getSettingNumber("geofence.accuracyMaxM");

  // Server-side classification when the fence has coordinates; the phone's verdict is kept in metadata.
  let state: LocationState = ev.locationState ?? "UNKNOWN";
  let distanceM = ev.distanceM;
  let reason = ev.reason;
  if (ev.latitude != null && ev.longitude != null && fence) {
    const c = classifyFix({ latitude: ev.latitude, longitude: ev.longitude, accuracyM: ev.accuracyM }, fence, accuracyMax);
    distanceM = Math.round(c.distanceM);
    if (ev.eventType !== "LOCATION_UNAVAILABLE") { state = c.state; reason = c.reason ?? reason; }
  } else if (ev.latitude != null && ev.longitude != null && device.locationId && !site) {
    const home = await db.location.findUnique({ where: { id: device.locationId } });
    if (home?.latitude != null && home.longitude != null) distanceM = Math.round(haversineM(ev.latitude, ev.longitude, home.latitude, home.longitude));
  }
  if (ev.eventType === "LOCATION_UNAVAILABLE") state = "UNKNOWN";
  const syncStatus = syncStatusFor(at, now);

  const row = await db.locationEvent.create({ data: {
    eventId: ev.eventId, gatewayDeviceId: device.id, guardId: guard.id, shiftId: shift?.id ?? null, locationId: site?.id ?? device.locationId ?? null,
    eventType: ev.eventType, locationState: state, latitude: ev.latitude ?? null, longitude: ev.longitude ?? null, accuracyM: ev.accuracyM ?? null,
    distanceM: distanceM ?? null, geofenceRadiusM: fence?.radiusM ?? ev.geofenceRadiusM ?? null, provider: ev.provider ?? null, speed: ev.speed ?? null, bearing: ev.bearing ?? null,
    mock: Boolean(ev.mock), reason: reason ?? null, durationOutsideSeconds: ev.durationOutsideSeconds ?? null, occurredAt: at, syncStatus, simulated: Boolean(opts.simulated),
    metadata: { phoneState: ev.locationState ?? null, phoneDistanceM: ev.distanceM ?? null, callId: ev.callId ?? null, ...(ev.meta ?? {}) } as Prisma.InputJsonObject,
  } });

  // Device panel: last known fix, only if newer than what we have.
  if (ev.latitude != null && ev.longitude != null && (!device.lastLocationAt || device.lastLocationAt < at)) {
    await db.gatewayDevice.update({ where: { id: device.id }, data: { lastLatitude: ev.latitude, lastLongitude: ev.longitude, lastAccuracyM: ev.accuracyM ?? null, lastLocationAt: at, lastLocationState: state, ...(ev.mock ? { mockLocationSeen: true } : {}) } });
  } else if (ev.eventType === "LOCATION_UNAVAILABLE" && (!device.lastLocationAt || device.lastLocationAt < at)) {
    await db.gatewayDevice.update({ where: { id: device.id }, data: { lastLocationState: "UNKNOWN" } });
  }
  // A mock provider is remembered whatever the event's age: an old replayed fake fix is still a fake fix.
  if (ev.mock && !device.mockLocationSeen) await db.gatewayDevice.update({ where: { id: device.id }, data: { mockLocationSeen: true } });

  const who = `${guard.firstName} ${guard.lastName}`;
  const late = syncStatus === "SYNCED_LATE" ? " (synced late)" : "";
  const dist = distanceM != null ? `${distanceM} m from site` : "distance unknown";
  const acc = ev.accuracyM != null ? ` ±${Math.round(ev.accuracyM)} m` : "";

  if (shift) {
    const map: Partial<Record<LocationEventType, { type: Parameters<typeof recordEvent>[2]; note: string }>> = {
      SHIFT_STARTED: { type: "LOCATION_INSIDE", note: `Monitoring started on the phone${late}. ${state === "INSIDE" ? `Inside the site, ${dist}${acc}.` : state === "OUTSIDE" ? `Outside the site, ${dist}${acc}.` : "No fix yet."}` },
      LOCATION_CHECK: { type: state === "OUTSIDE" ? "LOCATION_OUTSIDE" : state === "INSIDE" ? "LOCATION_INSIDE" : "LOCATION_UNAVAILABLE", note: `Location check${late}: ${state.toLowerCase()}, ${dist}${acc}.` },
      LOCATION_EXIT: { type: "LOCATION_EXIT", note: `Left the site${late}: ${dist}${acc}, fence ${fence?.radiusM ?? "?"} m.` },
      LOCATION_OUTSIDE: { type: "LOCATION_OUTSIDE", note: `Still outside${late}: ${dist}${acc}.` },
      LOCATION_RETURNED: { type: "LOCATION_RETURNED", note: `Back inside the site${late}: ${dist}${acc}${ev.durationOutsideSeconds != null ? `, ${Math.round(ev.durationOutsideSeconds / 60)} min outside` : ""}.` },
      LOCATION_UNAVAILABLE: { type: "LOCATION_UNAVAILABLE", note: `Location unavailable${late}: ${(reason ?? "no fix").replace(/_/g, " ")}.` },
      LOCATION_CALL: { type: state === "OUTSIDE" ? "LOCATION_OUTSIDE" : state === "INSIDE" ? "LOCATION_INSIDE" : "LOCATION_UNAVAILABLE", note: `Location at the time of a call${late}: ${state.toLowerCase()}, ${dist}${acc}.` },
    };
    const m = map[ev.eventType];
    if (m && !(ev.eventType === "LOCATION_CHECK" && state === "INSIDE" && (await recentInsideCheck(shift.id, at)))) await recordEvent(shift.id, guard.id, m.type, { at, source: "APP", note: m.note });
    // Correlate with the SMS arrival confirmation when the first usable fix of the shift arrives.
    if (state !== "UNKNOWN" || ev.eventType === "LOCATION_UNAVAILABLE") await verifyArrival(shift.id, guard.id, state, at, distanceM, site?.name ?? "the site");
    // The same fix is shift-start attendance evidence: a guard whose phone is inside the site at
    // 21:58 has arrived, whether or not they have rung in yet.
    if (ev.latitude != null && ev.longitude != null && ev.eventType !== "LOCATION_UNAVAILABLE") {
      const { applyMonitoringFix } = await import("@/lib/attendance/check-in-service");
      await applyMonitoringFix({ shiftId: shift.id, latitude: ev.latitude, longitude: ev.longitude, accuracyM: ev.accuracyM ?? null, capturedAt: at, mock: Boolean(ev.mock), locationEventId: row.id, clockVerified: Boolean(opts.clockVerified) }, now).catch(() => undefined);
    }
  }

  // Alerts. Exits and returns are one notification each; outside updates are silent (the engine escalates).
  if (ev.eventType === "LOCATION_EXIT") await notify({ type: "LOCATION_EXIT", severity: "WARNING", title: `${who} is outside ${site?.name ?? "the assigned site"}`, body: `Location exit at ${fmtTime(at)}${late}: ${dist}${acc}. Call the guard before drawing conclusions; GPS is not exact.`, guardId: guard.id, shiftId: shift?.id, url: shift ? `/shifts/${shift.id}` : `/guards/${guard.id}` });
  if (ev.eventType === "LOCATION_RETURNED") await notify({ type: "LOCATION_RETURNED", severity: "INFO", title: `${who} is back inside ${site?.name ?? "the site"}`, body: `Returned at ${fmtTime(at)}${late}${ev.durationOutsideSeconds != null ? ` after ${Math.round(ev.durationOutsideSeconds / 60)} min outside` : ""}.`, guardId: guard.id, shiftId: shift?.id, url: shift ? `/shifts/${shift.id}` : `/guards/${guard.id}` });
  if (ev.eventType === "LOCATION_UNAVAILABLE" && shift && !(await recentUnavailable(shift.id, at))) await notify({ type: "LOCATION_UNAVAILABLE", severity: "WARNING", title: `Location unavailable for ${who}`, body: `${(reason ?? "no fix").replace(/_/g, " ")} at ${fmtTime(at)}${late}. This is not the same as leaving the site.`, guardId: guard.id, shiftId: shift.id, url: `/shifts/${shift.id}` });
  if (ev.mock && !device.mockLocationSeen) await notify({ type: "LOCATION_INTEGRITY", severity: "WARNING", title: `Location integrity warning · ${who}`, body: `The phone reported a mock (fake) location provider at ${fmtTime(at)}. Treat its location events with caution.`, guardId: guard.id, shiftId: shift?.id, url: `/gateways/${device.id}` });

  return { outcome: `${ev.eventType} ${state}${distanceM != null ? ` ${distanceM} m` : ""}${shift ? " · on shift" : ""} · ${syncStatus}`, locationEventId: row.id };
}

async function recentInsideCheck(shiftId: string, at: Date) {
  // Keep the shift timeline readable: at most one "inside" line per 25 minutes; the LocationEvent row is always kept.
  return Boolean(await db.shiftCheckIn.findFirst({ where: { shiftId, type: "LOCATION_INSIDE", at: { gte: new Date(at.getTime() - 25 * 60000), lte: at } } }));
}
async function recentUnavailable(shiftId: string, at: Date) {
  return Boolean(await db.notification.findFirst({ where: { type: "LOCATION_UNAVAILABLE", shiftId, createdAt: { gte: new Date(at.getTime() - 60 * 60000) } } }));
}

/**
 * SMS + GPS. Once the guard has confirmed arrival by SMS and a usable fix exists, stamp the
 * attendance: VERIFIED (inside), EXCEPTION (outside), UNAVAILABLE (no usable fix). Neutral
 * wording: an exception is something to check, not an accusation. Decided once per shift.
 */
export async function verifyArrival(shiftId: string, guardId: string, state: LocationState, at: Date, distanceM: number | undefined, siteName: string) {
  const att = await db.attendance.findUnique({ where: { shiftId } });
  if (!att || !att.arrivalConfirmedAt) return; // SMS confirmation not in yet; the pipeline hook will call back
  if (att.locationVerification === "VERIFIED" || att.locationVerification === "EXCEPTION") return;
  if (state === "UNKNOWN") {
    if (att.locationVerification === "NOT_APPLICABLE") await db.attendance.update({ where: { shiftId }, data: { locationVerification: "UNAVAILABLE" } });
    return;
  }
  const verification = state === "INSIDE" ? "VERIFIED" : "EXCEPTION";
  await db.attendance.update({ where: { shiftId }, data: { locationVerification: verification, locationVerifiedAt: at } });
  await recordEvent(shiftId, guardId, verification === "VERIFIED" ? "LOCATION_VERIFIED" : "LOCATION_EXCEPTION", { at, source: "APP", note: verification === "VERIFIED" ? `Arrival verified: SMS confirmation and GPS inside ${siteName}${distanceM != null ? ` (${distanceM} m)` : ""}.` : `Location exception: SMS confirmation received but GPS places the guard outside ${siteName}${distanceM != null ? ` (${distanceM} m)` : ""}. Location verification required.` });
  if (verification === "EXCEPTION") {
    const g = await db.guard.findUnique({ where: { id: guardId } });
    await notify({ type: "LOCATION_EXCEPTION", severity: "WARNING", title: `Location exception · ${g?.firstName} ${g?.lastName}`, body: `Confirmed arrival by SMS but GPS is outside ${siteName}${distanceM != null ? ` (${distanceM} m)` : ""}. Verify by phone.`, guardId, shiftId, url: `/shifts/${shiftId}` });
  }
}

/** Called from the SMS pipeline after a YES: look for a usable fix around the confirmation. Never throws. */
export async function verifyArrivalFromSms(shiftId: string, guardId: string, confirmedAt: Date) {
  try {
    const guard = await db.guard.findUnique({ where: { id: guardId }, select: { deviceKind: true } });
    if (guard?.deviceKind !== "ANDROID_GUARD") return;
    const shift = await db.shift.findUnique({ where: { id: shiftId }, include: { location: true } });
    if (!shift) return;
    const fix = await db.locationEvent.findFirst({ where: { guardId, latitude: { not: null }, occurredAt: { gte: new Date(confirmedAt.getTime() - 20 * 60000), lte: new Date(confirmedAt.getTime() + 20 * 60000) } }, orderBy: { occurredAt: "desc" } });
    if (!fix) { await db.attendance.updateMany({ where: { shiftId, locationVerification: "NOT_APPLICABLE" }, data: { locationVerification: "UNAVAILABLE" } }); return; }
    await verifyArrival(shiftId, guardId, fix.locationState, fix.occurredAt, fix.distanceM ?? undefined, shift.location.name);
  } catch (e) {
    console.error("verifyArrivalFromSms", e);
  }
}

/** Engine: overdue verification, extended absence escalation, retention. Each decision is made once per shift. */
export async function locationMaintenance(now = new Date()) {
  const report = { overdue: 0, escalated: 0, purged: 0 };
  const [checkMinutes, overdueIntervals, escalationMinutes, retentionDays] = await Promise.all([getSettingNumber("geofence.checkMinutes"), getSettingNumber("geofence.overdueIntervals"), getSettingNumber("geofence.escalationMinutes"), getSettingNumber("geofence.locationRetentionDays")]);
  const overdueMs = Math.max(1, checkMinutes * overdueIntervals) * 60000;
  const monitored = await db.shift.findMany({ where: { status: { in: ["ON_DUTY", "ASSISTANCE", "INCIDENT", "CRITICAL"] }, guard: { deviceKind: "ANDROID_GUARD", devices: { some: { mode: "GUARD", activationStatus: "ACTIVE", status: { in: ["ONLINE", "OFFLINE"] } } } } }, include: { guard: { include: { devices: { where: { mode: "GUARD", activationStatus: "ACTIVE" }, take: 1 } } }, location: true } });
  for (const s of monitored) {
    const device = s.guard.devices[0];
    const lastEvent = await db.locationEvent.findFirst({ where: { shiftId: s.id }, orderBy: { occurredAt: "desc" } });
    const lastAt = lastEvent?.occurredAt ?? s.startAt;
    const who = `${s.guard.firstName} ${s.guard.lastName}`;
    // Overdue: the phone has been online but has not reported a location for too long. A device that is
    // offline is a different condition (DEVICE OFFLINE) and is reported by gatewayMaintenance instead.
    if (device && device.status === "ONLINE" && now.getTime() - lastAt.getTime() > overdueMs && lastEvent?.eventType !== "LOCATION_VERIFICATION_OVERDUE") {
      const already = await db.locationEvent.findFirst({ where: { shiftId: s.id, eventType: "LOCATION_VERIFICATION_OVERDUE", occurredAt: { gte: lastAt } } });
      if (!already) {
        await db.locationEvent.create({ data: { eventId: `overdue-${s.id}-${now.getTime()}`, gatewayDeviceId: device.id, guardId: s.guardId, shiftId: s.id, locationId: s.locationId, eventType: "LOCATION_VERIFICATION_OVERDUE", locationState: "UNKNOWN", occurredAt: now, reason: "no_check_received" } });
        await recordEvent(s.id, s.guardId, "LOCATION_OVERDUE", { at: now, source: "SYSTEM", note: `No location check from the phone since ${fmtTime(lastAt)} although it is online. Location verification overdue.` });
        await notify({ type: "LOCATION_OVERDUE", severity: "WARNING", title: `Location verification overdue · ${who}`, body: `${s.location.name}: no location check since ${fmtTime(lastAt)}. The phone is online; the app may have been stopped or location turned off.`, guardId: s.guardId, shiftId: s.id, url: `/shifts/${s.id}` });
        report.overdue++;
      }
    }
    // Extended absence: outside for longer than the escalation threshold without a return.
    const exit = await db.locationEvent.findFirst({ where: { shiftId: s.id, eventType: "LOCATION_EXIT" }, orderBy: { occurredAt: "desc" } });
    if (exit) {
      const returned = await db.locationEvent.findFirst({ where: { shiftId: s.id, eventType: "LOCATION_RETURNED", occurredAt: { gt: exit.occurredAt } } });
      if (!returned && now.getTime() - exit.occurredAt.getTime() > escalationMinutes * 60000) {
        const escalated = await db.notification.findFirst({ where: { type: "LOCATION_EXTENDED", shiftId: s.id, createdAt: { gte: exit.occurredAt } } });
        if (!escalated) {
          await notify({ type: "LOCATION_EXTENDED", severity: "CRITICAL", title: `EXTENDED ABSENCE · ${who} outside ${s.location.name}`, body: `Left the site at ${fmtTime(exit.occurredAt)} and has not returned after ${escalationMinutes} min. Call ${s.guard.phone}.`, guardId: s.guardId, shiftId: s.id, url: `/shifts/${s.id}` });
          report.escalated++;
        }
      }
    }
  }
  if (retentionDays > 0) {
    const cutoff = new Date(now.getTime() - retentionDays * 86400_000);
    report.purged = (await db.locationEvent.deleteMany({ where: { occurredAt: { lt: cutoff } } })).count;
  }
  return report;
}
