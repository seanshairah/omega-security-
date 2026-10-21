import { db } from "@/lib/db";
import type { CheckInSource, CheckInType, Prisma, ShiftStatus } from "@prisma/client";
import { addDays, addMinutes, differenceInMinutes, setHours, setMinutes, startOfDay } from "date-fns";
import { audit } from "@/lib/audit";
import { editPolicy, deletePolicy, type ShiftTraceCounts } from "@/lib/shift-edit";

export const LIVE_STATUSES: ShiftStatus[] = ["AWAITING_ARRIVAL", "ON_DUTY", "LATE", "NOT_CONFIRMED", "ASSISTANCE", "INCIDENT", "CRITICAL"];
export const ON_SITE_STATUSES: ShiftStatus[] = ["ON_DUTY", "ASSISTANCE", "INCIDENT", "CRITICAL"];
export const CLOSED_STATUSES: ShiftStatus[] = ["COMPLETED", "MISSED", "CANCELLED"];

export const shiftInclude = {
  guard: true,
  location: { include: { client: true } },
  supervisor: true,
  attendance: true,
} satisfies Prisma.ShiftInclude;

export type ShiftWithRelations = Prisma.ShiftGetPayload<{ include: typeof shiftInclude }>;

export function computeDuration(startAt: Date, endAt: Date): number {
  return differenceInMinutes(endAt, startAt);
}

/** Record one line on the shift timeline. */
export async function recordEvent(
  shiftId: string,
  guardId: string,
  type: CheckInType,
  opts: { note?: string; source?: CheckInSource; at?: Date; smsMessageId?: string | null } = {},
) {
  return db.shiftCheckIn.create({
    data: { shiftId, guardId, type, note: opts.note, source: opts.source ?? "SYSTEM", at: opts.at ?? new Date(), smsMessageId: opts.smsMessageId ?? undefined },
  });
}

export type CreateShiftInput = {
  guardId: string;
  locationId: string;
  supervisorId?: string | null;
  startAt: Date;
  endAt: Date;
  instructions?: string | null;
  notes?: string | null;
  recurrenceId?: string | null;
  actorUserId?: string | null;
  actorName?: string;
  /** Optional geofence override for this shift (both coordinates or neither). */
  geofenceLatitude?: number | null;
  geofenceLongitude?: number | null;
  geofenceRadiusM?: number | null;
  geofenceNote?: string | null;
};

export async function createShift(input: CreateShiftInput) {
  if (input.endAt <= input.startAt) throw new Error("Shift end must be after the start.");
  const duration = computeDuration(input.startAt, input.endAt);
  if (duration > 24 * 60) throw new Error("A shift cannot be longer than 24 hours.");

  const overlap = await db.shift.findFirst({
    where: {
      guardId: input.guardId,
      status: { notIn: ["CANCELLED"] },
      startAt: { lt: input.endAt },
      endAt: { gt: input.startAt },
    },
  });
  if (overlap) throw new Error("This guard already has a shift that overlaps those times.");

  const location = await db.location.findUniqueOrThrow({ where: { id: input.locationId } });
  const shift = await db.shift.create({
    data: {
      guardId: input.guardId,
      locationId: input.locationId,
      supervisorId: input.supervisorId ?? location.supervisorId,
      startAt: input.startAt,
      endAt: input.endAt,
      durationMinutes: duration,
      instructions: input.instructions ?? null,
      notes: input.notes ?? null,
      recurrenceId: input.recurrenceId ?? null,
      geofenceLatitude: input.geofenceLatitude ?? null,
      geofenceLongitude: input.geofenceLongitude ?? null,
      geofenceRadiusM: input.geofenceLatitude != null ? input.geofenceRadiusM ?? null : null,
      geofenceNote: input.geofenceLatitude != null ? input.geofenceNote ?? null : null,
      attendance: { create: {} },
    },
    include: shiftInclude,
  });
  await audit({
    userId: input.actorUserId,
    actor: input.actorName ?? (input.recurrenceId ? "system (recurrence)" : "system"),
    action: "SHIFT_CREATED",
    entity: "Shift",
    entityId: shift.id,
    details: { guard: `${shift.guard.firstName} ${shift.guard.lastName}`, location: shift.location.name, startAt: shift.startAt.toISOString(), endAt: shift.endAt.toISOString(), ...(shift.geofenceLatitude != null ? { geofenceOverride: { latitude: shift.geofenceLatitude, longitude: shift.geofenceLongitude, radiusM: shift.geofenceRadiusM ?? shift.location.geofenceRadiusM, note: shift.geofenceNote } } : {}) },
  });
  return shift;
}

