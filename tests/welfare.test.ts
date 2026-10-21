import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWelfareTimes, welfareDuePoints, mapVoiceReport, nextFollowUp, hasSchedule, type FollowUpFacts } from "../src/lib/welfare/welfare-rules";
import { signVoiceWebhook, verifyVoiceWebhook, WEBHOOK_MAX_SKEW_MS } from "../src/lib/voice/provider";

const at = (iso: string) => new Date(iso);
// 18:00–06:00 Harare (UTC+2) is 16:00Z–04:00Z.
const START = at("2026-10-21T16:00:00Z"), END = at("2026-10-22T04:00:00Z");

test("welfare times parse, dedupe and refuse nonsense", () => {
  assert.deepEqual(parseWelfareTimes("00:00, 03:30;00:00"), [{ h: 0, m: 0 }, { h: 3, m: 30 }]);
  assert.deepEqual(parseWelfareTimes(""), []);
  assert.throws(() => parseWelfareTimes("25:00"), /not a time/);
  assert.throws(() => parseWelfareTimes("midnight"), /not a time/);
  assert.equal(hasSchedule({ times: null, intervalMinutes: null }), false);
  assert.equal(hasSchedule({ times: " ", intervalMinutes: 0 }), false);
  assert.equal(hasSchedule({ times: "00:00", intervalMinutes: null }), true);
});

test("fixed times fall across midnight on an overnight shift", () => {
  const pts = welfareDuePoints(START, END, { times: "00:00,03:00", intervalMinutes: null });
  assert.deepEqual(pts.map((d) => d.toISOString()), ["2026-10-21T22:00:00.000Z", "2026-10-22T01:00:00.000Z"]);
});

test("times outside the shift, or on its start or end, are left out", () => {
  const pts = welfareDuePoints(START, END, { times: "18:00,12:00,06:00,22:00", intervalMinutes: null });
  assert.deepEqual(pts.map((d) => d.toISOString()), ["2026-10-21T20:00:00.000Z"]);
});

test("an interval counts from the shift start and stops before the end", () => {
  const pts = welfareDuePoints(START, END, { times: null, intervalMinutes: 240 });
  assert.deepEqual(pts.map((d) => d.toISOString()), ["2026-10-21T20:00:00.000Z", "2026-10-22T00:00:00.000Z"]);
  assert.equal(welfareDuePoints(START, END, { times: null, intervalMinutes: 5 }).length, 0, "below 15 minutes is ignored");
});

test("interval and times together never ring twice for the same minute", () => {
  const pts = welfareDuePoints(START, END, { times: "22:00", intervalMinutes: 240 });
  assert.equal(pts.length, 2);
});

test("a key press is the response; an answered call is not", () => {
  assert.deepEqual(mapVoiceReport("completed", "1"), { callStatus: "RESPONSE_CONFIRMED", response: "WELL" });
  assert.deepEqual(mapVoiceReport("completed", "2"), { callStatus: "RESPONSE_CONFIRMED", response: "ASSISTANCE" });
  assert.deepEqual(mapVoiceReport("completed", "3"), { callStatus: "RESPONSE_CONFIRMED", response: "INCIDENT" });
  assert.deepEqual(mapVoiceReport("answered", null), { callStatus: "CALL_ANSWERED", response: null });
  assert.deepEqual(mapVoiceReport("completed", "9"), { callStatus: "CALL_ANSWERED", response: null });
  assert.deepEqual(mapVoiceReport("no_answer", null), { callStatus: "NO_ANSWER", response: null });
  assert.deepEqual(mapVoiceReport("busy", null), { callStatus: "BUSY", response: null });
  assert.deepEqual(mapVoiceReport("ringing", null), { callStatus: "CALL_RINGING", response: null });
  assert.deepEqual(mapVoiceReport("something-new", null), { callStatus: "FAILED", response: null });
});

