/**
 * The arithmetic and the rules behind call-triggered attendance verification. Pure: no database,
 * no clock of its own, no network, so every decision in this file is reproducible and testable.
 *
 * Three things are deliberately kept apart, because conflating them is how attendance systems come
 * to lie:
 *
 *   a **call** says the guard rang in;
 *   a **fix** says where a phone was, with what uncertainty, at a stated moment;
 *   **attendance** is the conclusion, and it requires both plus a site to compare against.
 *
 * A call alone never establishes presence.
 */
import type { LocationState } from "@/lib/geofence";

export type CheckInStatus =
  | "AWAITING" | "CALL_RECEIVED" | "GPS_PENDING"
  | "VERIFIED_ON_TIME" | "VERIFIED_WITHIN_GRACE" | "VERIFIED_LATE"
  | "OUTSIDE_AREA" | "LOCATION_UNCERTAIN" | "LOCATION_UNAVAILABLE" | "SITE_NOT_CONFIGURED"
  | "MISSED" | "MANUAL_REVIEW" | "MANUALLY_APPROVED" | "MANUALLY_REJECTED";

export const VERIFIED_STATUSES: CheckInStatus[] = ["VERIFIED_ON_TIME", "VERIFIED_WITHIN_GRACE", "VERIFIED_LATE"];
/** Statuses a supervisor has to look at. */
export const EXCEPTION_STATUSES: CheckInStatus[] = ["OUTSIDE_AREA", "LOCATION_UNCERTAIN", "LOCATION_UNAVAILABLE", "SITE_NOT_CONFIGURED", "MISSED", "MANUAL_REVIEW"];
/** Nothing more will arrive on its own. */
export const SETTLED_STATUSES: CheckInStatus[] = [...VERIFIED_STATUSES, "MANUALLY_APPROVED", "MANUALLY_REJECTED", "MISSED"];

export const CHECK_IN_META: Record<CheckInStatus, { label: string; tone: "ok" | "warn" | "critical" | "info" | "neutral" | "muted"; icon: string; detail: string }> = {
  AWAITING:             { label: "Awaiting check-in",   tone: "neutral",  icon: "pending",          detail: "The shift expects a check-in call." },
  CALL_RECEIVED:        { label: "Call received",       tone: "info",     icon: "phone_callback",   detail: "A qualifying call arrived. Presence is not yet verified." },
  GPS_PENDING:          { label: "GPS pending",         tone: "info",     icon: "my_location",      detail: "A fresh fix has been requested from the guard's phone." },
  VERIFIED_ON_TIME:     { label: "Verified on time",    tone: "ok",       icon: "verified_user",    detail: "GPS placed the guard on site at or before the start." },
  VERIFIED_WITHIN_GRACE:{ label: "Verified in grace",   tone: "ok",       icon: "verified_user",    detail: "GPS placed the guard on site inside the grace period." },
  VERIFIED_LATE:        { label: "Verified late",       tone: "warn",     icon: "timer",            detail: "GPS placed the guard on site after the grace period." },
  OUTSIDE_AREA:         { label: "Outside the site",    tone: "critical", icon: "wrong_location",   detail: "The fix is confidently outside the assigned geofence." },
  LOCATION_UNCERTAIN:   { label: "Location uncertain",  tone: "warn",     icon: "gpp_maybe",        detail: "GPS accuracy cannot separate inside from outside." },
  LOCATION_UNAVAILABLE: { label: "No usable fix",       tone: "warn",     icon: "location_off",     detail: "The phone has not provided an acceptable position." },
  SITE_NOT_CONFIGURED:  { label: "Site has no centre",  tone: "muted",    icon: "pin_drop",         detail: "The assigned site has no coordinates, so GPS cannot be judged." },
  MISSED:               { label: "Missed check-in",     tone: "critical", icon: "report",           detail: "No acceptable evidence arrived within the escalation window." },
  MANUAL_REVIEW:        { label: "Manual review",       tone: "warn",     icon: "visibility",       detail: "A supervisor must resolve this exception." },
  MANUALLY_APPROVED:    { label: "Approved by hand",    tone: "ok",       icon: "badge",            detail: "A supervisor accepted attendance. Not GPS-verified." },
  MANUALLY_REJECTED:    { label: "Rejected by hand",    tone: "critical", icon: "cancel",           detail: "A supervisor rejected this attendance." },
};

// ------------------------------------------------------------------ grace and lateness

export type GraceSources = { company: number; site?: number | null; shift?: number | null };

/** Most specific wins: the shift, then the site, then the company default. */
export function resolveGrace(g: GraceSources): { minutes: number; from: "shift" | "site" | "company" } {
  if (g.shift != null && Number.isFinite(g.shift) && g.shift >= 0) return { minutes: Math.floor(g.shift), from: "shift" };
  if (g.site != null && Number.isFinite(g.site) && g.site >= 0) return { minutes: Math.floor(g.site), from: "site" };
  return { minutes: Math.max(0, Math.floor(g.company)), from: "company" };
}