export type UpdateShiftInput = {
  guardId: string;
  locationId: string;
  supervisorId?: string | null;
  startAt: Date;
  endAt: Date;
  instructions?: string | null;
  notes?: string | null;
  geofenceLatitude?: number | null;
  geofenceLongitude?: number | null;
  geofenceRadiusM?: number | null;
  geofenceNote?: string | null;
};

/**
 * Change an open shift. The policy in lib/shift-edit.ts decides whether the schedule itself may
 * move; paperwork can always be corrected. A moved geofence or schedule bumps configVersion so the
 * guard phone re-downloads the shift rather than keeping the old window.
 */
export async function updateShift(shiftId: string, input: UpdateShiftInput, actor: { userId: string; name: string }) {
  const before = await db.shift.findUniqueOrThrow({ where: { id: shiftId }, include: { ...shiftInclude, attendance: true } });
  const policy = editPolicy({ status: before.status, arrivalConfirmedAt: before.attendance?.arrivalConfirmedAt ?? null, arrivalSmsSentAt: before.arrivalSmsSentAt });
  if (!policy.canEdit) throw new Error(policy.reason ?? "This shift cannot be edited.");

  const movesSchedule =
    before.guardId !== input.guardId ||
    before.locationId !== input.locationId ||
    before.startAt.getTime() !== input.startAt.getTime() ||
    before.endAt.getTime() !== input.endAt.getTime();
  if (movesSchedule && !policy.canMoveSchedule) throw new Error(policy.reason ?? "The schedule of this shift can no longer be changed.");

  if (input.endAt <= input.startAt) throw new Error("Shift end must be after the start.");
  const duration = computeDuration(input.startAt, input.endAt);
  if (duration > 24 * 60) throw new Error("A shift cannot be longer than 24 hours.");

  if (movesSchedule) {
    const overlap = await db.shift.findFirst({
      where: { id: { not: shiftId }, guardId: input.guardId, status: { notIn: ["CANCELLED"] }, startAt: { lt: input.endAt }, endAt: { gt: input.startAt } },
    });
    if (overlap) throw new Error("This guard already has a shift that overlaps those times.");
  }

  const location = await db.location.findUniqueOrThrow({ where: { id: input.locationId } });
  const fenceMoved =
    before.geofenceLatitude !== (input.geofenceLatitude ?? null) ||
    before.geofenceLongitude !== (input.geofenceLongitude ?? null) ||
    before.geofenceRadiusM !== (input.geofenceLatitude != null ? input.geofenceRadiusM ?? null : null);

  const shift = await db.shift.update({
    where: { id: shiftId },
    data: {
      guardId: input.guardId,
      locationId: input.locationId,
      supervisorId: input.supervisorId ?? location.supervisorId,
      startAt: input.startAt,
      endAt: input.endAt,
      durationMinutes: duration,
      instructions: input.instructions ?? null,
      notes: input.notes ?? null,
      geofenceLatitude: input.geofenceLatitude ?? null,
      geofenceLongitude: input.geofenceLongitude ?? null,
      geofenceRadiusM: input.geofenceLatitude != null ? input.geofenceRadiusM ?? null : null,
      geofenceNote: input.geofenceLatitude != null ? input.geofenceNote ?? null : null,
      ...(movesSchedule || fenceMoved ? { configVersion: { increment: 1 } } : {}),
    },
    include: shiftInclude,
  });

  const changes: string[] = [];
  if (before.guardId !== shift.guardId) changes.push(`guard ${before.guard.firstName} ${before.guard.lastName} → ${shift.guard.firstName} ${shift.guard.lastName}`);
  if (before.locationId !== shift.locationId) changes.push(`site ${before.location.name} → ${shift.location.name}`);
  if (before.startAt.getTime() !== shift.startAt.getTime() || before.endAt.getTime() !== shift.endAt.getTime()) changes.push("times changed");
  if (fenceMoved) changes.push(shift.geofenceLatitude != null ? "shift geofence set" : "shift geofence removed");
  if (changes.length) await recordEvent(shift.id, shift.guardId, "ADMIN_NOTE", { source: "ADMIN", note: `Shift edited by ${actor.name}: ${changes.join("; ")}.` });

  await audit({
    userId: actor.userId, actor: actor.name, action: "SHIFT_UPDATED", entity: "Shift", entityId: shiftId,
    details: {
      before: { guardId: before.guardId, locationId: before.locationId, startAt: before.startAt.toISOString(), endAt: before.endAt.toISOString(), geofence: { latitude: before.geofenceLatitude, longitude: before.geofenceLongitude, radiusM: before.geofenceRadiusM } },
      after: { guardId: shift.guardId, locationId: shift.locationId, startAt: shift.startAt.toISOString(), endAt: shift.endAt.toISOString(), geofence: { latitude: shift.geofenceLatitude, longitude: shift.geofenceLongitude, radiusM: shift.geofenceRadiusM } },
      configVersion: shift.configVersion,
    },
  });
  return shift;
}