const facts = (o: Partial<FollowUpFacts>): FollowUpFacts => ({
  channel: "VOICE", callStatus: "NO_ANSWER", attempts: 1, lastAttemptAt: at("2026-10-21T22:00:00Z"), smsFallbackAt: null,
  maxAttempts: 2, retryMinutes: 10, smsFallback: true, guardSmsEnabled: true, responseMinutes: 15, now: at("2026-10-21T22:05:00Z"), ...o,
});

test("unanswered calls wait, retry, fall back to SMS, then escalate", () => {
  assert.equal(nextFollowUp(facts({})), "WAIT");
  assert.equal(nextFollowUp(facts({ now: at("2026-10-21T22:10:00Z") })), "RETRY");
  assert.equal(nextFollowUp(facts({ attempts: 2, now: at("2026-10-21T22:10:00Z") })), "SMS_FALLBACK");
  const fb = at("2026-10-21T22:20:00Z");
  assert.equal(nextFollowUp(facts({ attempts: 2, smsFallbackAt: fb, now: at("2026-10-21T22:30:00Z") })), "WAIT");
  assert.equal(nextFollowUp(facts({ attempts: 2, smsFallbackAt: fb, now: at("2026-10-21T22:35:00Z") })), "ESCALATE");
});

test("no SMS fallback when the site or the guard does not allow it", () => {
  assert.equal(nextFollowUp(facts({ attempts: 2, smsFallback: false, now: at("2026-10-21T22:10:00Z") })), "ESCALATE");
  assert.equal(nextFollowUp(facts({ attempts: 2, guardSmsEnabled: false, now: at("2026-10-21T22:10:00Z") })), "ESCALATE");
});

test("an SMS check retries by text, then escalates", () => {
  const sms = (o: Partial<FollowUpFacts>) => facts({ channel: "SMS", callStatus: null, ...o });
  assert.equal(nextFollowUp(sms({ now: at("2026-10-21T22:14:00Z") })), "WAIT");
  assert.equal(nextFollowUp(sms({ now: at("2026-10-21T22:15:00Z") })), "RETRY");
  assert.equal(nextFollowUp(sms({ attempts: 2, now: at("2026-10-21T22:15:00Z") })), "ESCALATE");
});

test("a gateway call the operator answered waits for them, it is never escalated as no answer", () => {
  assert.equal(nextFollowUp(facts({ channel: "GATEWAY_CALL", callStatus: "CALL_ANSWERED", attempts: 9, now: at("2026-10-22T03:00:00Z") })), "WAIT");
  // An automated call answered with no key press is still unanswered as far as welfare goes.
  assert.equal(nextFollowUp(facts({ channel: "VOICE", callStatus: "CALL_ANSWERED", now: at("2026-10-21T22:10:00Z") })), "RETRY");
});

test("voice webhooks: signed, fresh, and refused without a secret", () => {
  const body = JSON.stringify({ eventId: "e1", callId: "c1", status: "completed", digits: "1" });
  const now = Date.now();
  const ts = String(now);
  const sig = signVoiceWebhook("s3cret", ts, body);
  assert.deepEqual(verifyVoiceWebhook("s3cret", sig, ts, body, now), { ok: true });
  assert.equal(verifyVoiceWebhook(undefined, sig, ts, body, now).ok, false);
  assert.equal(verifyVoiceWebhook("s3cret", null, ts, body, now).ok, false);
  assert.equal(verifyVoiceWebhook("s3cret", sig, ts, body.replace("1\"}", "3\"}"), now).ok, false, "tampered body");
  assert.equal(verifyVoiceWebhook("other", sig, ts, body, now).ok, false, "wrong secret");
  assert.equal(verifyVoiceWebhook("s3cret", "zz", ts, body, now).ok, false, "malformed signature");
  const old = String(now - WEBHOOK_MAX_SKEW_MS - 1000);
  assert.equal(verifyVoiceWebhook("s3cret", signVoiceWebhook("s3cret", old, body), old, body, now).ok, false, "replayed later");
});
