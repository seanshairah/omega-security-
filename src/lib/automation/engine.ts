/**
 * Shift automation engine.
 *
 * `runAutomationTick(now)` is called every minute. Each step selects shifts that are due
 * and have not yet been acted on (a timestamp column on Shift records each action), so the
 * engine is idempotent and safe to run from several places.
 */
import { db } from "@/lib/db";
import { addMinutes } from "date-fns";
import { getSettingNumber } from "@/lib/settings";
import { notify } from "@/lib/notifications";
import { sendTemplated } from "@/lib/sms/outbound";
import { sendClientUpdate } from "@/lib/sms/client-updates";
import { materialiseRecurrences, recordEvent, shiftInclude, LIVE_STATUSES, ON_SITE_STATUSES } from "@/lib/services/shifts";
import { fmtTime } from "@/lib/time";

export type TickReport = {
  at: string;
  recurrencesCreated: number;
  arrivalSent: number;
  remindersSent: number;
  escalated: number;
  welfareSent: number;
  welfareMissed: number;
  handoverNotices: number;
  completionSent: number;
  completionTimedOut: number;
  missed: number;
  errors: string[];
};

let running = false;

export async function runAutomationTick(now = new Date()): Promise<TickReport> {
  const report: TickReport = { at: now.toISOString(), recurrencesCreated: 0, arrivalSent: 0, remindersSent: 0, escalated: 0, welfareSent: 0, welfareMissed: 0, handoverNotices: 0, completionSent: 0, completionTimedOut: 0, missed: 0, errors: [] };
  if (running) {
    report.errors.push("tick already running");
    return report;
  }
  running = true;
  try {
    const [sendOffset, grace, escalation, welfarePct, welfareWindow, completionWindow, handoverMinutes, horizon] = await Promise.all([
      getSettingNumber("arrival.sendOffsetMinutes"),
      getSettingNumber("arrival.graceMinutes"),
      getSettingNumber("arrival.escalationMinutes"),
      getSettingNumber("welfare.offsetPercent"),
      getSettingNumber("welfare.responseMinutes"),
      getSettingNumber("completion.responseMinutes"),
      getSettingNumber("handover.notifyMinutes"),
      getSettingNumber("recurrence.horizonDays"),
    ]);

    // 1. recurrences
    try {
      report.recurrencesCreated = await materialiseRecurrences(horizon, now);
    } catch (e) {
      report.errors.push(`recurrence: ${(e as Error).message}`);
    }

    // 2. arrival check
    const due = await db.shift.findMany({ where: { status: "SCHEDULED", arrivalSmsSentAt: null, startAt: { lte: addMinutes(now, sendOffset) }, endAt: { gt: now } }, include: shiftInclude });
    for (const s of due) {
      try {
        await db.shift.update({ where: { id: s.id }, data: { status: "AWAITING_ARRIVAL", pendingPrompt: "ARRIVAL", arrivalSmsSentAt: now } });
        await recordEvent(s.id, s.guardId, "SHIFT_STARTED", { at: s.startAt, note: `Shift at ${s.location.name} scheduled ${fmtTime(s.startAt)}–${fmtTime(s.endAt)}.` });
        const msg = await sendTemplated(s, "ARRIVAL", "ARRIVAL");
        await recordEvent(s.id, s.guardId, "ARRIVAL_SMS_SENT", { at: now, note: "Arrival check sent.", smsMessageId: msg.id });
        report.arrivalSent++;
      } catch (e) {
        report.errors.push(`arrival ${s.id}: ${(e as Error).message}`);
      }
    }

    // 3. arrival reminder
    const remind = await db.shift.findMany({ where: { status: "AWAITING_ARRIVAL", arrivalReminderSentAt: null, arrivalSmsSentAt: { lte: addMinutes(now, -grace) }, attendance: { arrivalConfirmedAt: null } }, include: shiftInclude });
    for (const s of remind) {
      try {
        await db.shift.update({ where: { id: s.id }, data: { status: "LATE", arrivalReminderSentAt: now } });
        const msg = await sendTemplated(s, "ARRIVAL_REMINDER", "ARRIVAL_REMINDER");
        await recordEvent(s.id, s.guardId, "ARRIVAL_REMINDER_SENT", { at: now, note: `No reply after ${grace} min. Reminder sent.`, smsMessageId: msg.id });
        await notify({ type: "GUARD_LATE", severity: "WARNING", title: `${s.guard.firstName} ${s.guard.lastName} has not confirmed arrival`, body: `${s.location.name}, shift ${fmtTime(s.startAt)}–${fmtTime(s.endAt)}. Reminder sent at ${fmtTime(now)}.`, guardId: s.guardId, shiftId: s.id });
        report.remindersSent++;
      } catch (e) {
        report.errors.push(`reminder ${s.id}: ${(e as Error).message}`);
      }
    }

    // 4. arrival escalation
    const escalate = await db.shift.findMany({ where: { status: "LATE", arrivalEscalatedAt: null, arrivalReminderSentAt: { lte: addMinutes(now, -escalation) }, attendance: { arrivalConfirmedAt: null } }, include: shiftInclude });
    for (const s of escalate) {
      try {
        await db.shift.update({ where: { id: s.id }, data: { status: "NOT_CONFIRMED", arrivalEscalatedAt: now } });
        await db.attendance.update({ where: { shiftId: s.id }, data: { status: "NOT_REPORTED" } });
        await recordEvent(s.id, s.guardId, "ARRIVAL_ESCALATED", { at: now, note: `No reply after reminder. Attendance not confirmed. ${s.supervisor?.name ?? "Supervisor"} notified.` });
        await notify({ type: "GUARD_NOT_REPORTED", severity: "CRITICAL", title: `${s.guard.firstName} ${s.guard.lastName} failed to report at ${s.location.name}`, body: `No reply to the arrival check or reminder. Shift ${fmtTime(s.startAt)}–${fmtTime(s.endAt)}. Call ${s.guard.phone}.`, guardId: s.guardId, shiftId: s.id });
        report.escalated++;
      } catch (e) {
        report.errors.push(`escalate ${s.id}: ${(e as Error).message}`);
      }
    }

    // 5. welfare check at the configured point of the shift
    const onSite = await db.shift.findMany({ where: { status: { in: ON_SITE_STATUSES }, welfareSmsSentAt: null, endAt: { gt: now } }, include: shiftInclude });
    for (const s of onSite) {
      const point = new Date(s.startAt.getTime() + (s.durationMinutes * 60000 * welfarePct) / 100);
      if (point > now) continue;
      if (s.pendingPrompt === "INCIDENT_DESCRIPTION") continue; // do not interrupt an incident report
      try {
        await db.shift.update({ where: { id: s.id }, data: { welfareSmsSentAt: now, pendingPrompt: "WELFARE" } });
        await db.welfareCheck.create({ data: { shiftId: s.id, sentAt: now } });
        const msg = await sendTemplated(s, "WELFARE", "WELFARE");
        await recordEvent(s.id, s.guardId, "WELFARE_SMS_SENT", { at: now, note: "Mid-shift welfare check sent.", smsMessageId: msg.id });
        report.welfareSent++;
      } catch (e) {
        report.errors.push(`welfare ${s.id}: ${(e as Error).message}`);
      }
    }

    // 6. missed welfare check
    const missedWelfare = await db.shift.findMany({ where: { pendingPrompt: "WELFARE", welfareMissedAt: null, welfareSmsSentAt: { lte: addMinutes(now, -welfareWindow) } }, include: shiftInclude });
    for (const s of missedWelfare) {
      try {
        await db.shift.update({ where: { id: s.id }, data: { welfareMissedAt: now, pendingPrompt: "WELFARE" } }); // keep listening
        await db.welfareCheck.updateMany({ where: { shiftId: s.id, response: "PENDING" }, data: { response: "NO_RESPONSE" } });
        await db.attendance.update({ where: { shiftId: s.id }, data: { missedChecks: { increment: 1 } } });
        await recordEvent(s.id, s.guardId, "WELFARE_MISSED", { at: now, note: `No reply to the welfare check within ${welfareWindow} min.` });
        await notify({ type: "WELFARE_MISSED", severity: "WARNING", title: `${s.guard.firstName} ${s.guard.lastName} missed the welfare check`, body: `${s.location.name}. Check sent ${fmtTime(s.welfareSmsSentAt)}, no reply by ${fmtTime(now)}. Call ${s.guard.phone}.`, guardId: s.guardId, shiftId: s.id });
        report.welfareMissed++;
      } catch (e) {
        report.errors.push(`welfare-missed ${s.id}: ${(e as Error).message}`);
      }
    }

    // 7. handover notices
    const incoming = await db.shift.findMany({ where: { status: "SCHEDULED", handoverSmsSentAt: null, startAt: { gt: now, lte: addMinutes(now, handoverMinutes) } }, include: shiftInclude });
    for (const s of incoming) {
      try {
        const outgoing = await db.shift.findFirst({ where: { locationId: s.locationId, id: { not: s.id }, status: { in: LIVE_STATUSES }, endAt: { gte: addMinutes(s.startAt, -60), lte: addMinutes(s.startAt, 60) } }, include: shiftInclude });
        await db.shift.update({ where: { id: s.id }, data: { handoverSmsSentAt: now } });
        if (!outgoing) continue;
        const inName = `${s.guard.firstName} ${s.guard.lastName}`;
        const outName = `${outgoing.guard.firstName} ${outgoing.guard.lastName}`;
        await sendTemplated(s, "HANDOVER_INCOMING", "HANDOVER", { other_guard: outName });
        await sendTemplated(outgoing, "HANDOVER_OUTGOING", "HANDOVER", { other_guard: inName });
        await recordEvent(s.id, s.guardId, "HANDOVER_NOTICE", { at: now, note: `Taking over from ${outName}.` });
        await recordEvent(outgoing.id, outgoing.guardId, "HANDOVER_NOTICE", { at: now, note: `Relief: ${inName} at ${fmtTime(s.startAt)}.` });
        report.handoverNotices++;
      } catch (e) {
        report.errors.push(`handover ${s.id}: ${(e as Error).message}`);
      }
    }

    // 8. completion check
    const ending = await db.shift.findMany({ where: { status: { in: ON_SITE_STATUSES }, completionSmsSentAt: null, endAt: { lte: now } }, include: shiftInclude });
    for (const s of ending) {
      if (s.pendingPrompt === "INCIDENT_DESCRIPTION") continue;
      try {
        await db.shift.update({ where: { id: s.id }, data: { completionSmsSentAt: now, pendingPrompt: "COMPLETION" } });
        const msg = await sendTemplated(s, "COMPLETION", "COMPLETION");
        await recordEvent(s.id, s.guardId, "COMPLETION_SMS_SENT", { at: now, note: "End-of-shift check sent.", smsMessageId: msg.id });
        report.completionSent++;
      } catch (e) {
        report.errors.push(`completion ${s.id}: ${(e as Error).message}`);
      }
    }

    // 9. completion timeout → close as unconfirmed
    const unconfirmed = await db.shift.findMany({ where: { pendingPrompt: "COMPLETION", completionTimedOutAt: null, completionSmsSentAt: { lte: addMinutes(now, -completionWindow) } }, include: shiftInclude });
    for (const s of unconfirmed) {
      try {
        const stillOnDuty = s.attendance?.status === "STILL_ON_DUTY";
        await db.shift.update({ where: { id: s.id }, data: { completionTimedOutAt: now, ...(stillOnDuty ? {} : { status: "COMPLETED", pendingPrompt: "NONE" }) } });
        if (!stillOnDuty) {
          await db.attendance.update({ where: { shiftId: s.id }, data: { status: s.attendance?.status === "INCIDENT" ? "INCIDENT" : "COMPLETED" } });
          await recordEvent(s.id, s.guardId, "COMPLETION_TIMEOUT", { at: now, note: `No reply to the end-of-shift check within ${completionWindow} min. Closed as completed, unconfirmed.` });
          await recordEvent(s.id, s.guardId, "SHIFT_COMPLETED", { at: now, note: "Shift closed by the system." });
          await sendClientUpdate(s, "SHIFT_ENDED", now);
        }
        await notify({ type: "SHIFT_UNCONFIRMED", severity: "WARNING", title: `${s.guard.firstName} ${s.guard.lastName} did not confirm shift completion`, body: `${s.location.name}, ended ${fmtTime(s.endAt)}. ${stillOnDuty ? "Guard reported still on duty." : "Closed as completed without confirmation."}`, guardId: s.guardId, shiftId: s.id });
        report.completionTimedOut++;
      } catch (e) {
        report.errors.push(`completion-timeout ${s.id}: ${(e as Error).message}`);
      }
    }

    // 10. missed shifts — never arrived and the shift has ended
    const missed = await db.shift.findMany({ where: { status: { in: ["SCHEDULED", "AWAITING_ARRIVAL", "LATE", "NOT_CONFIRMED"] }, endAt: { lte: now } }, include: shiftInclude });
    for (const s of missed) {
      try {
        await db.shift.update({ where: { id: s.id }, data: { status: "MISSED", pendingPrompt: "NONE" } });
        await db.attendance.update({ where: { shiftId: s.id }, data: { status: "NOT_REPORTED" } });
        await recordEvent(s.id, s.guardId, "SHIFT_MISSED", { at: now, note: "Shift ended with no arrival confirmation." });
        await notify({ type: "SHIFT_MISSED", severity: "CRITICAL", title: `${s.guard.firstName} ${s.guard.lastName} missed the shift at ${s.location.name}`, body: `${fmtTime(s.startAt)}–${fmtTime(s.endAt)}, no arrival confirmed.`, guardId: s.guardId, shiftId: s.id });
        report.missed++;
      } catch (e) {
        report.errors.push(`missed ${s.id}: ${(e as Error).message}`);
      }
    }
  } finally {
    running = false;
  }
  return report;
}

let timer: NodeJS.Timeout | null = null;
export function startInProcessScheduler(intervalMs = 60_000) {
  if (timer) return;
  console.log(`[automation] in-process scheduler started, every ${intervalMs / 1000}s`);
  const tick = () => runAutomationTick().then((r) => { if (r.errors.length) console.error("[automation]", r.errors); }).catch((e) => console.error("[automation] tick failed", e));
  timer = setInterval(tick, intervalMs);
  setTimeout(tick, 5_000);
}
