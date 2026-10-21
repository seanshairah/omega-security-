/**
 * Pure rules for "call this guard from the portal" requests (CallRequest). No database, no Android.
 *
 *   QUEUED ─► DELIVERED ─► AWAITING_CONFIRMATION ─► DIALING ─► CONNECTED ─► COMPLETED
 *     │           │                 │                  │                    NO_ANSWER
 *     └───────────┴─────────────────┴──► TIMED_OUT · CANCELLED · FAILED
 *
 * Android does not let an app in the background start a call, and this one never tries to get
 * round that. The phone shows the request to the operator, who taps once to dial. So the states
 * mean exactly what they say:
 *
 *   DELIVERED              the phone fetched the command. Nothing has rung.
 *   AWAITING_CONFIRMATION  the phone is showing it to the operator. Nothing has rung.
 *   DIALING                the operator confirmed and the phone started the call.
 *   CONNECTED / COMPLETED / NO_ANSWER  read from the phone's own record of that call, never assumed.
 */
import type { CallRequestStatus } from "@prisma/client";

export type CallState = CallRequestStatus;

export const OPEN_CALL_STATES: readonly CallState[] = ["QUEUED", "DELIVERED", "AWAITING_CONFIRMATION", "DIALING", "CONNECTED"];
export const TERMINAL_CALL_STATES: readonly CallState[] = ["COMPLETED", "NO_ANSWER", "FAILED", "TIMED_OUT", "CANCELLED"];
/** States in which nothing has rung yet: the request can still be withdrawn or time out. */
export const PRE_DIAL_STATES: readonly CallState[] = ["QUEUED", "DELIVERED", "AWAITING_CONFIRMATION"];

const TRANSITIONS: Record<CallState, readonly CallState[]> = {
  QUEUED: ["DELIVERED", "AWAITING_CONFIRMATION", "DIALING", "FAILED", "TIMED_OUT", "CANCELLED"],
  DELIVERED: ["AWAITING_CONFIRMATION", "DIALING", "CONNECTED", "COMPLETED", "NO_ANSWER", "FAILED", "TIMED_OUT", "CANCELLED"],
  // From here a call record can arrive directly: the operator may have dialled from the system
  // dialler the app opened, which the app cannot see, but the phone's call log can.
  AWAITING_CONFIRMATION: ["DIALING", "CONNECTED", "COMPLETED", "NO_ANSWER", "FAILED", "TIMED_OUT", "CANCELLED"],
  DIALING: ["CONNECTED", "COMPLETED", "NO_ANSWER", "FAILED"],
  CONNECTED: ["COMPLETED"],
  COMPLETED: [], NO_ANSWER: [], FAILED: [], TIMED_OUT: [], CANCELLED: [],
};

export const canCallTransition = (from: CallState, to: CallState) => TRANSITIONS[from].includes(to);
export const isOpenCall = (s: CallState) => OPEN_CALL_STATES.includes(s);

/** What the phone itself may report. Everything after DIALING comes from its call record. */
export const PHONE_REPORTABLE: readonly CallState[] = ["AWAITING_CONFIRMATION", "DIALING", "FAILED", "CANCELLED"];

export const CALL_LIMITS = {
  /** How long the operator has to act before the request lapses. */
  ttlSecondsDefault: 120, ttlSecondsMin: 30, ttlSecondsMax: 600,
  /** Requests one user may make in a minute, and one guard may receive in ten. */
  perUserPerMinute: 6,
  perGuardPer10Minutes: 5,
  /** A call record counts as this request's call if it started this soon before the request... */
  matchBeforeSeconds: 30,
  /** ...or this long after it expired (a call is placed in the last seconds, then rings). */
  matchAfterExpirySeconds: 300,
  /** DIALING with no call record after this long is reported as failed, not left dialling for ever. */
  dialingWithoutRecordMinutes: 10,
  /** The first app version that understands PLACE_CALL. Older phones are not offered as gateways. */
  minAppVersion: "1.8.0",
} as const;