export type Lateness = {
  /** Whole minutes between the scheduled start and the verified arrival; 0 when early. */
  minutesAfterStart: number;
  /** Minutes beyond the grace period; 0 when on time or within grace. */
  lateMinutes: number;
  /** Arrived at or before the scheduled start. */
  early: boolean;
  /** Inside the grace period but after the start. */
  withinGrace: boolean;
  late: boolean;
};

/**
 * lateMinutes = max(0, ceil((arrival − start − grace) / 60s)).
 *
 * `minutesAfterStart` floors, because it reports elapsed whole minutes: an arrival 30 seconds after
 * the start is "0 minutes after", not "1". `lateMinutes` ceils, so any part-minute past the grace
 * period counts as a late minute rather than being rounded away.
 */
export function computeLateness(shiftStartAt: Date, verifiedArrivalAt: Date, graceMinutes: number): Lateness {
  const deltaMs = verifiedArrivalAt.getTime() - shiftStartAt.getTime();
  const graceMs = Math.max(0, graceMinutes) * 60_000;
  const minutesAfterStart = deltaMs <= 0 ? 0 : Math.floor(deltaMs / 60_000);
  const lateMinutes = Math.max(0, Math.ceil((deltaMs - graceMs) / 60_000));
  return {
    minutesAfterStart,
    lateMinutes,
    early: deltaMs <= 0,
    withinGrace: deltaMs > 0 && lateMinutes === 0,
    late: lateMinutes > 0,
  };
}

/** The attendance conclusion for a fix that has already been classified against the site. */
export function statusForVerifiedFix(geofence: LocationState, reason: string | undefined, lateness: Lateness): CheckInStatus {
  if (geofence === "OUTSIDE") return "OUTSIDE_AREA";
  if (geofence === "UNKNOWN") return reason === "poor_accuracy" || reason === "on_boundary" ? "LOCATION_UNCERTAIN" : "LOCATION_UNAVAILABLE";
  if (lateness.late) return "VERIFIED_LATE";
  if (lateness.withinGrace) return "VERIFIED_WITHIN_GRACE";
  return "VERIFIED_ON_TIME";
}

// ------------------------------------------------------------------ qualifying calls

export type CheckInWindow = {
  /** Minutes before the scheduled start that a call may already count. */
  beforeMinutes: number;
  /** Minutes after the scheduled start that a call still counts. */
  afterMinutes: number;
};

export type CallCandidate = {
  startedAt: Date;
  direction: "INCOMING" | "OUTGOING";
  /** The other party, normalised. Empty when the phone could not report it. */
  normalizedPhoneNumber: string;
  /** True when the row came from the guard's own registered phone. */
  fromGuardDevice: boolean;
};

export type ShiftCandidate = { id: string; startAt: Date; endAt: Date; cancelled: boolean; alreadyVerified: boolean };

export type QualifyResult = { ok: true } | { ok: false; reason: string };

/**
 * Whether a call counts as a check-in attempt.
 *
 * The rule is deliberately narrow: the call must come from the guard's own registered device, and
 * it must involve an authorised check-in number when the company has configured any. Caller ID
 * alone is never enough, which is why `fromGuardDevice` is required: that flag comes from the
 * device's authenticated event, not from the number on the line.
 */
export function callQualifies(call: CallCandidate, shift: ShiftCandidate, window: CheckInWindow, authorizedNumbers: string[], now = call.startedAt): QualifyResult {
  if (shift.cancelled) return { ok: false, reason: "the shift is cancelled" };
  if (shift.alreadyVerified) return { ok: false, reason: "this shift is already checked in" };
  if (!call.fromGuardDevice) return { ok: false, reason: "the call was not reported by the guard's registered device" };
  const earliest = new Date(shift.startAt.getTime() - Math.max(0, window.beforeMinutes) * 60_000);
  const latest = new Date(shift.startAt.getTime() + Math.max(0, window.afterMinutes) * 60_000);
  if (call.startedAt < earliest) return { ok: false, reason: "the call is before the check-in window opens" };
  if (call.startedAt > latest) return { ok: false, reason: "the call is after the check-in window closes" };
  if (call.startedAt > shift.endAt) return { ok: false, reason: "the call is after the shift ended" };
  if (authorizedNumbers.length) {
    const dialled = call.normalizedPhoneNumber.replace(/\s+/g, "");
    if (!authorizedNumbers.some((n) => n.replace(/\s+/g, "") === dialled)) return { ok: false, reason: "the call was not to an authorised check-in number" };
  }
  void now;
  return { ok: true };
}

/**
 * Which shift a qualifying call belongs to. Ambiguity is reported rather than guessed: two shifts
 * whose windows both contain the call are a rota problem a person has to look at, and picking one
 * silently would put attendance on the wrong shift.
 */
