import { test } from "node:test";
import assert from "node:assert/strict";
import {
  callQualifies, computeLateness, describeOutcome, escalationState, fixCorrelates, pickShiftForCall,
  resolveGrace, statusForVerifiedFix, trustedTimestamp, DEFAULT_CORRELATION,
  type ShiftCandidate,
} from "../src/lib/attendance/check-in";

const at = (hhmm: string) => new Date(`2026-03-10T${hhmm}:00.000Z`);
const START = at("18:00");
const WINDOW = { beforeMinutes: 60, afterMinutes: 120 };
const shift = (over: Partial<ShiftCandidate> = {}): ShiftCandidate => ({ id: "s1", startAt: START, endAt: at("23:59"), cancelled: false, alreadyVerified: false, ...over });

// ---------------------------------------------------------------- the grace table from the brief

test("the five-minute grace table holds exactly", () => {
  const rows: [string, number, number, "early" | "grace" | "late"][] = [
    // arrival, minutes after start, late beyond grace, bucket
    ["17:58", 0, 0, "early"],
    ["18:00", 0, 0, "early"],
    ["18:04", 4, 0, "grace"],
    ["18:05", 5, 0, "grace"],
    ["18:06", 6, 1, "late"],
    ["18:12", 12, 7, "late"],
    ["18:30", 30, 25, "late"],
  ];
  for (const [arrival, after, late, bucket] of rows) {
    const l = computeLateness(START, at(arrival), 5);
    assert.equal(l.minutesAfterStart, after, `${arrival} minutes after start`);
    assert.equal(l.lateMinutes, late, `${arrival} late beyond grace`);
    assert.equal(l.early, bucket === "early", `${arrival} early`);
    assert.equal(l.withinGrace, bucket === "grace", `${arrival} within grace`);
    assert.equal(l.late, bucket === "late", `${arrival} late`);
  }
});

test("part minutes: elapsed time floors, lateness ceils", () => {
  const thirtySecondsIn = new Date(START.getTime() + 30_000);
  assert.equal(computeLateness(START, thirtySecondsIn, 5).minutesAfterStart, 0, "30 s in is still 0 min after the start");
  const thirtySecondsPastGrace = new Date(START.getTime() + 5 * 60_000 + 30_000);
  assert.equal(computeLateness(START, thirtySecondsPastGrace, 5).lateMinutes, 1, "any part-minute past grace is a late minute");
});

test("a zero grace period makes any arrival after the start late", () => {
  assert.equal(computeLateness(START, at("18:01"), 0).lateMinutes, 1);
  assert.equal(computeLateness(START, START, 0).lateMinutes, 0);
});

test("grace resolves shift over site over company", () => {
  assert.deepEqual(resolveGrace({ company: 5 }), { minutes: 5, from: "company" });
  assert.deepEqual(resolveGrace({ company: 5, site: 10 }), { minutes: 10, from: "site" });
  assert.deepEqual(resolveGrace({ company: 5, site: 10, shift: 0 }), { minutes: 0, from: "shift" });
  assert.deepEqual(resolveGrace({ company: 5, site: null, shift: null }), { minutes: 5, from: "company" });
});

// ---------------------------------------------------------------- the fix decides the outcome

test("the geofence verdict outranks the clock", () => {
  const onTime = computeLateness(START, at("18:00"), 5);
  const late = computeLateness(START, at("18:12"), 5);
  assert.equal(statusForVerifiedFix("INSIDE", undefined, onTime), "VERIFIED_ON_TIME");
  assert.equal(statusForVerifiedFix("INSIDE", undefined, computeLateness(START, at("18:04"), 5)), "VERIFIED_WITHIN_GRACE");
  assert.equal(statusForVerifiedFix("INSIDE", undefined, late), "VERIFIED_LATE");
  // Punctual but in the wrong place is not attendance.
  assert.equal(statusForVerifiedFix("OUTSIDE", undefined, onTime), "OUTSIDE_AREA");
  assert.equal(statusForVerifiedFix("UNKNOWN", "poor_accuracy", onTime), "LOCATION_UNCERTAIN");
  assert.equal(statusForVerifiedFix("UNKNOWN", "on_boundary", onTime), "LOCATION_UNCERTAIN");
  assert.equal(statusForVerifiedFix("UNKNOWN", undefined, onTime), "LOCATION_UNAVAILABLE");
});

test("the control-room line names both figures for a late arrival", () => {
  const l = computeLateness(START, at("18:12"), 5);
  assert.equal(describeOutcome("VERIFIED_LATE", l), "Late — 7 min beyond grace (12 min after shift start)");
  assert.equal(describeOutcome("VERIFIED_WITHIN_GRACE", computeLateness(START, at("18:04"), 5)), "Verified within grace (4 min after shift start)");
  assert.equal(describeOutcome("VERIFIED_ON_TIME", computeLateness(START, at("17:58"), 5)), "Verified on time");
});

// ---------------------------------------------------------------- which calls count

const call = (hhmm: string, over: Partial<Parameters<typeof callQualifies>[0]> = {}) => ({ startedAt: at(hhmm), direction: "OUTGOING" as const, normalizedPhoneNumber: "+263772100100", fromGuardDevice: true, ...over });

