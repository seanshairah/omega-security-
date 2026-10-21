/**
 * Call attendance: a guard without the guard app calls an operations gateway phone, and the call
 * clocks them in, confirms they are well, or clocks them out. The rules are in
 * call-attendance-rules.ts; this applies them to the database.
 *
 * It runs when a call reaches its end (answered and hung up, or missed), because only then is it
 * known whether anybody answered and for how long. The call's own start time is used throughout, so
 * a call the gateway saved offline and synced hours later is judged against the shift as it was,
 * and a shift the engine has since closed is never reopened by it.
 *
 * Nothing here needs GPS, mobile data on the guard's phone, or a carrier location service.
 */
import type { EvidenceKind } from "@prisma/client";
import { db } from "@/lib/db";
import { getSettings, getSettingNumber } from "@/lib/settings";
import { recordEvent } from "@/lib/services/shifts";
import { notify } from "@/lib/notifications";
import { audit } from "@/lib/audit";
import { fmtTime } from "@/lib/time";
import { fmtCallDuration } from "@/lib/gateway/call-state";
import { decideCall, parseCallPolicy, pickShiftForAttendanceCall, type CallIntent, type ShiftFacts } from "./call-attendance-rules";
import { recordEvidence, FLAG_LABEL } from "./evidence";

const CLOSED = ["COMPLETED", "MISSED"] as const;
const BEFORE_ARRIVAL = ["SCHEDULED", "AWAITING_ARRIVAL", "LATE", "NOT_CONFIRMED"] as const;
/** A call that reaches the server this long after it started is marked as synced late. */
const LATE_SYNC_MS = 10 * 60_000;

const KIND: Record<CallIntent, EvidenceKind> = { CHECK_IN: "CHECK_IN", WELFARE: "WELFARE", CHECK_OUT: "CHECK_OUT" };
const INTENT_WORD: Record<CallIntent, string> = { CHECK_IN: "clock-in", WELFARE: "welfare call", CHECK_OUT: "clock-out" };

export async function callAttendancePolicy() {
  return parseCallPolicy(await getSettings());
}

/**
 * Decide and apply what one ended call means. Idempotent: the evidence row is keyed by the call, so
 * a re-sent event or a second pass returns "already handled" and changes nothing.
 */
