import { test } from "node:test";
import assert from "node:assert/strict";
import { presentGuardLocation, type DeviceFacts } from "../src/lib/guard-status";

const now = new Date("2026-10-19T10:00:00Z");
const site = { name: "Depot", latitude: -17.8292, longitude: 31.0522, radiusM: 150 };
const dev = (o: Partial<DeviceFacts> = {}): DeviceFacts => ({ status: "ONLINE", activationStatus: "ACTIVE", lastSeenAt: new Date(now.getTime() - 60_000), shiftState: "NONE", gpsState: "OFF", gpsReason: null, monitoringState: "NOT_ON_SHIFT", lastLatitude: null, lastLongitude: null, lastAccuracyM: null, lastLocationAt: null, locationPermission: "background", mockLocationSeen: false, ...o });

test("connection follows the heartbeat age, not the stored status", () => {
  assert.equal(presentGuardLocation({ device: dev(), lastRequest: null, site, offlineMinutes: 5, accuracyMaxM: 100, now }).connection.state, "ONLINE");
  assert.equal(presentGuardLocation({ device: dev({ lastSeenAt: new Date(now.getTime() - 10 * 60_000) }), lastRequest: null, site, offlineMinutes: 5, accuracyMaxM: 100, now }).connection.state, "OFFLINE");
  assert.equal(presentGuardLocation({ device: dev({ status: "REVOKED" }), lastRequest: null, site, offlineMinutes: 5, accuracyMaxM: 100, now }).connection.state, "REVOKED");
  assert.equal(presentGuardLocation({ device: null, lastRequest: null, site, offlineMinutes: 5, accuracyMaxM: 100, now }).connection.state, "NONE");
});

test("a requested fix is a verified position even while monitoring is idle, and is not called inside by itself", () => {
  const p = presentGuardLocation({ device: dev({ gpsState: "OFF" }), lastRequest: { status: "COMPLETED", latitude: -17.8292 + 0.003, longitude: 31.0522, accuracyM: 8, capturedAt: new Date(now.getTime() - 120_000), mock: false }, site, offlineMinutes: 5, accuracyMaxM: 100, now });
  assert.equal(p.monitoring.gps, "OFF");
  assert.equal(p.position?.source, "REQUESTED");
  assert.equal(p.position?.freshness, "LIVE");
  assert.equal(p.geofence.assessment, "OUTSIDE", "333 m from the centre with ±8 m is outside a 150 m fence");
});

test("monitoring 'no usable fix' does not hide a fresh requested position", () => {
  const p = presentGuardLocation({ device: dev({ shiftState: "ACTIVE", gpsState: "LOCATION_UNAVAILABLE", gpsReason: "poor_accuracy", lastLatitude: -17.8292, lastLongitude: 31.0522, lastAccuracyM: 400, lastLocationAt: new Date(now.getTime() - 5 * 60_000) }), lastRequest: { status: "COMPLETED", latitude: -17.8292, longitude: 31.0522, accuracyM: 5, capturedAt: new Date(now.getTime() - 60_000), mock: false }, site, offlineMinutes: 5, accuracyMaxM: 100, now });
  assert.equal(p.monitoring.gps, "UNAVAILABLE");
  assert.match(p.monitoring.detail, /accuracy/);
  assert.equal(p.position?.source, "REQUESTED");
  assert.equal(p.geofence.assessment, "INSIDE");
});

test("poor accuracy is uncertain, a stale fix is stale, mock is never trusted", () => {
  const loose = presentGuardLocation({ device: dev({ shiftState: "ACTIVE", gpsState: "MONITORING", lastLatitude: -17.8292, lastLongitude: 31.0522, lastAccuracyM: 400, lastLocationAt: new Date(now.getTime() - 60_000) }), lastRequest: null, site, offlineMinutes: 5, accuracyMaxM: 100, now });
  assert.equal(loose.geofence.assessment, "UNCERTAIN");
  const old = presentGuardLocation({ device: dev({ lastLatitude: -17.8292, lastLongitude: 31.0522, lastAccuracyM: 10, lastLocationAt: new Date(now.getTime() - 3 * 3600_000) }), lastRequest: null, site, offlineMinutes: 5, accuracyMaxM: 100, now });
  assert.equal(old.position?.freshness, "STALE");
  assert.equal(old.geofence.assessment, "STALE");
  const mock = presentGuardLocation({ device: dev(), lastRequest: { status: "COMPLETED", latitude: -17.8292, longitude: 31.0522, accuracyM: 5, capturedAt: now, mock: true }, site, offlineMinutes: 5, accuracyMaxM: 100, now });
  assert.equal(mock.geofence.assessment, "UNCERTAIN");
  assert.equal(mock.geofence.label, "Mock location");
});

test("no site coordinates → not assessed, with the reason", () => {
  const p = presentGuardLocation({ device: dev({ lastLatitude: -17.8, lastLongitude: 31, lastAccuracyM: 10, lastLocationAt: now }), lastRequest: null, site: { name: "EOP-02", latitude: null, longitude: null, radiusM: 150 }, offlineMinutes: 5, accuracyMaxM: 100, now });
  assert.equal(p.geofence.assessment, "NOT_ASSESSED");
  assert.match(p.geofence.detail, /no coordinates/);
});