/**
 * Remove a shift outright. Only ever allowed while nothing has happened on it; everything else is
 * cancelled, not deleted. The audit entry keeps a snapshot so the removal itself is on the record.
 */
export async function deleteShift(shiftId: string, actor: { userId: string; name: string }) {
  const shift = await db.shift.findUniqueOrThrow({ where: { id: shiftId }, include: { ...shiftInclude, attendance: true } });
  const counts = await shiftTraceCounts(shiftId);
  const policy = deletePolicy({ status: shift.status, arrivalConfirmedAt: shift.attendance?.arrivalConfirmedAt ?? null }, counts);
  if (!policy.canDelete) throw new Error(policy.reason ?? "This shift cannot be deleted.");

  await db.$transaction([
    db.attendance.deleteMany({ where: { shiftId } }),
    db.shift.delete({ where: { id: shiftId } }),
  ]);
  await audit({
    userId: actor.userId, actor: actor.name, action: "SHIFT_DELETED", entity: "Shift", entityId: shiftId,
    details: { guard: `${shift.guard.firstName} ${shift.guard.lastName}`, location: shift.location.name, startAt: shift.startAt.toISOString(), endAt: shift.endAt.toISOString(), status: shift.status },
  });
  return shift;
}

/** Everything that would make a shift part of the operational record. */
export async function shiftTraceCounts(shiftId: string): Promise<ShiftTraceCounts> {
  const [checkIns, welfareChecks, incidents, smsMessages, callLogs, locationEvents, alerts, notifications, evidence, networkChecks] = await Promise.all([
    db.shiftCheckIn.count({ where: { shiftId } }),
    db.welfareCheck.count({ where: { shiftId } }),
    db.incident.count({ where: { shiftId } }),
    db.smsMessage.count({ where: { shiftId } }),
    db.callLog.count({ where: { shiftId } }),
    db.locationEvent.count({ where: { shiftId } }),
    db.guardAlert.count({ where: { shiftId } }),
    db.notification.count({ where: { shiftId } }),
    db.attendanceEvidence.count({ where: { shiftId } }),
    db.networkLocationCheck.count({ where: { shiftId } }),
  ]);
  return { checkIns, welfareChecks, incidents, smsMessages, callLogs, locationEvents, alerts, notifications, evidence, networkChecks };
}