export async function processAttendanceCall(callLogId: string, now = new Date()): Promise<string> {
  const call = await db.callLog.findUnique({ where: { id: callLogId }, include: { gateway: true, guard: true } });
  if (!call) return "call not found";
  if (call.gateway.mode !== "OPERATIONS_GATEWAY") return "not an operations gateway call";
  if (call.direction !== "INCOMING") return "outgoing call";
  if (call.status !== "ENDED" && call.status !== "MISSED") return "call still in progress";
  const guard = call.guard;
  if (!guard) return "caller not identified";
  if (!guard.callAttendanceEnabled) return "call attendance off for this guard";
  // A guard with the guard app clocks in by GPS on their own phone; their calls stay calls.
  if (guard.deviceKind === "ANDROID_GUARD") return "guard uses the guard app";

  const policy = await callAttendancePolicy();
  if (!policy.enabled) return "call attendance is off";
  const t = call.startedAt;
  const candidates = await db.shift.findMany({
    where: {
      guardId: guard.id, status: { not: "CANCELLED" },
      startAt: { lte: new Date(t.getTime() + policy.checkInBeforeMinutes * 60_000) },
      endAt: { gte: new Date(t.getTime() - policy.checkOutAfterMinutes * 60_000) },
    },
    include: { attendance: true, location: { select: { id: true, name: true, defaultGatewayId: true } } },
    orderBy: { startAt: "asc" },
    take: 10,
  });
  const facts = candidates.map((s) => ({
    id: s.id, startAt: s.startAt, endAt: s.endAt, closed: (CLOSED as readonly string[]).includes(s.status),
    checkedInAt: s.attendance?.arrivalConfirmedAt ?? null, checkedOutAt: s.attendance?.completionConfirmedAt ?? null,
  }));
  const pick = pickShiftForAttendanceCall(t, facts, policy);
  if ("none" in pick) return "no shift around this call";

  const lateSync = now.getTime() - (call.endedAt ?? t).getTime() > LATE_SYNC_MS;
  if ("ambiguous" in pick) {
    // Two shifts are equally likely. A person says which; nothing is applied.
    for (const f of pick.ambiguous) {
      await recordEvidence({ shiftId: f.id, guardId: guard.id, kind: "CHECK_IN", source: call.status === "MISSED" ? "MISSED_CALL" : "CALL", status: "PENDING", occurredAt: t, dedupeKey: `call:${call.id}:${f.id}`, callLogId: call.id, gatewayDeviceId: call.gatewayDeviceId, flags: ["AMBIGUOUS", ...(lateSync ? ["LATE_SYNC"] : [])], note: `The call matches ${pick.ambiguous.length} shifts. Choose the right one.` });
    }
    await notifyPending(guard, pick.ambiguous[0].id, `${guard.firstName} ${guard.lastName} called at ${fmtTime(t)} and the call matches ${pick.ambiguous.length} shifts. Say which one it was.`);
    return `ambiguous: ${pick.ambiguous.length} shifts`;
  }

  const shift = candidates.find((s) => s.id === pick.shift.id)!;
  const expectedId = guard.assignedGatewayId ?? shift.location.defaultGatewayId ?? null;
  const expectedGateway = expectedId ? expectedId === call.gatewayDeviceId : null;
  const decision = decideCall(
    { startedAt: t, direction: call.direction, answered: call.status === "ENDED" && (Boolean(call.answeredAt) || (call.durationSeconds ?? 0) > 0), missed: call.status === "MISSED" || (call.status === "ENDED" && !call.answeredAt && !(call.durationSeconds ?? 0)), durationSeconds: call.durationSeconds },
    pick.shift as ShiftFacts, policy, expectedGateway,
  );
  if (decision.action === "IGNORE") return decision.reason;

  const flags = [...decision.flags, ...(lateSync ? ["LATE_SYNC"] : [])];
  const how = call.status === "MISSED" ? "missed call" : `answered, ${fmtCallDuration(call.durationSeconds)}`;
  const { evidence, created } = await recordEvidence({
    shiftId: shift.id, guardId: guard.id, kind: KIND[decision.intent], source: decision.source, status: decision.status,
    occurredAt: t, dedupeKey: `call:${call.id}`, callLogId: call.id, gatewayDeviceId: call.gatewayDeviceId, flags, note: decision.reason,
  });
  if (!created) return "already handled";
  if (!call.shiftId) await db.callLog.update({ where: { id: call.id }, data: { shiftId: shift.id } });

  const word = INTENT_WORD[decision.intent];
  const flagText = flags.length ? ` (${flags.map((f) => FLAG_LABEL[f] ?? f).join(", ")})` : "";
  if (decision.status === "CONFIRMED" || decision.status === "PROVISIONAL") {
    await applyIntent(shift.id, decision.intent, t, `${decision.status === "PROVISIONAL" ? "Provisional " : ""}${word} by call (${how}) on ${call.gateway.deviceName}${flagText}. A call is not location evidence.`, decision.status === "CONFIRMED");
    return `${word} ${decision.status.toLowerCase()}`;
  }
  if (decision.status === "REJECTED") {
    await recordEvent(shift.id, guard.id, "ADMIN_NOTE", { at: t, source: "SYSTEM", note: `Call at ${fmtTime(t)} not used as a ${word}: ${decision.reason}${flagText}.` });
    return `${word} rejected: ${decision.reason}`;
  }
  // PENDING
  if (decision.sendSmsConfirm && (decision.intent === "CHECK_IN" || decision.intent === "CHECK_OUT")) {
    const sent = await askBySms(shift.id, decision.intent);
    if (sent) await db.attendanceEvidence.update({ where: { id: evidence.id }, data: { flags: [...flags, "SMS_CONFIRM_SENT"] } });
  }
  await recordEvent(shift.id, guard.id, "ADMIN_NOTE", { at: t, source: "SYSTEM", note: `Call at ${fmtTime(t)} (${how}) held as a pending ${word}: ${decision.reason}${flagText}.` });
  await notifyPending(guard, shift.id, `${guard.firstName} ${guard.lastName} called ${call.gateway.deviceName} at ${fmtTime(t)} (${how}). Pending ${word}: ${decision.reason}.`);
  return `${word} pending: ${decision.reason}`;
}

