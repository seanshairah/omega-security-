import { test } from "node:test";
import assert from "node:assert/strict";
import { accuracyFC, boundsOf, circleRing, fenceFC, mapLegend, MAP_COLOUR, pointColour, pointFC, pointHollow, pointIcon, trailFC, type MapPoint } from "../src/lib/map/features";

const guard = (over: Partial<MapPoint> = {}): MapPoint => ({ id: "g1", lat: -17.83, lng: 31.05, label: "Tendai", kind: "guard", ...over });

test("circleRing approximates a circle on the ground, not a square in degrees", () => {
  const ring = circleRing(-17.83, 31.05, 150);
  assert.equal(ring.length, 65, "closed ring");
  assert.deepEqual(ring[0], ring[64], "first and last vertex coincide");
  // Every vertex is ~150 m from the centre, measured with the haversine formula.
  const R = 6371008.8, rad = (d: number) => (d * Math.PI) / 180;
  for (const [lng, lat] of ring) {
    const dLat = rad(lat - -17.83), dLng = rad(lng - 31.05);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(-17.83)) * Math.cos(rad(lat)) * Math.sin(dLng / 2) ** 2;
    const d = 2 * R * Math.asin(Math.sqrt(a));
    assert.ok(Math.abs(d - 150) < 2, `vertex ${Math.round(d)} m from centre`);
  }
});

test("freshness beats geofence state: an old fix inside the fence is never drawn as on site", () => {
  assert.equal(pointColour(guard({ state: "INSIDE", freshness: "LIVE" })), MAP_COLOUR.inside);
  assert.equal(pointColour(guard({ state: "INSIDE", freshness: "RECENT" })), MAP_COLOUR.recent);
  assert.equal(pointColour(guard({ state: "INSIDE", freshness: "STALE" })), MAP_COLOUR.stale);
  assert.equal(pointColour(guard({ state: "OUTSIDE", freshness: "LIVE" })), MAP_COLOUR.outside);
  assert.equal(pointColour(guard({ state: "UNKNOWN" })), MAP_COLOUR.unknown);
  assert.ok(pointHollow(guard({ freshness: "STALE" })), "a stale fix is hollow");
  assert.ok(!pointHollow(guard({ freshness: "LIVE" })));
});

test("a requested fix keeps its own colour and glyph whatever the monitor says", () => {
  assert.equal(pointColour({ ...guard(), kind: "request", state: "OUTSIDE" }), MAP_COLOUR.request);
  assert.equal(pointIcon({ ...guard(), kind: "request" }), "my_location");
  assert.equal(pointIcon(guard()), "shield_person");
  assert.equal(pointIcon({ ...guard(), kind: "unavailable" }), "location_off");
});

test("points and accuracy rings are emitted as GeoJSON in lng,lat order", () => {
  const fc = pointFC([guard({ accuracyM: 25, freshness: "LIVE", state: "INSIDE" })]);
  assert.equal(fc.features.length, 1);
  assert.deepEqual(fc.features[0].geometry.coordinates, [31.05, -17.83]);
  assert.equal(fc.features[0].properties.colour, MAP_COLOUR.inside);
  assert.equal(fc.features[0].properties.hollow, false);
  const acc = accuracyFC([guard({ accuracyM: 25 }), guard({ id: "g2", accuracyM: null })]);
  assert.equal(acc.features.length, 1, "only fixes that reported an uncertainty get a ring");
  assert.equal(acc.features[0].properties.accuracyM, 25);
});

test("invalid coordinates are dropped rather than drawn at (0,0)", () => {
  const fc = pointFC([guard({ lat: NaN }), guard({ id: "b", lng: 999 }), guard({ id: "ok" })]);
  assert.deepEqual(fc.features.map((f) => f.properties.id), ["ok"]);
  assert.equal(fenceFC([{ id: "s", name: "S", lat: NaN, lng: 31, radiusM: 100 }]).features.length, 0);
  assert.equal(trailFC([{ id: "t", points: [{ lat: -17.8, lng: 31 }] }]).features.length, 0, "a one-point trail is not a line");
});

test("bounds include the whole fence and the whole accuracy ring", () => {
  const b = boundsOf([{ id: "s", name: "S", lat: -17.83, lng: 31.05, radiusM: 500 }], [guard({ accuracyM: 1000 })])!;
  assert.ok(b.north > -17.83 && b.south < -17.83 && b.east > 31.05 && b.west < 31.05);
  // A 1000 m accuracy ring is wider than a 500 m fence, so it sets the box.
  assert.ok((b.north - b.south) * 111_320 > 1900, "box covers the 1 km ring");
  assert.equal(boundsOf([], []), null, "nothing drawn, nothing to fit");
});

test("the legend only explains what is on the map", () => {
  const rows = mapLegend([guard({ freshness: "STALE", state: "UNKNOWN" })], true).map((r) => r.label);
  assert.ok(rows.includes("Site and fence"));
  assert.ok(rows.includes("Stale or unknown"));
  assert.ok(!rows.includes("Requested fix"), "no requested fix is drawn, so it is not explained");
  assert.ok(mapLegend([{ ...guard(), alert: "EMERGENCY" }], false).some((r) => r.label === "Open alert"));
});
