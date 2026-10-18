import { test } from "node:test";
import assert from "node:assert/strict";
import { ALERT_EVENT_TYPES, ALERT_META, validateAlertEvent, describeAlertLocation } from "../src/lib/gateway/alerts";

test("every alert type has metadata and the serious ones require acknowledgement", () => {
  for (const t of ALERT_EVENT_TYPES) assert.ok(ALERT_META[t], t);
  assert.equal(ALERT_META.EMERGENCY.requiresAck, true);
  assert.equal(ALERT_META.EMERGENCY.severity, "CRITICAL");
  assert.equal(ALERT_META.EMERGENCY.shiftStatus, "CRITICAL");
  assert.equal(ALERT_META.NEED_ASSISTANCE.requiresAck, true);
  assert.equal(ALERT_META.SHIFT_OK.requiresAck, false);
  assert.equal(ALERT_META.STATUS_UPDATE.requiresAck, false);
  assert.equal(ALERT_META.HANDOVER.requiresAck, false);
  assert.ok(ALERT_META.INCIDENT_REPORT.incident && ALERT_META.SECURITY_ALERT.incident);
  assert.equal(ALERT_META.RUNNING_LATE.incident, undefined);
});

test("validation: message trimmed and capped, bad coordinates rejected, unknown type rejected", () => {
  const ok = validateAlertEvent({ message: "  Gate forced  " + "x".repeat(600), location: { latitude: -17.8, longitude: 31.0, accuracyM: 12, state: "INSIDE", ageSeconds: 40 }, shiftId: "s1" }, "e1", "SECURITY_ALERT");
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.event.message!.length, 500);
    assert.equal(ok.event.location?.state, "INSIDE");
    assert.equal(ok.event.shiftId, "s1");
  }
  const bad = validateAlertEvent({ location: { latitude: 95, longitude: 31 } }, "e2", "EMERGENCY");
  assert.equal(bad.ok, false);
  const noLoc = validateAlertEvent({}, "e3", "EMERGENCY");
  assert.ok(noLoc.ok && noLoc.event.location === undefined, "an emergency without a fix is still valid");
  assert.equal(validateAlertEvent({}, "e4", "PANIC").ok, false);
});

test("location wording never says outside from a stale or vague fix", () => {
  assert.equal(describeAlertLocation(undefined, "Mine"), "No position available at the time of the alert");
  assert.match(describeAlertLocation({ latitude: -17.8, longitude: 31, state: "INSIDE", accuracyM: 10 }, "Mine"), /inside Mine ±10 m/);
  assert.match(describeAlertLocation({ latitude: -17.8, longitude: 31, state: "UNKNOWN", accuracyM: 150 }, "Mine"), /position unverified/);
  assert.match(describeAlertLocation({ latitude: -17.8, longitude: 31, state: "OUTSIDE", ageSeconds: 900 }, "Mine"), /15 min old/);
});