export function pickShiftForCall(callAt: Date, candidates: ShiftCandidate[], window: CheckInWindow): { shift: ShiftCandidate } | { ambiguous: ShiftCandidate[] } | { none: true } {
  const open = candidates.filter((s) => !s.cancelled && !s.alreadyVerified && callQualifies({ startedAt: callAt, direction: "OUTGOING", normalizedPhoneNumber: "", fromGuardDevice: true }, s, window, []).ok);
  if (open.length === 0) return { none: true };
  if (open.length === 1) return { shift: open[0] };
  // One shift starting much nearer the call than any other is not ambiguous.
  const byCloseness = [...open].sort((a, b) => Math.abs(a.startAt.getTime() - callAt.getTime()) - Math.abs(b.startAt.getTime() - callAt.getTime()));
  const gapMinutes = (Math.abs(byCloseness[1].startAt.getTime() - callAt.getTime()) - Math.abs(byCloseness[0].startAt.getTime() - callAt.getTime())) / 60_000;
  if (gapMinutes >= 30) return { shift: byCloseness[0] };
  return { ambiguous: open };
}

// ------------------------------------------------------------------ correlating the fix to the call

export type CorrelationPolicy = {
  /** How long after the call a fix still counts as evidence of that arrival. */
  maxMinutesAfterCall: number;
  /** How far before the call a fix may have been captured and still count. */
  maxMinutesBeforeCall: number;
  /** A fix older than this is never arrival evidence, however it arrived. */
  maxFixAgeMinutes: number;
};

export const DEFAULT_CORRELATION: CorrelationPolicy = { maxMinutesAfterCall: 10, maxMinutesBeforeCall: 5, maxFixAgeMinutes: 15 };

export function fixCorrelates(callAt: Date, capturedAt: Date, receivedAt: Date, p: CorrelationPolicy = DEFAULT_CORRELATION): QualifyResult {
  const afterMs = capturedAt.getTime() - callAt.getTime();
  if (afterMs > p.maxMinutesAfterCall * 60_000) return { ok: false, reason: `the fix was captured ${Math.round(afterMs / 60_000)} min after the call` };
  if (-afterMs > p.maxMinutesBeforeCall * 60_000) return { ok: false, reason: `the fix was captured ${Math.round(-afterMs / 60_000)} min before the call` };
  const ageMs = receivedAt.getTime() - capturedAt.getTime();
  if (ageMs > p.maxFixAgeMinutes * 60_000) return { ok: false, reason: `the fix is ${Math.round(ageMs / 60_000)} min old` };
  return { ok: true };
}

/**
 * A phone's clock can be wrong or deliberately set back. A timestamp from the future, or one
 * implausibly far in the past relative to when the server received it, is replaced by the server's
 * receipt time and the substitution is recorded, so a manipulated clock cannot manufacture an
 * on-time arrival.
 */
export function trustedTimestamp(deviceAt: Date, receivedAt: Date, maxSkewMinutes = 10): { at: Date; adjusted: boolean; reason?: string } {
  const skewMs = deviceAt.getTime() - receivedAt.getTime();
  if (skewMs > maxSkewMinutes * 60_000) return { at: receivedAt, adjusted: true, reason: `device clock ${Math.round(skewMs / 60_000)} min ahead` };
  if (-skewMs > maxSkewMinutes * 60_000) return { at: receivedAt, adjusted: true, reason: `device clock ${Math.round(-skewMs / 60_000)} min behind` };
  return { at: deviceAt, adjusted: false };
}

// ------------------------------------------------------------------ escalation

export type EscalationPolicy = { graceMinutes: number; escalationMinutes: number };

/** Whether an unverified check-in has run out of time, and how it should read meanwhile. */
export function escalationState(shiftStartAt: Date, now: Date, p: EscalationPolicy): { phase: "BEFORE_START" | "IN_GRACE" | "OVERDUE" | "ESCALATE"; minutesAfterStart: number } {
  const deltaMin = Math.floor((now.getTime() - shiftStartAt.getTime()) / 60_000);
  if (deltaMin < 0) return { phase: "BEFORE_START", minutesAfterStart: 0 };
  if (deltaMin <= p.graceMinutes) return { phase: "IN_GRACE", minutesAfterStart: deltaMin };
  if (deltaMin < p.graceMinutes + p.escalationMinutes) return { phase: "OVERDUE", minutesAfterStart: deltaMin };
  return { phase: "ESCALATE", minutesAfterStart: deltaMin };
}

/** One line for the control room, in the shape operations staff read it. */
export function describeOutcome(status: CheckInStatus, lateness: { minutesAfterStart: number; lateMinutes: number } | null): string {
  const meta = CHECK_IN_META[status];
  if (status === "VERIFIED_LATE" && lateness) return `Late — ${lateness.lateMinutes} min beyond grace (${lateness.minutesAfterStart} min after shift start)`;
  if (status === "VERIFIED_WITHIN_GRACE" && lateness && lateness.minutesAfterStart > 0) return `Verified within grace (${lateness.minutesAfterStart} min after shift start)`;
  return meta.label;
}
