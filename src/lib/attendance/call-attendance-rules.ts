/**
 * Call attendance for guards without the guard app: pure rules, no database.
 *
 * A guard on a basic phone rings an operations gateway phone. The gateway app sees the call (number,
 * answered or not, duration) and nothing else: it cannot answer, play a prompt or read keys. So the
 * intention is never read from the number. It is read from *when* the call came, relative to the
 * shift, and from what has already happened on that shift:
 *
 *   not clocked in, inside the clock-in window             → CHECK_IN
 *   clocked in, inside the clock-out window                → CHECK_OUT
 *   clocked in, during the shift, before the clock-out window → WELFARE
 *   not clocked in, only inside the clock-out window       → held: a clock-out with no clock-in
 *   already clocked out, or outside every window           → ignored
 *
 * Then policy decides how much the call is worth:
 *
 *   answered, at least `answeredMinSeconds` long → CONFIRMED (or PENDING if answeredMode = PENDING)
 *   answered but shorter                        → PENDING, flagged SHORT_CALL
 *   missed (rang, nobody answered)              → missedCallMode: PENDING (default), PROVISIONAL
 *                                                  (clock-in only), SMS_CONFIRM (held until the guard
 *                                                  replies YES) or DISABLED
 *   to a gateway other than the expected one    → wrongGatewayMode: FLAG (default), PENDING or REJECT
 *   on a shift already closed (the call synced late) → PENDING, flagged SHIFT_CLOSED: never reopens a shift
 *   the operator rang the guard and they answered   → outgoingMode: CONFIRMED (default), PENDING or
 *                                                  DISABLED; flagged OPERATOR_CALLED. Unanswered: nothing
 *
 * A confirmed call means "a call came from the guard's registered number". It is labelled as a
 * call, never as location, and never proves who held the phone.
 */

export type CallIntent = "CHECK_IN" | "WELFARE" | "CHECK_OUT";
export type MissedCallMode = "DISABLED" | "PENDING" | "PROVISIONAL" | "SMS_CONFIRM";
export type WrongGatewayMode = "FLAG" | "PENDING" | "REJECT";

export type CallAttendancePolicy = {
  enabled: boolean;
  checkInBeforeMinutes: number;
  checkInAfterMinutes: number;
  checkOutBeforeMinutes: number;
  checkOutAfterMinutes: number;
  answeredMinSeconds: number;
  answeredMode: "CONFIRMED" | "PENDING";
  missedCallMode: MissedCallMode;
  wrongGatewayMode: WrongGatewayMode;
  /** The operator rang the guard from the operations phone and the guard answered. */
  outgoingMode: "CONFIRMED" | "PENDING" | "DISABLED";
};

export const DEFAULT_CALL_POLICY: CallAttendancePolicy = {
  enabled: true, checkInBeforeMinutes: 60, checkInAfterMinutes: 120, checkOutBeforeMinutes: 60, checkOutAfterMinutes: 120,
  answeredMinSeconds: 5, answeredMode: "CONFIRMED", missedCallMode: "PENDING", wrongGatewayMode: "FLAG", outgoingMode: "CONFIRMED",
};

export type CallFacts = {
  startedAt: Date;
  direction: "INCOMING" | "OUTGOING";
  /** Answered on the gateway (an operator spoke to the guard). */
  answered: boolean;
  /** Rang and was not answered: the guard's "missed call". */
  missed: boolean;
  durationSeconds: number | null;
};

export type ShiftFacts = {
  startAt: Date;
  endAt: Date;
  /** COMPLETED, MISSED and CANCELLED are closed: a late call never reopens them. */
  closed: boolean;
  checkedInAt: Date | null;
  checkedOutAt: Date | null;
};

export type Decision =
  | { action: "IGNORE"; reason: string; flags: string[] }
  | { action: "RECORD"; intent: CallIntent; status: "CONFIRMED" | "PROVISIONAL" | "PENDING" | "REJECTED"; source: "CALL" | "MISSED_CALL"; flags: string[]; reason: string; sendSmsConfirm: boolean };

const MIN = 60_000;

