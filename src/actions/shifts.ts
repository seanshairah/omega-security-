"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { addDays } from "date-fns";
import { db } from "@/lib/db";
import { shiftSchema, recurrenceSchema, formToObject, firstIssue } from "@/lib/validation";
import { combineDateTime } from "@/lib/time";
import { createShift as createShiftRecord, cancelShift as cancelShiftRecord, materialiseRecurrences, recordEvent } from "@/lib/services/shifts";
import { getSettingNumber } from "@/lib/settings";
import { actor, auditAs, fail, type ActionState } from "./_helpers";

export async function createShift(_: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const user = await actor("ADMIN");
    const r = shiftSchema.safeParse(formToObject(fd));
    if (!r.success) return { error: firstIssue(r.error) };
    const d = r.data;
    const startAt = combineDateTime(d.date, d.startTime);
    let endAt = combineDateTime(d.date, d.endTime);
    if (endAt <= startAt) endAt = addDays(endAt, 1); // overnight
    const s = await createShiftRecord({ guardId: d.guardId, locationId: d.locationId, supervisorId: d.supervisorId, startAt, endAt, instructions: d.instructions, notes: d.notes, actorUserId: user.id, actorName: user.name });
    id = s.id;
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/shifts");
  redirect(`/shifts/${id}`);
}

export async function createRecurrence(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await actor("ADMIN");
    const r = recurrenceSchema.safeParse(formToObject(fd));
    if (!r.success) return { error: firstIssue(r.error) };
    const d = r.data;
    const rec = await db.shiftRecurrence.create({ data: { guardId: d.guardId, locationId: d.locationId, supervisorId: d.supervisorId, daysOfWeek: d.daysOfWeek, startTime: d.startTime, endTime: d.endTime, startsOn: new Date(d.startsOn), endsOn: d.endsOn ? new Date(d.endsOn) : null, instructions: d.instructions } });
    await auditAs(user, "RECURRENCE_CREATED", "ShiftRecurrence", rec.id, { days: d.daysOfWeek, start: d.startTime, end: d.endTime });
    await materialiseRecurrences(await getSettingNumber("recurrence.horizonDays"));
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/shifts");
  redirect("/shifts?view=recurring");
}

export async function setRecurrenceActive(id: string, active: boolean) {
  const user = await actor("ADMIN");
  await db.shiftRecurrence.update({ where: { id }, data: { active } });
  if (!active) await db.shift.updateMany({ where: { recurrenceId: id, status: "SCHEDULED", startAt: { gt: new Date() } }, data: { status: "CANCELLED" } });
  await auditAs(user, active ? "RECURRENCE_RESUMED" : "RECURRENCE_STOPPED", "ShiftRecurrence", id);
  revalidatePath("/shifts");
}

export async function cancelShift(id: string, reason: string) {
  const user = await actor("ADMIN");
  await cancelShiftRecord(id, { userId: user.id, name: user.name }, reason);
  revalidatePath("/shifts");
  revalidatePath(`/shifts/${id}`);
}

export async function reassignShift(id: string, guardId: string) {
  const user = await actor("ADMIN");
  const s = await db.shift.findUniqueOrThrow({ where: { id }, include: { guard: true } });
  if (s.status !== "SCHEDULED") throw new Error("Only scheduled shifts can be reassigned.");
  const g = await db.guard.findUniqueOrThrow({ where: { id: guardId } });
  await db.shift.update({ where: { id }, data: { guardId } });
  await recordEvent(id, guardId, "ADMIN_NOTE", { source: "ADMIN", note: `Reassigned from ${s.guard.firstName} ${s.guard.lastName} to ${g.firstName} ${g.lastName} by ${user.name}.` });
  await auditAs(user, "SHIFT_REASSIGNED", "Shift", id, { from: `${s.guard.firstName} ${s.guard.lastName}`, to: `${g.firstName} ${g.lastName}` });
  revalidatePath(`/shifts/${id}`);
}

/** Manual attendance override by an admin (guard phoned in, SMS failed, etc). */
export async function manualArrival(id: string, note: string) {
  const user = await actor("ADMIN");
  const s = await db.shift.findUniqueOrThrow({ where: { id }, include: { attendance: true } });
  const now = new Date();
  const lateMinutes = Math.max(0, Math.round((now.getTime() - s.startAt.getTime()) / 60000));
  const grace = await getSettingNumber("arrival.graceMinutes");
  await db.attendance.update({ where: { shiftId: id }, data: { status: lateMinutes > grace ? "LATE" : "PRESENT", arrivalConfirmedAt: now, lateMinutes } });
  await db.shift.update({ where: { id }, data: { status: "ON_DUTY", pendingPrompt: s.pendingPrompt === "ARRIVAL" ? "NONE" : s.pendingPrompt } });
  await recordEvent(id, s.guardId, "ARRIVAL_CONFIRMED", { source: "ADMIN", note: `Arrival confirmed manually by ${user.name}. ${note}`.trim() });
  await auditAs(user, "ATTENDANCE_CONFIRMED_MANUALLY", "Shift", id, { note });
  revalidatePath(`/shifts/${id}`);
  revalidatePath("/operations");
}

export async function manualComplete(id: string, note: string) {
  const user = await actor("ADMIN");
  const s = await db.shift.findUniqueOrThrow({ where: { id } });
  const now = new Date();
  await db.attendance.update({ where: { shiftId: id }, data: { status: "COMPLETED", completionConfirmedAt: now } });
  await db.shift.update({ where: { id }, data: { status: "COMPLETED", pendingPrompt: "NONE" } });
  await recordEvent(id, s.guardId, "COMPLETION_CONFIRMED", { source: "ADMIN", note: `Completed manually by ${user.name}. ${note}`.trim() });
  await recordEvent(id, s.guardId, "SHIFT_COMPLETED", { note: "Shift completed." });
  await auditAs(user, "SHIFT_COMPLETED_MANUALLY", "Shift", id, { note });
  revalidatePath(`/shifts/${id}`);
  revalidatePath("/operations");
}

export async function addShiftNote(id: string, note: string) {
  const user = await actor("SUPERVISOR");
  const s = await db.shift.findUniqueOrThrow({ where: { id } });
  await recordEvent(id, s.guardId, "ADMIN_NOTE", { source: "ADMIN", note: `${user.name}: ${note}` });
  revalidatePath(`/shifts/${id}`);
}