export const CALL_META: Record<CallState, { label: string; tone: "ok" | "warn" | "critical" | "info" | "neutral" | "muted"; icon: string; detail: string }> = {
  QUEUED:                { label: "Request queued",         tone: "neutral",  icon: "schedule_send",    detail: "Waiting for the gateway phone to collect it." },
  DELIVERED:             { label: "Delivered to the phone", tone: "info",     icon: "mobile_arrow_down", detail: "The gateway phone has the request. Nothing has rung yet." },
  AWAITING_CONFIRMATION: { label: "Waiting for the operator", tone: "info",   icon: "touch_app",        detail: "The phone is showing the request. The call starts when the operator taps Call." },
  DIALING:               { label: "Dialling",               tone: "info",     icon: "phone_forwarded",  detail: "The operator confirmed and the phone started the call." },
  CONNECTED:             { label: "Connected",              tone: "ok",       icon: "call",             detail: "The phone's call record shows the guard answered." },
  COMPLETED:             { label: "Call completed",         tone: "ok",       icon: "call_end",         detail: "Answered and ended, from the phone's call record." },
  NO_ANSWER:             { label: "Not answered",           tone: "warn",     icon: "phone_missed",     detail: "The phone dialled and the call ended without an answer." },
  FAILED:                { label: "Failed",                 tone: "critical", icon: "error",            detail: "The phone could not place the call." },
  TIMED_OUT:             { label: "Timed out",              tone: "warn",     icon: "timer_off",        detail: "Nobody acted on the request before it expired. No call was made." },
  CANCELLED:             { label: "Cancelled",              tone: "muted",    icon: "cancel",           detail: "Withdrawn before any call was made." },
};

/** "1.10.0" > "1.9.2": compares numerically, part by part. A "-debug" suffix is ignored. */
export function versionAtLeast(version: string | null | undefined, min: string): boolean {
  if (!version) return false;
  const a = version.replace(/-.*$/, "").split(".").map((n) => Number(n) || 0);
  const b = min.split(".").map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

/**
 * What the phone's own call record says about a requested call. Only an OUTGOING call to the
 * requested number, starting in the request's window, is that call. The status follows from the
 * record: answered means connected, ended-and-answered means completed, ended-unanswered means not
 * answered. A record that merely exists says nothing more than "dialling".
 */
export function stateFromCallRecord(call: { direction: "INCOMING" | "OUTGOING"; status: string; answeredAt: Date | null; endedAt: Date | null; durationSeconds: number | null }): CallState | null {
  if (call.direction !== "OUTGOING") return null;
  const answered = Boolean(call.answeredAt) || (call.durationSeconds ?? 0) > 0;
  if (call.endedAt || call.status === "ENDED" || call.status === "MISSED" || call.status === "FAILED") return answered ? "COMPLETED" : "NO_ANSWER";
  if (answered || call.status === "ANSWERED") return "CONNECTED";
  return "DIALING";
}

export function callRecordMatches(req: { phoneNumber: string; requestedAt: Date; expiresAt: Date }, call: { direction: "INCOMING" | "OUTGOING"; normalizedPhoneNumber: string; startedAt: Date }): boolean {
  if (call.direction !== "OUTGOING") return false;
  if (call.normalizedPhoneNumber !== req.phoneNumber) return false;
  const from = req.requestedAt.getTime() - CALL_LIMITS.matchBeforeSeconds * 1000;
  const to = req.expiresAt.getTime() + CALL_LIMITS.matchAfterExpirySeconds * 1000;
  return call.startedAt.getTime() >= from && call.startedAt.getTime() <= to;
}

/** The command the gateway phone receives. Only what it needs to show the operator and dial. */
export type PlaceCallCommand = { id: string; type: "PLACE_CALL"; requestedAt: string; expiresAt: string; phoneNumber: string; guardName: string; reason: string | null; requestedBy: string | null };
