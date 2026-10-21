import { test } from "node:test";
import assert from "node:assert/strict";
import { arrivalSource, phoneGroup } from "../src/lib/attendance/arrival-source";

const at = new Date();

test("GPS wins, and only GPS reads as GPS", () => {
  assert.equal(arrivalSource({ arrivalConfirmedAt: at, gpsVerified: true, confirmedSources: ["CALL"] }), "GPS");
  assert.equal(arrivalSource({ arrivalConfirmedAt: at, gpsVerified: false, confirmedSources: ["CALL", "SMS"] }), "CALL");
  assert.equal(arrivalSource({ arrivalConfirmedAt: at, gpsVerified: false, confirmedSources: ["SMS"] }), "SMS");
});

test("network beats a person, a person beats a call", () => {
  assert.equal(arrivalSource({ arrivalConfirmedAt: at, gpsVerified: false, confirmedSources: ["CALL", "NETWORK", "MANUAL"] }), "NETWORK");
  assert.equal(arrivalSource({ arrivalConfirmedAt: at, gpsVerified: false, confirmedSources: ["CALL", "MANUAL"] }), "MANUAL");
});

test("older arrivals without evidence say only 'confirmed'; none says none", () => {
  assert.equal(arrivalSource({ arrivalConfirmedAt: at, gpsVerified: false, confirmedSources: [] }), "CONFIRMED");
  assert.equal(arrivalSource({ arrivalConfirmedAt: null, gpsVerified: false, confirmedSources: [] }), "NONE");
});

test("phone groups: the guard app is Android, unknown stays unknown", () => {
  assert.equal(phoneGroup({ phoneType: "UNKNOWN", deviceKind: "ANDROID_GUARD" }), "ANDROID");
  assert.equal(phoneGroup({ phoneType: "BASIC", deviceKind: "FEATURE_PHONE" }), "BASIC");
  assert.equal(phoneGroup({ phoneType: "OTHER", deviceKind: "FEATURE_PHONE" }), "UNKNOWN");
});
