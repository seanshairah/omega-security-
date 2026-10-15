import { test } from "node:test";
import assert from "node:assert/strict";
import { initialCallState, reduceCall, saneTimestamp, fmtCallDuration, type IncomingGatewayEvent } from "../src/lib/gateway/call-state";

const t0 = new Date("2026-10-15T20:14:00Z");
const ev = (eventType: IncomingGatewayEvent["eventType"], extra: Partial<IncomingGatewayEvent> = {}): IncomingGatewayEvent => ({ eventId: Math.random().toString(36), eventType, callId: "c1", phoneNumber: "+263771234567", timestamp: t0, ...extra });
const sec = (n: number) => new Date(t0.getTime() + n * 1000);

test("incoming call: ringing → answered → ended with duration", () => {
  let s = initialCallState(ev("CALL_STARTED"), t0);
  assert.equal(s.status, "RINGING");
  assert.equal(s.direction, "INCOMING");
  s = reduceCall(s, ev("CALL_ANSWERED"), sec(6));
  assert.equal(s.status, "ANSWERED");
  assert.equal(s.answeredAt?.getTime(), sec(6).getTime());
  s = reduceCall(s, ev("CALL_ENDED"), sec(228));
  assert.equal(s.status, "ENDED");
  assert.equal(s.durationSeconds, 222);
  assert.equal(fmtCallDuration(s.durationSeconds), "03:42");
});

test("incoming call never answered ends as MISSED", () => {
  let s = initialCallState(ev("CALL_STARTED"), t0);
  s = reduceCall(s, ev("CALL_ENDED"), sec(20));
  assert.equal(s.status, "MISSED");
  assert.equal(s.durationSeconds, 0);
});

test("explicit CALL_MISSED is terminal and a late ENDED does not regress it", () => {
  let s = initialCallState(ev("CALL_STARTED"), t0);
  s = reduceCall(s, ev("CALL_MISSED"), sec(25));
  assert.equal(s.status, "MISSED");
  const again = reduceCall(s, ev("CALL_ENDED", { answered: false }), sec(26));
  assert.equal(again.status, "MISSED");
});

test("device verdict wins: ENDED with answered=true and durationSeconds fills answeredAt", () => {
  let s = initialCallState(ev("CALL_STARTED"), t0);
  s = reduceCall(s, ev("CALL_ENDED", { answered: true, durationSeconds: 90 }), sec(100));
  assert.equal(s.status, "ENDED");
  assert.equal(s.durationSeconds, 90);
  assert.equal(s.answeredAt?.getTime(), sec(10).getTime());
});

test("duplicate and out-of-order events are idempotent", () => {
  let s = initialCallState(ev("CALL_ENDED", { answered: true, durationSeconds: 30 }), sec(40));
  assert.equal(s.status, "ENDED");
  const late = reduceCall(s, ev("CALL_STARTED"), t0);
  assert.equal(late.status, "ENDED");
  assert.equal(late.startedAt.getTime(), sec(40).getTime(), "a late STARTED must not reopen a finished call");
  const dup = reduceCall(late, ev("CALL_ENDED", { answered: true, durationSeconds: 30 }), sec(40));
  assert.equal(dup, late, "same object back when nothing changes");
});

test("outgoing call not answered ends as FAILED", () => {
  let s = initialCallState(ev("CALL_STARTED", { direction: "OUTGOING" }), t0);
  assert.equal(s.direction, "OUTGOING");
  s = reduceCall(s, ev("CALL_ENDED", { answered: false }), sec(30));
  assert.equal(s.status, "FAILED");
});

test("device clocks are clamped to a sane window", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  assert.equal(saneTimestamp("garbage", now).getTime(), now.getTime());
  assert.equal(saneTimestamp(new Date("2030-01-01T00:00:00Z"), now).getTime(), now.getTime() + 5 * 60_000);
  assert.equal(saneTimestamp(new Date("2020-01-01T00:00:00Z"), now).getTime(), now.getTime() - 7 * 86400_000);
});
