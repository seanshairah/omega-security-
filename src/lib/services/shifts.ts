import { db } from "@/lib/db";
import type { CheckInSource, CheckInType, Prisma, ShiftStatus } from "@prisma/client";
import { addDays, addMinutes, differenceInMinutes, setHours, setMinutes, startOfDay } from "date-fns";
import { audit } from "@/lib/audit";

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
    details: { guard: `${shift.guard.firstName} ${shift.guard.lastName}`, location: shift.location.name, startAt: shift.startAt.toISOString(), endAt: shift.endAt.toISOString() },
  });
  return shift;
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
