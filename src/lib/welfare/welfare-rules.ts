/**
 * Scheduled welfare checks: pure rules, no database.
 *
 * A site may schedule welfare checks at fixed local times ("00:00,03:00") or every N minutes from the
 * shift start. Each due point becomes one check, by the site's channel:
 *
 *   SMS           the existing welfare text; the guard replies 1 / WELL
 *   VOICE         a programmable voice provider rings the guard and reads a key press (IVR)
 *   GATEWAY_CALL  the operations gateway phone rings the guard; the operator speaks to them
 *
 * An answered call is not a welfare response. Only a key press, an SMS reply, a call from the guard,
 * or a person confirming settles a check. Unanswered checks are retried, then (for calls) followed
 * by an SMS, then escalated to the supervisor. An unanswered call says nothing about where the guard
 * is.
 */
import type { WelfareCallStatus, WelfareChannel, WelfareResponse } from "@prisma/client";
import { TZ, instantToZonedParts, zonedWallClockToInstant } from "@/lib/time";

export type WelfareSchedule = { times: string | null; intervalMinutes: number | null };

/** "00:00, 03:30" → [{h:0,m:0},{h:3,m:30}]. Throws with a readable message on anything else. */
export function parseWelfareTimes(v: string | null | undefined): { h: number; m: number }[] {
  if (!v || !v.trim()) return [];
  const out: { h: number; m: number }[] = [];
  for (const part of v.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(part);
    if (!m || +m[1] > 23 || +m[2] > 59) throw new Error(`"${part}" is not a time. Use 24-hour times like 00:00, 03:30.`);
    if (!out.some((x) => x.h === +m[1] && x.m === +m[2])) out.push({ h: +m[1], m: +m[2] });
  }
  return out;
}

export const hasSchedule = (s: WelfareSchedule) => Boolean((s.times && s.times.trim()) || (s.intervalMinutes && s.intervalMinutes > 0));

/**
 * The due points inside a shift, in time order. Fixed times are local (Harare) wall-clock times on
 * any day the shift covers, so an 18:00–06:00 shift with "00:00,03:00" gets both, across midnight.
 * Points at the very start or end are left out: arrival and completion have their own checks.
 */
export function welfareDuePoints(startAt: Date, endAt: Date, s: WelfareSchedule, tz: string = TZ): Date[] {
  const out: Date[] = [];
  const start = startAt.getTime(), end = endAt.getTime();
  if (s.intervalMinutes && s.intervalMinutes >= 15) {
    for (let t = start + s.intervalMinutes * 60_000; t < end; t += s.intervalMinutes * 60_000) out.push(new Date(t));
  }
  const times = parseWelfareTimes(s.times);
  if (times.length) {
    // Walk each local calendar day the shift touches, from the day before its start (overnight shifts).
    const first = instantToZonedParts(new Date(start - 86_400_000), tz);
    let day = zonedWallClockToInstant(first.year, first.month, first.day, 12, 0, tz);
    for (let i = 0; i < 4; i++, day = new Date(day.getTime() + 86_400_000)) {
      const p = instantToZonedParts(day, tz);
      for (const tm of times) {
        const at = zonedWallClockToInstant(p.year, p.month, p.day, tm.h, tm.m, tz).getTime();
        if (at > start && at < end && !out.some((d) => Math.abs(d.getTime() - at) < 60_000)) out.push(new Date(at));
      }
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

/** What a voice provider's report means. A connected call without a key press is only "answered". */
export function mapVoiceReport(status: string, digits: string | null | undefined): { callStatus: WelfareCallStatus; response: WelfareResponse | null } {
  const st = status.toLowerCase().replace(/[_\s]/g, "-");
  const d = (digits ?? "").trim();
  if (d === "1") return { callStatus: "RESPONSE_CONFIRMED", response: "WELL" };
  if (d === "2") return { callStatus: "RESPONSE_CONFIRMED", response: "ASSISTANCE" };
  if (d === "3") return { callStatus: "RESPONSE_CONFIRMED", response: "INCIDENT" }; // the emergency option
  if (st === "ringing" || st === "queued" || st === "initiated") return { callStatus: "CALL_RINGING", response: null };
  if (st === "answered" || st === "in-progress" || st === "completed") return { callStatus: "CALL_ANSWERED", response: null };
  if (st === "no-answer" || st === "noanswer") return { callStatus: "NO_ANSWER", response: null };
  if (st === "busy") return { callStatus: "BUSY", response: null };
  return { callStatus: "FAILED", response: null };
}

export type FollowUpFacts = {
  channel: WelfareChannel;
  callStatus: WelfareCallStatus | null;
  attempts: number;
  lastAttemptAt: Date;
  smsFallbackAt: Date | null;
  maxAttempts: number;
  retryMinutes: number;
  smsFallback: boolean;
  guardSmsEnabled: boolean;
  /** How long an SMS check waits for a reply (welfare.responseMinutes). */
  responseMinutes: number;
  now: Date;
};

export type FollowUp = "WAIT" | "RETRY" | "SMS_FALLBACK" | "ESCALATE";

/**
 * The next thing to do about a check nobody has answered. Calls get `maxAttempts` tries
 * `retryMinutes` apart, then one SMS if allowed, then escalation. An SMS check gets the same number
 * of texts, `responseMinutes` apart. A gateway call the operator answered is a person's job now:
 * it waits for them to confirm, and is never escalated as "no answer".
 */
export function nextFollowUp(f: FollowUpFacts): FollowUp {
  const since = (d: Date) => f.now.getTime() - d.getTime();
  if (f.smsFallbackAt) return since(f.smsFallbackAt) >= f.responseMinutes * 60_000 ? "ESCALATE" : "WAIT";
  if (f.channel === "SMS") {
    if (since(f.lastAttemptAt) < f.responseMinutes * 60_000) return "WAIT";
    return f.attempts < f.maxAttempts ? "RETRY" : "ESCALATE";
  }
  if (f.callStatus === "CALL_ANSWERED" && f.channel === "GATEWAY_CALL") return "WAIT";
  // Whether the last call is still ringing, was answered without a key press, or failed outright,
  // the next try waits the retry interval.
  if (since(f.lastAttemptAt) < f.retryMinutes * 60_000) return "WAIT";
  if (f.attempts < f.maxAttempts) return "RETRY";
  return f.smsFallback && f.guardSmsEnabled ? "SMS_FALLBACK" : "ESCALATE";
}

export const WELFARE_CALL_LABEL: Record<WelfareCallStatus, { label: string; tone: "ok" | "warn" | "critical" | "info" | "neutral" | "muted" }> = {
  CALL_SCHEDULED: { label: "Scheduled", tone: "neutral" },
  CALL_INITIATED: { label: "Calling", tone: "info" },
  CALL_RINGING: { label: "Ringing", tone: "info" },
  CALL_ANSWERED: { label: "Answered, no response yet", tone: "warn" },
  RESPONSE_CONFIRMED: { label: "Response received", tone: "ok" },
  NO_ANSWER: { label: "No answer", tone: "warn" },
  BUSY: { label: "Line busy", tone: "warn" },
  FAILED: { label: "Call failed", tone: "critical" },
  ESCALATED: { label: "Escalated", tone: "critical" },
};
