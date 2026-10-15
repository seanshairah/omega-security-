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

test("location events validate coordinates and keep the phone's verdict", () => {
  const bad = validateEvent({ eventId: "l1", eventType: "LOCATION_CHECK", latitude: 120, longitude: 31, timestamp: "2026-10-15T20:00:00Z" });
  assert.equal(bad.ok, false);
  const ok = validateEvent({ eventId: "l2", eventType: "LOCATION_EXIT", latitude: -17.83, longitude: 31.05, accuracyM: 15, distanceM: 420, locationState: "OUTSIDE", provider: "gps", timestamp: "2026-10-15T22:15:00Z" });
  assert.ok(ok.ok);
  if (ok.ok && ok.event.kind === "location") {
    assert.equal(ok.event.locationState, "OUTSIDE");
    assert.equal(ok.event.distanceM, 420);
  }
  const call = validateEvent({ eventId: "c9", eventType: "CALL_STARTED", callId: "k1", phoneNumber: "+263772100100", direction: "INCOMING", timestamp: "2026-10-15T22:17:03Z", location: { latitude: -17.83, longitude: 31.05, locationState: "OUTSIDE" } });
  assert.ok(call.ok);
  if (call.ok && call.event.kind === "call") assert.equal((call.event.meta?.location as { locationState: string }).locationState, "OUTSIDE");
});