export async function cancelShift(shiftId: string, actor: { userId: string; name: string }, reason?: string) {
  const shift = await db.shift.update({ where: { id: shiftId }, data: { status: "CANCELLED", pendingPrompt: "NONE" } });
  await recordEvent(shift.id, shift.guardId, "SHIFT_CANCELLED", { note: reason, source: "ADMIN" });
  await audit({ userId: actor.userId, actor: actor.name, action: "SHIFT_CANCELLED", entity: "Shift", entityId: shiftId, details: { reason } });
  return shift;
}

/**
 * The shift an SMS from this guard most likely relates to: a non-closed shift whose window
 * (2 h before start to 3 h after end) contains now; the nearest one if several.
 */
export async function findLiveShiftForGuard(guardId: string, now = new Date()) {
  const candidates = await db.shift.findMany({
    where: {
      guardId,
      status: { notIn: CLOSED_STATUSES },
      startAt: { lte: addMinutes(now, 120) },
      endAt: { gte: addMinutes(now, -180) },
    },
    include: shiftInclude,
    orderBy: { startAt: "asc" },
  });
  if (candidates.length === 0) return null;
  // Prefer a shift that has already been prompted; otherwise the one closest to now.
  const prompted = candidates.find((s) => s.pendingPrompt !== "NONE");
  if (prompted) return prompted;
  return candidates.sort((a, b) => Math.abs(a.startAt.getTime() - now.getTime()) - Math.abs(b.startAt.getTime() - now.getTime()))[0];
}

/** Materialise recurring shifts up to `horizonDays` ahead. Idempotent. */
export async function materialiseRecurrences(horizonDays: number, now = new Date()) {
  const recs = await db.shiftRecurrence.findMany({ where: { active: true, OR: [{ endsOn: null }, { endsOn: { gte: now } }] } });
  let created = 0;
  for (const rec of recs) {
    for (let i = 0; i <= horizonDays; i++) {
      const day = startOfDay(addDays(now, i));
      if (day < startOfDay(rec.startsOn)) continue;
      if (rec.endsOn && day > rec.endsOn) continue;
      if (!rec.daysOfWeek.includes(day.getDay())) continue;
      const [sh, sm] = rec.startTime.split(":").map(Number);
      const [eh, em] = rec.endTime.split(":").map(Number);
      const startAt = setMinutes(setHours(day, sh), sm);
      let endAt = setMinutes(setHours(day, eh), em);
      if (endAt <= startAt) endAt = addDays(endAt, 1);
      if (endAt < now) continue;
      const exists = await db.shift.findFirst({ where: { recurrenceId: rec.id, startAt } });
      if (exists) continue;
      try {
        await createShift({ guardId: rec.guardId, locationId: rec.locationId, supervisorId: rec.supervisorId, startAt, endAt, instructions: rec.instructions, recurrenceId: rec.id });
        created++;
      } catch {
        // overlap with a manual shift — skip quietly
      }
    }
  }
  return created;
}

export const STATUS_META: Record<ShiftStatus, { label: string; tone: "neutral" | "ok" | "warn" | "critical" | "muted" }> = {
  SCHEDULED: { label: "Scheduled", tone: "neutral" },
  AWAITING_ARRIVAL: { label: "Awaiting arrival", tone: "neutral" },
  ON_DUTY: { label: "On duty", tone: "ok" },
  LATE: { label: "Late", tone: "warn" },
  NOT_CONFIRMED: { label: "Not confirmed", tone: "critical" },
  ASSISTANCE: { label: "Assistance required", tone: "warn" },
  INCIDENT: { label: "Incident reported", tone: "critical" },
  CRITICAL: { label: "Emergency", tone: "critical" },
  COMPLETED: { label: "Completed", tone: "ok" },
  MISSED: { label: "Missed", tone: "critical" },
  CANCELLED: { label: "Cancelled", tone: "muted" },
};
