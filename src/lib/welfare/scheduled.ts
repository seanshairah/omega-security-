/**
 * Scheduled welfare checks: the database side of `welfare-rules.ts`.
 *
 * `runWelfareSchedule(now)` runs on every automation tick. It creates the checks that have come due
 * for sites with a welfare schedule, places them by the site's channel, and moves unanswered ones
 * along: retry, SMS fallback, escalation. `applyVoiceReport` takes a voice provider's webhook.
 *
 * Sites without a schedule keep the single mid-shift welfare SMS of the engine's steps 5 and 6.
 *
 * Every reply path that already settles welfare checks (an SMS reply, a guard's call to the
 * gateway, a supervisor confirming) settles scheduled ones too: they all mark the shift's PENDING
 * checks, so nothing here has to listen for them.
 */
import type { Prisma, WelfareCallStatus, WelfareCheck, WelfareResponse } from "@prisma/client";
import { db } from "@/lib/db";
import { getSettingNumber } from "@/lib/settings";
import { notify } from "@/lib/notifications";
import { sendTemplated } from "@/lib/sms/outbound";
import { sendClientUpdate } from "@/lib/sms/client-updates";
import { recordEvent, shiftInclude, ON_SITE_STATUSES, type ShiftWithRelations } from "@/lib/services/shifts";
import { createIncident } from "@/lib/services/incidents";
import { recordEvidence, settlePendingCalls } from "@/lib/attendance/evidence";
import { fmtTime } from "@/lib/time";
import { voiceProvider, type VoiceReport } from "@/lib/voice/provider";
import { hasSchedule, mapVoiceReport, nextFollowUp, welfareDuePoints } from "./welfare-rules";

/** A due point older than this when the engine first sees it is skipped, not sent late. */
export const WELFARE_CATCH_UP_MINUTES = 30;
const ACTOR = { userId: null, name: "welfare schedule" };

export type WelfareRunReport = { created: number; placed: number; retried: number; smsFallbacks: number; escalated: number; closed: number; errors: string[] };

type CheckWithShift = WelfareCheck & { shift: ShiftWithRelations };

const scheduledSite = { OR: [{ welfareTimes: { not: null } }, { welfareIntervalMinutes: { not: null } }] } satisfies Prisma.LocationWhereInput;

/** For the engine's steps 5 and 6: shifts at sites with no schedule keep the single welfare SMS. */
export const unscheduledSite = { welfareTimes: null, welfareIntervalMinutes: null } satisfies Prisma.LocationWhereInput;

export async function runWelfareSchedule(now = new Date()): Promise<WelfareRunReport> {
  const report: WelfareRunReport = { created: 0, placed: 0, retried: 0, smsFallbacks: 0, escalated: 0, closed: 0, errors: [] };
  await createDueChecks(now, report);
  await followUp(now, report);
  return report;
}

async function createDueChecks(now: Date, report: WelfareRunReport) {
  const shifts = await db.shift.findMany({
    where: { status: { in: ON_SITE_STATUSES }, startAt: { lt: now }, endAt: { gt: now }, guard: { welfareExempt: false }, location: scheduledSite },
    include: shiftInclude,
  });
  for (const s of shifts) {
    const schedule = { times: s.location.welfareTimes, intervalMinutes: s.location.welfareIntervalMinutes };
    if (!hasSchedule(schedule)) continue;
    // Never interrupt a guard who is describing an incident; the point is picked up on a later tick.
    if (s.pendingPrompt === "INCIDENT_DESCRIPTION") continue;
    let points: Date[];
    try { points = welfareDuePoints(s.startAt, s.endAt, schedule); } catch (e) { report.errors.push(`welfare schedule ${s.locationId}: ${(e as Error).message}`); continue; }
    const due = points.filter((p) => p <= now && now.getTime() - p.getTime() <= WELFARE_CATCH_UP_MINUTES * 60_000);
    for (const dueAt of due) {
      try {
        const scheduleKey = `${s.id}:${dueAt.toISOString()}`;
        const { count } = await db.welfareCheck.createMany({
          data: [{ shiftId: s.id, scheduleKey, dueAt, sentAt: now, channel: s.location.welfareChannel, callStatus: s.location.welfareChannel === "SMS" ? null : "CALL_SCHEDULED", attempts: 1, lastAttemptAt: now }],
          skipDuplicates: true,
        });
        if (!count) continue;
        report.created++;
        const check = (await db.welfareCheck.findUnique({ where: { scheduleKey } }))!;
        const n = points.findIndex((p) => p.getTime() === dueAt.getTime()) + 1;
        await place({ ...check, shift: s }, now, `Scheduled welfare check ${n} of ${points.length} (due ${fmtTime(dueAt)})`);
        report.placed++;
      } catch (e) {
        report.errors.push(`welfare ${s.id}: ${(e as Error).message}`);
      }
    }
  }
}