/** What a call at this time means for this shift, before any policy. Null when it means nothing. */
export function callIntent(t: Date, s: ShiftFacts, p: CallAttendancePolicy): { intent: CallIntent; flags: string[] } | { none: string } {
  const at = t.getTime();
  const start = s.startAt.getTime(), end = s.endAt.getTime();
  const inCheckIn = at >= start - p.checkInBeforeMinutes * MIN && at <= start + p.checkInAfterMinutes * MIN;
  const inCheckOut = at >= end - p.checkOutBeforeMinutes * MIN && at <= end + p.checkOutAfterMinutes * MIN;
  if (s.checkedOutAt) return { none: "already clocked out" };
  if (!s.checkedInAt) {
    // Arrival comes first: a short shift whose windows overlap is clocked in, not out.
    if (inCheckIn) return { intent: "CHECK_IN", flags: [] };
    if (inCheckOut) return { intent: "CHECK_OUT", flags: ["NO_CHECK_IN"] };
    if (at > start && at < end) return { intent: "CHECK_IN", flags: ["LATE_CHECK_IN"] };
    return { none: "outside the clock-in and clock-out windows" };
  }
  if (inCheckOut) return { intent: "CHECK_OUT", flags: [] };
  if (at > s.checkedInAt.getTime() && at < end) return { intent: "WELFARE", flags: [] };
  return { none: "outside the shift" };
}

/**
 * The whole decision for one call on one shift. `expectedGateway` is true when the call reached the
 * gateway assigned to the guard (or their site), false when another one, null when none is assigned.
 */
export function decideCall(call: CallFacts, shift: ShiftFacts, p: CallAttendancePolicy, expectedGateway: boolean | null): Decision {
  if (!p.enabled) return { action: "IGNORE", reason: "call attendance is off", flags: [] };
  const operatorCalled = call.direction === "OUTGOING";
  if (operatorCalled) {
    // The operator rang the guard. Answered, it is the same evidence as the guard ringing in: their
    // phone, their voice. Unanswered, it says nothing, and the operator chose the gateway.
    if (p.outgoingMode === "DISABLED") return { action: "IGNORE", reason: "operator calls do not count by policy", flags: [] };
    if (!call.answered) return { action: "IGNORE", reason: call.missed ? "the guard did not answer the operator's call" : "the call has not ended yet", flags: [] };
    expectedGateway = null;
  }
  if (!call.answered && !call.missed) return { action: "IGNORE", reason: "the call has not ended yet", flags: [] };
  const i = callIntent(call.startedAt, shift, p);
  if ("none" in i) return { action: "IGNORE", reason: i.none, flags: [] };

  const flags = [...i.flags, ...(operatorCalled ? ["OPERATOR_CALLED"] : [])];
  let status: "CONFIRMED" | "PROVISIONAL" | "PENDING" | "REJECTED";
  let reason: string;
  let sendSmsConfirm = false;
  const source = call.missed ? "MISSED_CALL" : "CALL";

  if (call.missed) {
    flags.push("MISSED_CALL");
    if (p.missedCallMode === "DISABLED") return { action: "IGNORE", reason: "missed calls do not count by policy", flags };
    if (p.missedCallMode === "PROVISIONAL") { status = "PROVISIONAL"; reason = "missed call, applied provisionally"; }
    else if (p.missedCallMode === "SMS_CONFIRM") { status = "PENDING"; reason = "missed call, waiting for the guard to reply YES"; sendSmsConfirm = true; }
    else { status = "PENDING"; reason = "missed call, waiting for a supervisor"; }
  } else if ((call.durationSeconds ?? 0) < p.answeredMinSeconds) {
    flags.push("SHORT_CALL");
    status = "PENDING"; reason = `answered for under ${p.answeredMinSeconds} s`;
  } else if (operatorCalled ? p.outgoingMode === "PENDING" : p.answeredMode === "PENDING") {
    status = "PENDING"; reason = "every call waits for a supervisor by policy";
  } else {
    status = "CONFIRMED"; reason = operatorCalled ? "the guard answered the operator's call on their registered number" : "answered call from the guard's registered number";
  }

  if (expectedGateway === false) {
    flags.push("WRONG_GATEWAY");
    if (p.wrongGatewayMode === "REJECT") { status = "REJECTED"; reason = "called a gateway not assigned to this guard"; sendSmsConfirm = false; }
    else if (p.wrongGatewayMode === "PENDING") { status = "PENDING"; reason = `${reason}; called a gateway not assigned to this guard`; }
  }
  // Provisional means "applied, review later". Only a clock-in can be undone cleanly; closing a shift
  // or settling a welfare check on a missed call waits for a person.
  if (status === "PROVISIONAL" && i.intent !== "CHECK_IN") { status = "PENDING"; reason = "missed call: only a clock-in is applied provisionally"; }
  // A clock-out with no clock-in, and a call on a shift the engine already closed, are for a person.
  if (flags.includes("NO_CHECK_IN") && (status === "CONFIRMED" || status === "PROVISIONAL")) { status = "PENDING"; reason = "clock-out call, but the guard never clocked in"; }
  if (shift.closed) {
    flags.push("SHIFT_CLOSED");
    if (status === "CONFIRMED" || status === "PROVISIONAL") { status = "PENDING"; reason = "the shift was already closed when this call arrived"; }
    sendSmsConfirm = false;
  }
  return { action: "RECORD", intent: i.intent, status, source, flags, reason, sendSmsConfirm };
}