async function notifyPending(guard: { id: string; firstName: string; lastName: string }, shiftId: string, body: string) {
  await notify({ type: "CALL_ATTENDANCE_PENDING", severity: "WARNING", title: `Call attendance to confirm · ${guard.firstName} ${guard.lastName}`, body, guardId: guard.id, shiftId, url: `/shifts/${shiftId}#attendance-evidence` }).catch(() => undefined);
}

/** Ask the guard to confirm by SMS: the existing arrival or completion question, answered with YES. */
async function askBySms(shiftId: string, intent: "CHECK_IN" | "CHECK_OUT"): Promise<boolean> {
  const { sendTemplated } = await import("@/lib/sms/outbound");
  const { shiftInclude } = await import("@/lib/services/shifts");
  const s = await db.shift.findUnique({ where: { id: shiftId }, include: shiftInclude });
  if (!s || !s.guard.smsAttendanceEnabled) return false;
  const now = new Date();
  if (intent === "CHECK_IN") {
    await db.shift.update({ where: { id: shiftId }, data: { pendingPrompt: "ARRIVAL", ...(s.status === "SCHEDULED" ? { status: "AWAITING_ARRIVAL" } : {}), arrivalSmsSentAt: s.arrivalSmsSentAt ?? now } });
    await sendTemplated(s, "ARRIVAL", "ARRIVAL");
  } else {
    await db.shift.update({ where: { id: shiftId }, data: { pendingPrompt: "COMPLETION", completionSmsSentAt: s.completionSmsSentAt ?? now } });
    await sendTemplated(s, "COMPLETION", "COMPLETION");
  }
  return true;
}

/**
 * What a confirmed (or provisional) call does to the shift: the same effect as the guard's SMS reply,
 * written with its source so it is never mistaken for GPS.
 */
export async function applyIntent(shiftId: string, intent: CallIntent, at: Date, note: string, notifyClient = true): Promise<void> {
  const s = await db.shift.findUniqueOrThrow({ where: { id: shiftId }, include: { attendance: true, guard: true, location: true } });
  const who = `${s.guard.firstName} ${s.guard.lastName}`;
  if (!s.attendance) await db.attendance.createMany({ data: [{ shiftId }], skipDuplicates: true });
  if (intent === "CHECK_IN") {
    const grace = await getSettingNumber("arrival.graceMinutes");
    const lateMinutes = Math.max(0, Math.round((at.getTime() - s.startAt.getTime()) / 60_000));
    const late = lateMinutes > grace;
    // Only the first arrival counts; a second confirmation changes nothing.
    const r = await db.attendance.updateMany({ where: { shiftId, arrivalConfirmedAt: null }, data: { arrivalConfirmedAt: at, lateMinutes, status: late ? "LATE" : "PRESENT" } });
    if (r.count === 0) return;
    if ((BEFORE_ARRIVAL as readonly string[]).includes(s.status)) await db.shift.update({ where: { id: shiftId }, data: { status: "ON_DUTY", ...(s.pendingPrompt === "ARRIVAL" ? { pendingPrompt: "NONE" } : {}) } });
    await recordEvent(shiftId, s.guardId, "ARRIVAL_CONFIRMED", { at, source: "SYSTEM", note });
    if (late) await notify({ type: "GUARD_LATE", severity: "WARNING", title: `${who} clocked in late at ${s.location.name}`, body: `By call at ${fmtTime(at)}, ${lateMinutes} min after the ${fmtTime(s.startAt)} start.`, guardId: s.guardId, shiftId }).catch(() => undefined);
    if (notifyClient) {
      const { onGuardArrived } = await import("@/lib/client-notifications/rules");
      await onGuardArrived(shiftId, "GUARD_ARRIVED", `shift:${shiftId}:call`, at).catch(() => undefined);
    }
    return;
  }
  if (intent === "WELFARE") {
    await db.welfareCheck.updateMany({ where: { shiftId, response: "PENDING" }, data: { response: "WELL", respondedAt: at } });
    if (s.pendingPrompt === "WELFARE") await db.shift.update({ where: { id: shiftId }, data: { pendingPrompt: "NONE", ...(s.status === "LATE" ? { status: "ON_DUTY" } : {}) } });
    await recordEvent(shiftId, s.guardId, "WELFARE_OK", { at, source: "SYSTEM", note });
    return;
  }
  const r = await db.attendance.updateMany({ where: { shiftId, completionConfirmedAt: null }, data: { completionConfirmedAt: at, status: "COMPLETED" } });
  if (r.count === 0) return;
  await db.shift.update({ where: { id: shiftId }, data: { status: "COMPLETED", pendingPrompt: "NONE" } });
  await recordEvent(shiftId, s.guardId, "COMPLETION_CONFIRMED", { at, source: "SYSTEM", note });
  await recordEvent(shiftId, s.guardId, "SHIFT_COMPLETED", { at, source: "SYSTEM", note: "Shift completed." });
  if (notifyClient) {
    const { onShiftUpdate } = await import("@/lib/client-notifications/rules");
    await onShiftUpdate(shiftId, "SHIFT_ENDED", at, shiftId).catch(() => undefined);
  }
}