/** Ask the guard by the check's channel. A call that cannot be placed is marked FAILED and followed up. */
async function place(c: CheckWithShift, now: Date, why: string): Promise<void> {
  const s = c.shift;
  if (c.channel === "SMS") return sendWelfareSms(c, now, why);

  if (c.channel === "VOICE") {
    const provider = voiceProvider();
    if (!provider) {
      // No provider contracted: the check goes straight to text, if the guard can receive one.
      await db.welfareCheck.update({ where: { id: c.id }, data: { callStatus: "FAILED", note: "No voice provider is configured." } });
      if (s.location.welfareSmsFallback && s.guard.smsAttendanceEnabled) return smsFallback(c, now, `${why}. No voice provider is configured, so it was sent by SMS.`);
      return escalate({ ...c, callStatus: "FAILED" }, now, "No voice provider is configured and SMS fallback is off.");
    }
    const r = await provider.placeWelfareCall({ to: s.guard.phone, guardName: s.guard.firstName, reference: c.id });
    await db.welfareCheck.update({
      where: { id: c.id },
      data: r.ok
        ? { callStatus: "CALL_INITIATED", provider: provider.name, providerCallId: r.providerCallId, lastAttemptAt: now }
        : { callStatus: "FAILED", provider: provider.name, lastAttemptAt: now, note: `Call not placed: ${r.error}` },
    });
    await recordEvent(s.id, s.guardId, "CALL_OUTGOING", { at: now, note: `${why}: ${r.ok ? `welfare call placed through ${provider.name}${provider.simulated ? " (simulated, not a real call)" : ""}` : `welfare call could not be placed (${r.error})`}, attempt ${c.attempts}.` });
    return;
  }

  // GATEWAY_CALL: the operations phone rings the guard once the operator confirms on it.
  const { createCallRequest, CallRequestError } = await import("@/lib/gateway/call-requests");
  try {
    const { request } = await createCallRequest({ guardId: s.guardId, shiftId: s.id, reason: "Welfare check", idempotencyKey: `welfare:${c.id}:${c.attempts}`, actor: ACTOR }, now);
    await db.welfareCheck.update({ where: { id: c.id }, data: { callStatus: "CALL_INITIATED", provider: "gateway", callRequestId: request.id, lastAttemptAt: now } });
    await recordEvent(s.id, s.guardId, "CALL_OUTGOING", { at: now, note: `${why}: welfare call queued on the operations phone, attempt ${c.attempts}.` });
  } catch (e) {
    const msg = e instanceof CallRequestError ? e.message : (e as Error).message;
    await db.welfareCheck.update({ where: { id: c.id }, data: { callStatus: "FAILED", provider: "gateway", lastAttemptAt: now, note: `Call not placed: ${msg}` } });
    await recordEvent(s.id, s.guardId, "CALL_OUTGOING", { at: now, note: `${why}: the welfare call could not be queued (${msg}).` });
  }
}