/** Which of a guard's shifts a call belongs to. One, ambiguous (several equally likely), or none. */
export function pickShiftForAttendanceCall<T extends { id: string } & ShiftFacts>(t: Date, shifts: T[], p: CallAttendancePolicy): { shift: T } | { ambiguous: T[] } | { none: true } {
  const scored = shifts
    .map((s) => ({ s, i: callIntent(t, s, p) }))
    .filter((x): x is { s: T; i: { intent: CallIntent; flags: string[] } } => !("none" in x.i));
  if (!scored.length) return { none: true };
  // A shift in progress beats one about to start or just ended.
  const running = scored.filter((x) => t >= x.s.startAt && t <= x.s.endAt);
  const pool = running.length ? running : scored;
  // Clocking in to a shift nobody clocked into beats clocking out of one that is done.
  const checkIns = pool.filter((x) => x.i.intent === "CHECK_IN");
  const best = checkIns.length ? checkIns : pool;
  if (best.length === 1) return { shift: best[0].s };
  return { ambiguous: best.map((x) => x.s) };
}

export function parseCallPolicy(v: Record<string, string>): CallAttendancePolicy {
  const num = (k: string, d: number) => { const n = Number(v[k]); return Number.isFinite(n) && n >= 0 ? n : d; };
  const pick = <T extends string>(k: string, allowed: readonly T[], d: T): T => (allowed as readonly string[]).includes((v[k] ?? "").trim().toUpperCase()) ? (v[k].trim().toUpperCase() as T) : d;
  const d = DEFAULT_CALL_POLICY;
  return {
    enabled: (v["callAttendance.enabled"] ?? "true") === "true",
    checkInBeforeMinutes: num("callAttendance.checkInBeforeMinutes", d.checkInBeforeMinutes),
    checkInAfterMinutes: num("callAttendance.checkInAfterMinutes", d.checkInAfterMinutes),
    checkOutBeforeMinutes: num("callAttendance.checkOutBeforeMinutes", d.checkOutBeforeMinutes),
    checkOutAfterMinutes: num("callAttendance.checkOutAfterMinutes", d.checkOutAfterMinutes),
    answeredMinSeconds: num("callAttendance.answeredMinSeconds", d.answeredMinSeconds),
    answeredMode: pick("callAttendance.answeredMode", ["CONFIRMED", "PENDING"] as const, d.answeredMode),
    missedCallMode: pick("callAttendance.missedCallMode", ["DISABLED", "PENDING", "PROVISIONAL", "SMS_CONFIRM"] as const, d.missedCallMode),
    wrongGatewayMode: pick("callAttendance.wrongGatewayMode", ["FLAG", "PENDING", "REJECT"] as const, d.wrongGatewayMode),
    outgoingMode: pick("callAttendance.outgoingMode", ["CONFIRMED", "PENDING", "DISABLED"] as const, d.outgoingMode),
  };
}