/**
 * A supervisor settles a pending or provisional record. Approving applies it (once); rejecting a
 * provisional clock-in undoes it, so the shift reads "not confirmed" again.
 */
export async function decideEvidence(id: string, approve: boolean, actor: { id: string; name: string }, note?: string | null) {
  const e = await db.attendanceEvidence.findUnique({ where: { id } });
  if (!e) throw new Error("Attendance record not found.");
  if (e.status !== "PENDING" && e.status !== "PROVISIONAL") throw new Error(`Already ${e.status.toLowerCase()}.`);
  const claimed = await db.attendanceEvidence.updateMany({ where: { id, status: e.status }, data: { status: approve ? "CONFIRMED" : "REJECTED", decidedById: actor.id, decidedAt: new Date(), decisionNote: note?.trim() || null } });
  if (claimed.count === 0) throw new Error("Someone else has just decided this one.");
  const word = e.kind === "CHECK_IN" ? "clock-in" : e.kind === "CHECK_OUT" ? "clock-out" : "welfare call";
  if (approve && e.status === "PENDING" && e.kind !== "PRESENCE") {
    await applyIntent(e.shiftId, e.kind as CallIntent, e.occurredAt, `${word[0].toUpperCase()}${word.slice(1)} by ${e.source === "MISSED_CALL" ? "missed call" : e.source.toLowerCase()} at ${fmtTime(e.occurredAt)}, confirmed by ${actor.name}${note ? `: ${note}` : ""}.`);
  }
  if (!approve && e.status === "PROVISIONAL" && e.kind === "CHECK_IN") {
    // Undo exactly what the provisional record applied, and only if nothing else confirmed arrival since.
    const others = await db.attendanceEvidence.count({ where: { shiftId: e.shiftId, kind: "CHECK_IN", status: "CONFIRMED", id: { not: id } } });
    if (!others) {
      await db.attendance.updateMany({ where: { shiftId: e.shiftId, arrivalConfirmedAt: e.occurredAt }, data: { arrivalConfirmedAt: null, lateMinutes: 0, status: "NOT_REPORTED" } });
      await db.shift.updateMany({ where: { id: e.shiftId, status: "ON_DUTY" }, data: { status: "NOT_CONFIRMED" } });
    }
  }
  await recordEvent(e.shiftId, e.guardId, "ADMIN_NOTE", { source: "ADMIN", note: `${actor.name} ${approve ? "confirmed" : "rejected"} the ${word} recorded at ${fmtTime(e.occurredAt)}${note ? `: ${note}` : ""}.` });
  await audit({ userId: actor.id, actor: actor.name, action: approve ? "ATTENDANCE_EVIDENCE_CONFIRMED" : "ATTENDANCE_EVIDENCE_REJECTED", entity: "AttendanceEvidence", entityId: id, details: { shiftId: e.shiftId, kind: e.kind, source: e.source, was: e.status, note: note ?? undefined } });
}
