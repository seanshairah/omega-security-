import { test } from "node:test";
import assert from "node:assert/strict";
import { callIntent, decideCall, pickShiftForAttendanceCall, parseCallPolicy, DEFAULT_CALL_POLICY as P, type ShiftFacts, type CallFacts } from "../src/lib/attendance/call-attendance-rules";

// 18:00–06:00 Harare (UTC+2) is 16:00Z–04:00Z.
const at = (iso: string) => new Date(iso);
const night = (o: Partial<ShiftFacts> = {}): ShiftFacts => ({ startAt: at("2026-10-21T16:00:00Z"), endAt: at("2026-10-22T04:00:00Z"), closed: false, checkedInAt: null, checkedOutAt: null, ...o });
const answered = (iso: string, seconds = 40): CallFacts => ({ startedAt: at(iso), direction: "INCOMING", answered: true, missed: false, durationSeconds: seconds });
const missed = (iso: string): CallFacts => ({ startedAt: at(iso), direction: "INCOMING", answered: false, missed: true, durationSeconds: 0 });

test("a call at 17:58 clocks the guard in, confirmed", () => {
  const d = decideCall(answered("2026-10-21T15:58:00Z"), night(), P, null);
  assert.equal(d.action, "RECORD");
  if (d.action === "RECORD") { assert.equal(d.intent, "CHECK_IN"); assert.equal(d.status, "CONFIRMED"); assert.equal(d.source, "CALL"); }
});

test("the intention comes from timing and state, never from the number", () => {
  const inShift = night({ checkedInAt: at("2026-10-21T15:58:00Z") });
  assert.deepEqual(callIntent(at("2026-10-21T22:00:00Z"), inShift, P), { intent: "WELFARE", flags: [] });
  assert.deepEqual(callIntent(at("2026-10-22T04:05:00Z"), inShift, P), { intent: "CHECK_OUT", flags: [] });
  assert.deepEqual(callIntent(at("2026-10-22T04:05:00Z"), night({ checkedInAt: at("2026-10-21T15:58:00Z"), checkedOutAt: at("2026-10-22T04:01:00Z") }), P), { none: "already clocked out" });
});

test("outside every window means nothing", () => {
  assert.equal(decideCall(answered("2026-10-21T12:00:00Z"), night(), P, null).action, "IGNORE");
  assert.equal(decideCall(answered("2026-10-22T08:00:00Z"), night({ checkedInAt: at("2026-10-21T16:00:00Z") }), P, null).action, "IGNORE");
});

test("a late clock-in during the shift is still a clock-in, flagged", () => {
  const d = decideCall(answered("2026-10-21T23:00:00Z"), night(), P, null);
  assert.ok(d.action === "RECORD" && d.intent === "CHECK_IN" && d.flags.includes("LATE_CHECK_IN"));
});

test("a clock-out with no clock-in is held for a person", () => {
  const d = decideCall(answered("2026-10-22T04:10:00Z"), night(), P, null);
  assert.ok(d.action === "RECORD" && d.intent === "CHECK_OUT" && d.status === "PENDING" && d.flags.includes("NO_CHECK_IN"));
});

test("missed calls follow the policy, pending by default, never verified", () => {
  const d = decideCall(missed("2026-10-21T15:58:00Z"), night(), P, null);
  assert.ok(d.action === "RECORD" && d.status === "PENDING" && d.source === "MISSED_CALL");
  assert.equal(decideCall(missed("2026-10-21T15:58:00Z"), night(), { ...P, missedCallMode: "DISABLED" }, null).action, "IGNORE");
  const prov = decideCall(missed("2026-10-21T15:58:00Z"), night(), { ...P, missedCallMode: "PROVISIONAL" }, null);
  assert.ok(prov.action === "RECORD" && prov.status === "PROVISIONAL");
  const sms = decideCall(missed("2026-10-21T15:58:00Z"), night(), { ...P, missedCallMode: "SMS_CONFIRM" }, null);
  assert.ok(sms.action === "RECORD" && sms.status === "PENDING" && sms.sendSmsConfirm);
});

test("a provisional missed call never clocks out or settles a welfare check", () => {
  const p = { ...P, missedCallMode: "PROVISIONAL" as const };
  const out = decideCall(missed("2026-10-22T04:05:00Z"), night({ checkedInAt: at("2026-10-21T16:00:00Z") }), p, null);
  assert.ok(out.action === "RECORD" && out.intent === "CHECK_OUT" && out.status === "PENDING");
  const welfare = decideCall(missed("2026-10-21T22:00:00Z"), night({ checkedInAt: at("2026-10-21T16:00:00Z") }), p, null);
  assert.ok(welfare.action === "RECORD" && welfare.intent === "WELFARE" && welfare.status === "PENDING");
});

test("a very short answered call is held", () => {
  const d = decideCall(answered("2026-10-21T15:58:00Z", 2), night(), P, null);
  assert.ok(d.action === "RECORD" && d.status === "PENDING" && d.flags.includes("SHORT_CALL"));
});