async function sendWelfareSms(c: CheckWithShift, now: Date, why: string) {
  const s = c.shift;
  await db.shift.update({ where: { id: s.id }, data: { pendingPrompt: "WELFARE", welfareSmsSentAt: now } });
  const msg = await sendTemplated(s, "WELFARE", "WELFARE");
  await recordEvent(s.id, s.guardId, "WELFARE_SMS_SENT", { at: now, note: `${why}${c.attempts > 1 ? `, text ${c.attempts}` : ""}.`, smsMessageId: msg.id });
}

async function smsFallback(c: CheckWithShift, now: Date, note: string) {
  const s = c.shift;
  await db.welfareCheck.update({ where: { id: c.id }, data: { smsFallbackAt: now } });
  await db.shift.update({ where: { id: s.id }, data: { pendingPrompt: "WELFARE", welfareSmsSentAt: now } });
  const msg = await sendTemplated(s, "WELFARE", "WELFARE");
  await recordEvent(s.id, s.guardId, "WELFARE_SMS_SENT", { at: now, note, smsMessageId: msg.id });
}

async function escalate(c: CheckWithShift, now: Date, why: string) {
  const s = c.shift;
  const isCall = c.channel !== "SMS";
  const claimed = await db.welfareCheck.updateMany({
    where: { id: c.id, response: "PENDING", escalatedAt: null },
    data: { escalatedAt: now, response: "NO_RESPONSE", ...(isCall ? { callStatus: "ESCALATED" } : {}) },
  });
  if (!claimed.count) return;
  const att = await db.attendance.update({ where: { shiftId: s.id }, data: { missedChecks: { increment: 1 } } }).catch(() => null);
  const missed = att?.missedChecks ?? 1;
  const who = `${s.guard.firstName} ${s.guard.lastName}`;
  await recordEvent(s.id, s.guardId, "WELFARE_MISSED", { at: now, note: `No response to the welfare check due ${fmtTime(c.dueAt ?? c.sentAt)}. ${why}` });
  await notify({
    type: "WELFARE_MISSED", severity: missed >= 2 ? "CRITICAL" : "WARNING",
    title: `${who} did not answer the welfare check`,
    body: `${s.location.name}. Due ${fmtTime(c.dueAt ?? c.sentAt)}, ${c.attempts} ${isCall ? "call" : "text"}${c.attempts === 1 ? "" : "s"}${c.smsFallbackAt ? " and a text" : ""}, no response by ${fmtTime(now)}. ${missed >= 2 ? `${missed} missed checks this shift. ` : ""}Call ${s.guard.phone}.`,
    guardId: s.guardId, shiftId: s.id,
  });
}

/** Read the gateway call request a check is waiting on, and copy its outcome. */
async function syncGatewayCall(c: CheckWithShift, now: Date): Promise<WelfareCallStatus | null> {
  if (!c.callRequestId) return c.callStatus;
  const r = await db.callRequest.findUnique({ where: { id: c.callRequestId } });
  if (!r) return c.callStatus;
  const next: WelfareCallStatus =
    r.status === "CONNECTED" || r.status === "COMPLETED" ? "CALL_ANSWERED"
      : r.status === "NO_ANSWER" ? "NO_ANSWER"
        : r.status === "FAILED" || r.status === "TIMED_OUT" || r.status === "CANCELLED" ? "FAILED"
          : r.status === "DIALING" ? "CALL_RINGING" : "CALL_INITIATED";
  if (next === c.callStatus) return next;
  await db.welfareCheck.update({ where: { id: c.id }, data: { callStatus: next } });
  if (next === "CALL_ANSWERED") {
    // The operator spoke to the guard. Whether the guard is well is the operator's word, so the
    // check waits for a person to confirm it; the call alone settles nothing.
    await recordEvidence({
      shiftId: c.shiftId, guardId: c.shift.guardId, kind: "WELFARE", source: "CALL", status: "PENDING",
      occurredAt: r.connectedAt ?? now, dedupeKey: `welfare:${c.id}:gateway`, callLogId: r.callLogId, gatewayDeviceId: r.gatewayDeviceId,
      note: "Welfare call answered on the operations phone. Confirm the guard is well.",
    });
    await recordEvent(c.shiftId, c.shift.guardId, "CALL_ANSWERED", { at: r.connectedAt ?? now, note: "Welfare call answered. Waiting for the operator to confirm the guard is well." });
    await notify({ type: "CALL_ATTENDANCE_PENDING", severity: "INFO", title: `Confirm ${c.shift.guard.firstName} ${c.shift.guard.lastName}'s welfare call`, body: `${c.shift.location.name}. The welfare call was answered at ${fmtTime(r.connectedAt ?? now)}. Confirm on the shift once you have spoken to the guard.`, guardId: c.shift.guardId, shiftId: c.shiftId }).catch(() => undefined);
  }
  return next;
}

