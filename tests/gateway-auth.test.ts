import { test } from "node:test";
import assert from "node:assert/strict";
import { generateActivationCode, generateDeviceToken, hashToken, rateLimit, resetRateLimits } from "../src/lib/gateway/auth";
import { validateEvent } from "../src/lib/gateway/events";

test("activation codes avoid ambiguous characters and tokens hash deterministically", () => {
  for (let i = 0; i < 50; i++) assert.match(generateActivationCode(), /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  const t = generateDeviceToken();
  assert.ok(t.startsWith("gw_") && t.length > 40);
  assert.equal(hashToken(t), hashToken(t));
  assert.notEqual(hashToken(t), hashToken(generateDeviceToken()));
});

test("rate limit opens after the window", () => {
  resetRateLimits();
  assert.ok(rateLimit("k", 2, 60_000).ok);
  assert.ok(rateLimit("k", 2, 60_000).ok);
  const third = rateLimit("k", 2, 60_000);
  assert.equal(third.ok, false);
  assert.ok(third.retryAfterSeconds > 0);
});

test("event validation rejects malformed payloads and normalises good ones", () => {
  assert.equal(validateEvent(null).ok, false);
  assert.equal(validateEvent({ eventType: "CALL_STARTED" }).ok, false);
  assert.equal(validateEvent({ eventId: "e1", eventType: "TELEPORT" }).ok, false);
  assert.equal(validateEvent({ eventId: "e1", eventType: "CALL_STARTED" }).ok, false, "call events need a callId");
  const ok = validateEvent({ eventId: "e1", eventType: "call_ended", callId: "c1", phoneNumber: "0771234567", timestamp: "2026-10-15T20:14:00Z", durationSeconds: 12.6, answered: true, direction: "INCOMING" });
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.event.eventType, "CALL_ENDED");
    assert.equal(ok.event.durationSeconds, 13);
    assert.equal(ok.event.direction, "INCOMING");
  }
  assert.ok(validateEvent({ eventId: "e2", eventType: "DEVICE_ONLINE", timestamp: "2026-10-15T20:14:00Z" }).ok);
});
