import { test } from "node:test";
import assert from "node:assert/strict";
import { coordinatePairError, radiusError, geofenceChanged, effectiveGeofence, configVersionString, configApplied } from "../src/lib/site-config";

test("coordinates must come as a pair", () => {
  assert.equal(coordinatePairError(null, null), null);
  assert.equal(coordinatePairError(-17.8292, 31.0522), null);
  assert.ok(coordinatePairError(-17.8292, null));
  assert.ok(coordinatePairError(null, 31.0522));
  assert.ok(coordinatePairError(95, 31));
  assert.ok(coordinatePairError(-17, 190));
  assert.ok(coordinatePairError(0, 0), "0,0 is rejected");
});

test("radius limits", () => {
  assert.equal(radiusError(150), null);
  assert.equal(radiusError(null), null);
  assert.ok(radiusError(10));
  assert.ok(radiusError(6000));
  assert.ok(radiusError(150.5));
});

test("config version only moves when the fence moves or resizes", () => {
  const a = { latitude: -17.8292, longitude: 31.0522, geofenceRadiusM: 150 };
  assert.equal(geofenceChanged(a, { ...a }), false);
  assert.equal(geofenceChanged(a, { ...a, geofenceRadiusM: 200 }), true);
  assert.equal(geofenceChanged(a, { ...a, latitude: -17.83 }), true);
  assert.equal(geofenceChanged({ latitude: null, longitude: null, geofenceRadiusM: 150 }, a), true);
});

test("effective geofence prefers the shift override, falls back to the site, else null", () => {
  const site = { latitude: -17.8292, longitude: 31.0522, geofenceRadiusM: 150 };
  assert.deepEqual(effectiveGeofence(null, site), { fence: { latitude: -17.8292, longitude: 31.0522, radiusM: 150 }, source: "SITE" });
  assert.deepEqual(effectiveGeofence({ geofenceLatitude: -17.83, geofenceLongitude: 31.05, geofenceRadiusM: 60 }, site), { fence: { latitude: -17.83, longitude: 31.05, radiusM: 60 }, source: "SHIFT_OVERRIDE" });
  // Override without its own radius inherits the site's
  assert.equal(effectiveGeofence({ geofenceLatitude: -17.83, geofenceLongitude: 31.05, geofenceRadiusM: null }, site)!.fence.radiusM, 150);
  // Half an override is ignored
  assert.equal(effectiveGeofence({ geofenceLatitude: -17.83, geofenceLongitude: null, geofenceRadiusM: null }, site)!.source, "SITE");
  assert.equal(effectiveGeofence(null, { latitude: null, longitude: null, geofenceRadiusM: 150 }), null);
});

test("config version string and applied check", () => {
  assert.equal(configVersionString(3, 1), "3.1");
  assert.equal(configApplied("3.1", "3.1"), true);
  assert.equal(configApplied("3.1", "2.1"), false);
  assert.equal(configApplied("3.1", null), false);
});