async function followUp(now: Date, report: WelfareRunReport) {
  const open = await db.welfareCheck.findMany({
    where: { scheduleKey: { not: null }, response: "PENDING", escalatedAt: null, shift: { endAt: { gt: new Date(now.getTime() - 12 * 3600_000) } } },
    include: { shift: { include: shiftInclude } },
    orderBy: { sentAt: "asc" },
    take: 500,
  });
  if (!open.length) return;
  const responseMinutes = await getSettingNumber("welfare.responseMinutes");
  for (const c of open) {
    try {
      const s = c.shift;
      if (!(ON_SITE_STATUSES as readonly string[]).includes(s.status)) {
        // The shift closed (completed, cancelled) before anyone answered: stop asking, and say so.
        if (c.callStatus === "CALL_ANSWERED") continue; // still waiting on the operator's word
        await db.welfareCheck.updateMany({ where: { id: c.id, response: "PENDING" }, data: { response: "NO_RESPONSE", note: "The shift closed before the check was answered." } });
        report.closed++;
        continue;
      }
      const callStatus = c.channel === "GATEWAY_CALL" && !c.smsFallbackAt ? await syncGatewayCall(c, now) : c.callStatus;
      const action = nextFollowUp({
        channel: c.channel, callStatus, attempts: c.attempts, lastAttemptAt: c.lastAttemptAt ?? c.sentAt, smsFallbackAt: c.smsFallbackAt,
        maxAttempts: Math.max(1, s.location.welfareMaxAttempts), retryMinutes: Math.max(1, s.location.welfareRetryMinutes),
        smsFallback: s.location.welfareSmsFallback, guardSmsEnabled: s.guard.smsAttendanceEnabled, responseMinutes, now,
      });
      if (action === "WAIT") continue;
      if (action === "RETRY") {
        if (s.pendingPrompt === "INCIDENT_DESCRIPTION") continue;
        const attempts = c.attempts + 1;
        await db.welfareCheck.update({ where: { id: c.id }, data: { attempts, lastAttemptAt: now } });
        await place({ ...c, attempts, lastAttemptAt: now }, now, `Welfare check due ${fmtTime(c.dueAt ?? c.sentAt)} not answered, asking again`);
        report.retried++;
      } else if (action === "SMS_FALLBACK") {
        await smsFallback(c, now, `Welfare call not answered after ${c.attempts} attempt${c.attempts === 1 ? "" : "s"}. Sent by SMS instead.`);
        report.smsFallbacks++;
      } else {
        await escalate({ ...c, callStatus }, now, `${c.attempts} attempt${c.attempts === 1 ? "" : "s"}${c.smsFallbackAt ? " and an SMS" : ""} without a reply.`);
        report.escalated++;
      }
    } catch (e) {
      report.errors.push(`welfare follow-up ${c.id}: ${(e as Error).message}`);
    }
  }
}

export type VoiceReportResult =
  | { outcome: "duplicate" }
  | { outcome: "unknown-call" }
  | { outcome: "status"; callStatus: WelfareCallStatus }
  | { outcome: "response"; response: WelfareResponse; late: boolean }
  | { outcome: "ignored"; reason: string };

/**
 * One voice provider report. Each event id is applied once, whatever the provider resends. A key
 * press is the guard's response; anything else only updates what the call did. A response that
 * arrives after the check was escalated still counts (the guard is well after all) and the
 * supervisor is told. A settled check is never moved back.
 */