test("a call from the guard's registered device inside the window qualifies", () => {
  assert.equal(callQualifies(call("17:55"), shift(), WINDOW, []).ok, true);
  assert.equal(callQualifies(call("18:03"), shift(), WINDOW, []).ok, true);
});

test("caller ID alone is never enough: the device must have reported the call", () => {
  const r = callQualifies(call("18:00", { fromGuardDevice: false }), shift(), WINDOW, []);
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /registered device/);
});

test("calls outside the window, on a cancelled shift, or after a verified check-in are rejected", () => {
  assert.match((callQualifies(call("16:30"), shift(), WINDOW, []) as { reason: string }).reason, /before the check-in window/);
  assert.match((callQualifies(call("20:30"), shift(), WINDOW, []) as { reason: string }).reason, /after the check-in window/);
  assert.match((callQualifies(call("18:00"), shift({ cancelled: true }), WINDOW, []) as { reason: string }).reason, /cancelled/);
  assert.match((callQualifies(call("18:00"), shift({ alreadyVerified: true }), WINDOW, []) as { reason: string }).reason, /already checked in/);
});

test("an authorised check-in number list excludes unrelated calls", () => {
  const authorised = ["+263772100100"];
  assert.equal(callQualifies(call("18:00"), shift(), WINDOW, authorised).ok, true);
  const personal = callQualifies(call("18:00", { normalizedPhoneNumber: "+263771111111" }), shift(), WINDOW, authorised);
  assert.equal(personal.ok, false);
  assert.match((personal as { reason: string }).reason, /authorised check-in number/);
});

// ---------------------------------------------------------------- overlapping shifts

test("overlapping shifts are reported as ambiguous rather than guessed", () => {
  const a = shift({ id: "a", startAt: at("18:00") });
  const b = shift({ id: "b", startAt: at("18:10"), endAt: at("23:00") });
  const r = pickShiftForCall(at("18:02"), [a, b], WINDOW);
  assert.ok("ambiguous" in r, "two near-simultaneous shifts must not be auto-assigned");
  assert.equal((r as { ambiguous: ShiftCandidate[] }).ambiguous.length, 2);
});

test("a clearly nearer shift wins over a distant one", () => {
  const near = shift({ id: "near", startAt: at("18:00") });
  const far = shift({ id: "far", startAt: at("19:30"), endAt: at("23:59") });
  const r = pickShiftForCall(at("18:02"), [near, far], WINDOW);
  assert.ok("shift" in r);
  assert.equal((r as { shift: ShiftCandidate }).shift.id, "near");
});

test("a cancelled shift is never picked, and no candidate reports none", () => {
  assert.ok("none" in pickShiftForCall(at("18:02"), [shift({ cancelled: true })], WINDOW));
  assert.ok("none" in pickShiftForCall(at("18:02"), [], WINDOW));
});

// ---------------------------------------------------------------- correlating a fix to a call

test("a fix shortly after the call is the arrival evidence", () => {
  assert.equal(fixCorrelates(at("18:03"), at("18:04"), at("18:04")).ok, true);
});

test("a stale fix is never arrival evidence", () => {
  const r = fixCorrelates(at("18:03"), at("17:40"), at("18:04"));
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /before the call/);
  const old = fixCorrelates(at("18:03"), at("18:03"), at("18:40"), DEFAULT_CORRELATION);
  assert.equal(old.ok, false, "a fix that took 37 min to arrive is too old to prove arrival");
});

test("a fix long after the call does not prove arrival at the call time", () => {
  const r = fixCorrelates(at("18:03"), at("18:40"), at("18:40"));
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /after the call/);
});

// ---------------------------------------------------------------- clock manipulation

test("a device clock set back cannot manufacture an on-time arrival", () => {
  const received = at("18:20");
  const claimed = at("18:00");
  const t = trustedTimestamp(claimed, received, 10);
  assert.equal(t.adjusted, true);
  assert.equal(t.at.getTime(), received.getTime(), "the server's receipt time is used instead");
  assert.match(t.reason!, /behind/);
});

test("a device clock set forward is also rejected, and small skew is tolerated", () => {
  assert.equal(trustedTimestamp(at("18:30"), at("18:00"), 10).adjusted, true);
  const fine = trustedTimestamp(at("18:02"), at("18:03"), 10);
  assert.equal(fine.adjusted, false);
  assert.equal(fine.at.getTime(), at("18:02").getTime(), "a plausible device timestamp is kept");
});

// ---------------------------------------------------------------- escalation phases

test("the check-in moves from grace to overdue to escalation", () => {
  const p = { graceMinutes: 5, escalationMinutes: 15 };
  assert.equal(escalationState(START, at("17:50"), p).phase, "BEFORE_START");
  assert.equal(escalationState(START, at("18:03"), p).phase, "IN_GRACE");
  assert.equal(escalationState(START, at("18:05"), p).phase, "IN_GRACE", "the grace minute itself is still grace");
  assert.equal(escalationState(START, at("18:06"), p).phase, "OVERDUE");
  assert.equal(escalationState(START, at("18:19"), p).phase, "OVERDUE");
  assert.equal(escalationState(START, at("18:20"), p).phase, "ESCALATE");
  assert.equal(escalationState(START, at("18:12"), p).minutesAfterStart, 12);
});
