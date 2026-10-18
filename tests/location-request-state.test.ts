import { test } from "node:test";
import assert from "node:assert/strict";
import { canTransition, capturePlausible, commandFor, isExpired, isOpen, isTerminalRequest, OPEN_STATES, TERMINAL_STATES, REQUEST_LIMITS } from "../src/lib/location-request-state";

test("state machine: open states move forward, terminal states never change", () => {
  assert.equal(canTransition("PENDING", "DELIVERED"), true);
  assert.equal(canTransition("DELIVERED", "PROCESSING"), true);
  assert.equal(canTransition("PROCESSING", "COMPLETED"), true);
  assert.equal(canTransition("PENDING", "COMPLETED"), true, "a phone may answer before acknowledging");
  assert.equal(canTransition("DELIVERED", "PENDING"), false, "no going backwards");
  assert.equal(canTransition("PROCESSING", "DELIVERED"), false);
  for (const t of TERMINAL_STATES) for (const to of [...OPEN_STATES, ...TERMINAL_STATES]) assert.equal(canTransition(t, to), false, `${t} → ${to}`);
  for (const s of OPEN_STATES) { assert.equal(isOpen(s), true); assert.equal(canTransition(s, "EXPIRED"), true); assert.equal(canTransition(s, "CANCELLED"), true); }
  for (const s of TERMINAL_STATES) assert.equal(isTerminalRequest(s), true);
});

test("the command carries the deadline and the accuracy limit, never a coordinate", () => {
  const c = commandFor({ id: "r1", requestedAt: new Date("2026-10-18T20:45:00Z"), expiresAt: new Date("2026-10-18T20:48:00Z"), maxAccuracyM: 100, requireFreshFix: true });
  assert.deepEqual(c, { id: "r1", type: "REQUEST_LOCATION", requestedAt: "2026-10-18T20:45:00.000Z", expiresAt: "2026-10-18T20:48:00.000Z", maxAccuracyM: 100, requireFreshFix: true });
  assert.ok(!("latitude" in c) && !("longitude" in c));
});

test("expiry and plausibility of a claimed capture time", () => {
  const r = { requestedAt: new Date("2026-10-18T20:45:00Z"), expiresAt: new Date("2026-10-18T20:48:00Z") };
  assert.equal(isExpired(r, new Date("2026-10-18T20:47:59Z")), false);
  assert.equal(isExpired(r, new Date("2026-10-18T20:48:00Z")), true);
  const now = new Date("2026-10-18T20:47:00Z");
  assert.equal(capturePlausible(new Date("2026-10-18T20:46:30Z"), r, now).ok, true);
  assert.equal(capturePlausible(new Date("2026-10-18T20:40:00Z"), r, now).ok, false, "yesterday's fix cannot answer today's request");
  assert.equal(capturePlausible(new Date("2026-10-18T20:48:30Z"), r, new Date("2026-10-18T20:49:00Z")).ok, true, "late on the network within grace");
  assert.equal(capturePlausible(new Date("2026-10-18T20:50:00Z"), r, new Date("2026-10-18T20:51:00Z")).ok, false, "taken after the deadline + grace");
  assert.equal(capturePlausible(new Date("2026-10-18T20:46:00Z"), r, new Date("2026-10-18T20:43:00Z")).ok, false, "future beyond clock skew");
  assert.equal(capturePlausible(new Date("2026-10-18T20:46:00Z"), r, new Date("2026-10-18T20:45:00Z")).ok, true, "within clock skew");
  assert.ok(REQUEST_LIMITS.ttlSecondsMin < REQUEST_LIMITS.ttlSecondsDefault && REQUEST_LIMITS.ttlSecondsDefault <= REQUEST_LIMITS.ttlSecondsMax);
});
