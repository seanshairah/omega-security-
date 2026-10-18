import { test } from "node:test";
import assert from "node:assert/strict";
import { toLngLat, fromLngLat, isValidLatLng, accuracyVerdict, fixFreshness, deviceFixIsFresh, geolocationAvailability, geolocationErrorState, keepWatching, distanceM } from "../src/lib/geo-position";

test("lng/lat order is converted both ways without swapping", () => {
  const harare = { latitude: -17.8292, longitude: 31.0522 };
  assert.deepEqual(toLngLat(harare), [31.0522, -17.8292]);
  assert.deepEqual(fromLngLat([31.0522, -17.8292]), harare);
  assert.deepEqual(fromLngLat(toLngLat(harare)), harare);
});

test("validity: finite, in range, never 0,0", () => {
  assert.equal(isValidLatLng({ latitude: -17.8, longitude: 31 }), true);
  assert.equal(isValidLatLng({ latitude: 91, longitude: 31 }), false);
  assert.equal(isValidLatLng({ latitude: -17.8, longitude: 181 }), false);
  assert.equal(isValidLatLng({ latitude: 0, longitude: 0 }), false);
  assert.equal(isValidLatLng({ latitude: NaN, longitude: 31 }), false);
  assert.equal(isValidLatLng(null), false);
});

test("accuracy verdict scales with the fence", () => {
  assert.equal(accuracyVerdict(10, 150).level, "good");
  assert.equal(accuracyVerdict(50, 150).level, "usable");
  assert.equal(accuracyVerdict(400, 150).level, "poor");
  assert.equal(accuracyVerdict(80, 150).level, "poor", "80 m is more than half of 150");
  assert.equal(accuracyVerdict(80, 500).level, "usable");
  assert.equal(accuracyVerdict(undefined, 150).level, "unknown");
});

test("freshness of a browser fix", () => {
  const now = 1_000_000_000;
  assert.equal(fixFreshness(now - 5_000, now).fresh, true);
  assert.equal(fixFreshness(now - 90_000, now).fresh, true);
  assert.equal(fixFreshness(now - 600_000, now).fresh, false);
  assert.match(fixFreshness(now - 600_000, now).label, /cached or stale/);
});

test("a guard phone fix counts as fresh for three minutes", () => {
  const now = Date.now();
  assert.equal(deviceFixIsFresh(new Date(now - 60_000), 180, now), true);
  assert.equal(deviceFixIsFresh(new Date(now - 400_000), 180, now), false);
  assert.equal(deviceFixIsFresh(null), false);
});

test("secure-context guidance names the LAN origin and the fix", () => {
  assert.equal(geolocationAvailability({ secureContext: true, hasGeolocation: true, origin: "https://omega.example" }).ok, true);
  const lan = geolocationAvailability({ secureContext: false, hasGeolocation: true, origin: "http://172.20.10.3:3000" });
  assert.equal(lan.reason, "insecure_context");
  assert.match(lan.message!, /172\.20\.10\.3:3000/);
  assert.match(lan.message!, /https/);
  assert.equal(geolocationAvailability({ secureContext: true, hasGeolocation: false, origin: "https://x" }).reason, "unsupported");
});

test("error codes map to states", () => {
  assert.equal(geolocationErrorState(1).state, "permission_denied");
  assert.equal(geolocationErrorState(2).state, "unavailable");
  assert.equal(geolocationErrorState(3).state, "timed_out");
});

test("watch stops on a good fix or when the budget is spent", () => {
  assert.equal(keepWatching(null, 1_000, 150), true);
  assert.equal(keepWatching(60, 10_000, 150), true);
  assert.equal(keepWatching(12, 10_000, 150), false);
  assert.equal(keepWatching(60, 30_000, 150), false);
});

test("distance between two fixes", () => {
  const d = distanceM({ latitude: -17.8292, longitude: 31.0522 }, { latitude: -17.8292 + 0.001, longitude: 31.0522 });
  assert.ok(d > 110 && d < 112);
});