export async function applyVoiceReport(providerName: string, simulated: boolean, r: VoiceReport, now = new Date()): Promise<VoiceReportResult> {
  const { count } = await db.voiceWebhookEvent.createMany({ data: [{ provider: providerName, eventId: r.eventId }], skipDuplicates: true });
  if (!count) return { outcome: "duplicate" };

  const byCall = await db.welfareCheck.findUnique({ where: { providerCallId: r.providerCallId }, include: { shift: { include: shiftInclude } } });
  const check = byCall ?? (r.reference ? await db.welfareCheck.findFirst({ where: { id: r.reference, provider: providerName }, include: { shift: { include: shiftInclude } } }) : null);
  if (!check) return { outcome: "unknown-call" };
  const currentCall = check.providerCallId === r.providerCallId;
  const mapped = mapVoiceReport(r.status, r.digits);

  if (!mapped.response) {
    // A status about an earlier attempt's call says nothing about the current one.
    if (!currentCall) return { outcome: "ignored", reason: "report for an earlier attempt" };
    if (check.response !== "PENDING" || check.callStatus === "RESPONSE_CONFIRMED" || check.callStatus === "ESCALATED") return { outcome: "ignored", reason: "check already settled" };
    await db.welfareCheck.update({ where: { id: check.id }, data: { callStatus: mapped.callStatus } });
    if (mapped.callStatus === "CALL_ANSWERED" && check.callStatus !== "CALL_ANSWERED") {
      await recordEvent(check.shiftId, check.shift.guardId, "CALL_ANSWERED", { at: r.at, note: "Welfare call answered. No key pressed yet, so this is not a response." });
    }
    if (mapped.callStatus === "NO_ANSWER" || mapped.callStatus === "BUSY" || mapped.callStatus === "FAILED") {
      await recordEvent(check.shiftId, check.shift.guardId, "CALL_MISSED", { at: r.at, note: `Welfare call ${mapped.callStatus === "BUSY" ? "found the line busy" : mapped.callStatus === "NO_ANSWER" ? "was not answered" : "failed"} (attempt ${check.attempts}).` });
    }
    return { outcome: "status", callStatus: mapped.callStatus };
  }

  const late = check.response === "NO_RESPONSE" && Boolean(check.escalatedAt);
  if (check.response !== "PENDING" && !late) return { outcome: "ignored", reason: `already answered (${check.response.toLowerCase()})` };
  const claimed = await db.welfareCheck.updateMany({
    where: { id: check.id, response: check.response },
    data: { response: mapped.response, respondedAt: r.at, callStatus: "RESPONSE_CONFIRMED", digits: r.digits },
  });
  if (!claimed.count) return { outcome: "ignored", reason: "answered meanwhile" };

  const s = check.shift;
  const who = `${s.guard.firstName} ${s.guard.lastName}`;
  const tag = simulated ? " (simulated voice provider, not a real response)" : "";
  await recordEvidence({
    shiftId: s.id, guardId: s.guardId, kind: "WELFARE", source: "IVR", status: "CONFIRMED", occurredAt: r.at,
    dedupeKey: `ivr:${check.id}`, flags: simulated ? ["SIMULATED"] : [],
    note: `Pressed ${r.digits} on the welfare call${tag}.`,
  });
  await settlePendingCalls(s.id, "WELFARE", `Settled by the key press at ${fmtTime(r.at)}.`, now);

  if (mapped.response === "WELL") {
    await db.welfareCheck.updateMany({ where: { shiftId: s.id, response: "PENDING" }, data: { response: "WELL", respondedAt: r.at } });
    if (s.pendingPrompt === "WELFARE") await db.shift.update({ where: { id: s.id }, data: { pendingPrompt: "NONE", ...(s.status === "LATE" || s.status === "ASSISTANCE" ? { status: "ON_DUTY" } : {}) } });
    await recordEvent(s.id, s.guardId, "WELFARE_OK", { at: r.at, note: `Guard pressed 1 on the welfare call: shift going well${tag}.` });
    if (!simulated) await sendClientUpdate(s, "WELFARE_OK", r.at).catch(() => undefined);
  } else if (mapped.response === "ASSISTANCE") {
    await db.welfareCheck.updateMany({ where: { shiftId: s.id, response: "PENDING" }, data: { response: "ASSISTANCE", respondedAt: r.at } });
    await db.shift.update({ where: { id: s.id }, data: { status: s.status === "CRITICAL" ? "CRITICAL" : "ASSISTANCE", ...(s.pendingPrompt === "WELFARE" ? { pendingPrompt: "NONE" } : {}) } });
    const incident = await createIncident({ guardId: s.guardId, locationId: s.locationId, shiftId: s.id, category: "ASSISTANCE_REQUEST", severity: "HIGH", description: `${who} pressed 2 (needs assistance) on the welfare call at ${fmtTime(r.at)}${tag}.`, source: "VOICE", supervisorId: s.supervisorId, occurredAt: r.at, actorName: "voice provider" });
    await recordEvent(s.id, s.guardId, "WELFARE_ASSISTANCE", { at: r.at, note: `Guard pressed 2 on the welfare call: needs assistance${tag}. Incident ${incident.incidentNo}.` });
    await notify({ type: "ASSISTANCE_REQUESTED", severity: "WARNING", title: `${who} needs assistance at ${s.location.name}`, body: `Pressed 2 on the welfare call at ${fmtTime(r.at)}${tag}. Call ${s.guard.phone}.`, guardId: s.guardId, shiftId: s.id, incidentId: incident.id });
  } else {
    await db.welfareCheck.updateMany({ where: { shiftId: s.id, response: "PENDING" }, data: { response: "INCIDENT", respondedAt: r.at } });
    const incident = await createIncident({ guardId: s.guardId, locationId: s.locationId, shiftId: s.id, category: "EMERGENCY", severity: "CRITICAL", description: `${who} pressed 3 (emergency) on the welfare call at ${fmtTime(r.at)}${tag}.`, source: "VOICE", supervisorId: s.supervisorId, occurredAt: r.at, actorName: "voice provider" });
    await db.shift.update({ where: { id: s.id }, data: { status: "CRITICAL", emergencyAt: r.at, pendingPrompt: "INCIDENT_DESCRIPTION" } });
    await db.attendance.update({ where: { shiftId: s.id }, data: { status: "INCIDENT" } }).catch(() => undefined);
    await recordEvent(s.id, s.guardId, "EMERGENCY", { at: r.at, note: `Guard pressed 3 on the welfare call: emergency${tag}. Incident ${incident.incidentNo}.` });
    await notify({ type: "EMERGENCY", severity: "CRITICAL", title: `EMERGENCY FROM ${who.toUpperCase()} — ${s.location.name.toUpperCase()} — ${fmtTime(r.at)}`, body: `Pressed 3 on the welfare call${tag}. Call ${s.guard.phone} immediately. Supervisor: ${s.supervisor?.name ?? "unassigned"}.`, guardId: s.guardId, shiftId: s.id, incidentId: incident.id });
    // The guard can text a description, as after an SMS EMERGENCY.
    await sendTemplated(await db.shift.findUniqueOrThrow({ where: { id: s.id }, include: shiftInclude }), "EMERGENCY_ACK", "EMERGENCY").catch(() => undefined);
  }
  if (late) {
    await notify({ type: "WELFARE_MISSED", severity: "INFO", title: `${who} answered the welfare check late`, body: `${s.location.name}. The check due ${fmtTime(check.dueAt ?? check.sentAt)} was escalated at ${fmtTime(check.escalatedAt)}; the guard pressed ${r.digits} at ${fmtTime(r.at)}${tag}.`, guardId: s.guardId, shiftId: s.id }).catch(() => undefined);
  }
  return { outcome: "response", response: mapped.response, late };
}