test("the wrong gateway is flagged, held or refused by policy", () => {
  const flag = decideCall(answered("2026-10-21T15:58:00Z"), night(), P, false);
  assert.ok(flag.action === "RECORD" && flag.status === "CONFIRMED" && flag.flags.includes("WRONG_GATEWAY"));
  const pend = decideCall(answered("2026-10-21T15:58:00Z"), night(), { ...P, wrongGatewayMode: "PENDING" }, false);
  assert.ok(pend.action === "RECORD" && pend.status === "PENDING");
  const rej = decideCall(answered("2026-10-21T15:58:00Z"), night(), { ...P, wrongGatewayMode: "REJECT" }, false);
  assert.ok(rej.action === "RECORD" && rej.status === "REJECTED");
  const right = decideCall(answered("2026-10-21T15:58:00Z"), night(), P, true);
  assert.ok(right.action === "RECORD" && !right.flags.includes("WRONG_GATEWAY"));
});

test("a call synced after the shift was closed never reopens it", () => {
  const d = decideCall(answered("2026-10-21T15:58:00Z"), night({ closed: true }), P, null);
  assert.ok(d.action === "RECORD" && d.status === "PENDING" && d.flags.includes("SHIFT_CLOSED"));
});

test("the operator ringing the guard counts when answered, by policy, and never as the wrong gateway", () => {
  const out = { ...answered("2026-10-21T15:58:00Z"), direction: "OUTGOING" as const };
  const d = decideCall(out, night(), P, false);
  assert.ok(d.action === "RECORD" && d.intent === "CHECK_IN" && d.status === "CONFIRMED" && d.flags.includes("OPERATOR_CALLED") && !d.flags.includes("WRONG_GATEWAY"));
  assert.equal(decideCall({ ...missed("2026-10-21T15:58:00Z"), direction: "OUTGOING" }, night(), P, null).action, "IGNORE", "unanswered says nothing");
  const pend = decideCall(out, night(), { ...P, outgoingMode: "PENDING" }, null);
  assert.ok(pend.action === "RECORD" && pend.status === "PENDING");
  assert.equal(decideCall(out, night(), { ...P, outgoingMode: "DISABLED" }, null).action, "IGNORE");
  assert.equal(parseCallPolicy({ "callAttendance.outgoingMode": "pending" }).outgoingMode, "PENDING");
  assert.equal(parseCallPolicy({ "callAttendance.outgoingMode": "nonsense" }).outgoingMode, "CONFIRMED");
});

test("calls still ringing are not attendance", () => {
  assert.equal(decideCall({ startedAt: at("2026-10-21T15:58:00Z"), direction: "INCOMING", answered: false, missed: false, durationSeconds: null }, night(), P, null).action, "IGNORE");
  assert.equal(decideCall(answered("2026-10-21T15:58:00Z"), night(), { ...P, enabled: false }, null).action, "IGNORE");
});

test("answeredMode PENDING holds every call", () => {
  const d = decideCall(answered("2026-10-21T15:58:00Z"), night(), { ...P, answeredMode: "PENDING" }, null);
  assert.ok(d.action === "RECORD" && d.status === "PENDING");
});

test("picking the shift: in progress first, clock-in first, ambiguous when two are equal", () => {
  const day = { id: "day", startAt: at("2026-10-21T04:00:00Z"), endAt: at("2026-10-21T16:00:00Z"), closed: false, checkedInAt: at("2026-10-21T04:00:00Z"), checkedOutAt: null };
  const nightS = { id: "night", ...night() };
  // 17:58 local, both windows: the day shift's clock-out and the night shift's clock-in. In progress wins: the day shift.
  const r = pickShiftForAttendanceCall(at("2026-10-21T15:58:00Z"), [day, nightS], P);
  assert.ok("shift" in r && r.shift.id === "day");
  // 18:05 local: the night shift is in progress and nobody has clocked into it.
  const r2 = pickShiftForAttendanceCall(at("2026-10-21T16:05:00Z"), [day, nightS], P);
  assert.ok("shift" in r2 && r2.shift.id === "night");
  const twin = { ...nightS, id: "twin" };
  const r3 = pickShiftForAttendanceCall(at("2026-10-21T15:58:00Z"), [nightS, twin], P);
  assert.ok("ambiguous" in r3 && r3.ambiguous.length === 2);
  assert.ok("none" in pickShiftForAttendanceCall(at("2026-10-21T09:00:00Z"), [nightS], P));
});

test("policy settings parse safely, unknown values fall back to the safe default", () => {
  const p = parseCallPolicy({ "callAttendance.missedCallMode": "sms_confirm", "callAttendance.wrongGatewayMode": "nonsense", "callAttendance.answeredMinSeconds": "-4" });
  assert.equal(p.missedCallMode, "SMS_CONFIRM");
  assert.equal(p.wrongGatewayMode, "FLAG");
  assert.equal(p.answeredMinSeconds, P.answeredMinSeconds);
});
