import { test } from "node:test";
import assert from "node:assert/strict";
import { haversineM, classifyFix, syncStatusFor, stepMonitor, initialMonitor, DEFAULT_POLICY, freshness } from "../src/lib/geofence";

const site = { latitude: -17.8292, longitude: 31.0522, radiusM: 150 };
// ~0.001° latitude ≈ 111 m
const at = (dLat: number, acc = 10) => ({ latitude: site.latitude + dLat, longitude: site.longitude, accuracyM: acc });

test("haversine distance is sane", () => {
  const d = haversineM(site.latitude, site.longitude, site.latitude + 0.001, site.longitude);
  assert.ok(d > 110 && d < 112, String(d));
});

test("classification is accuracy-aware", () => {
  assert.equal(classifyFix(at(0.0003), site).state, "INSIDE");          // 33 m
  assert.equal(classifyFix(at(0.0038), site).state, "OUTSIDE");         // 420 m
  assert.equal(classifyFix(at(0.0013, 30), site).state, "UNKNOWN");     // 144 m ± 30 straddles the fence
  assert.equal(classifyFix(at(0.0038, 200), site).state, "UNKNOWN");    // 420 m but ±200 m: do not decide
  assert.equal(classifyFix(at(0.0038, 200), site).reason, "poor_accuracy");
});

test("sync status reflects upload delay", () => {
  const t = new Date("2026-10-15T22:15:00Z");
  assert.equal(syncStatusFor(t, new Date(t.getTime() + 30_000)), "LIVE");
  assert.equal(syncStatusFor(t, new Date(t.getTime() + 300_000)), "SYNCED");
  assert.equal(syncStatusFor(t, new Date(t.getTime() + 85 * 60_000)), "SYNCED_LATE");
});

test("freshness never shows an old fix as live", () => {
  const now = new Date();
  assert.equal(freshness(new Date(now.getTime() - 5 * 60000), now).label, "LIVE");
  assert.equal(freshness(new Date(now.getTime() - 30 * 60000), now).label, "RECENT");
  assert.equal(freshness(new Date(now.getTime() - 3 * 3600000), now).label, "STALE");
  assert.equal(freshness(new Date(now.getTime() - 60000), now, "SYNCED_LATE").label, "SYNCED LATE");
});

test("section-50 scenario: inside checks, verified exit, throttled outside updates, return with duration", () => {
  const T = (hhmm: string) => new Date(`2026-10-15T${hhmm}:00Z`).getTime();
  let s = initialMonitor(T("18:03"));
  const out: string[] = [];
  const run = (atStr: string, state: "INSIDE" | "OUTSIDE" | "UNKNOWN", distanceM?: number, plusSec = 0) => {
    const r = stepMonitor(s, { at: T(atStr) + plusSec * 1000, state, distanceM }, DEFAULT_POLICY);
    s = r.next;
    for (const e of r.events) out.push(`${atStr}${plusSec ? `+${plusSec}s` : ""} ${e.type}${e.durationOutsideSeconds != null ? ` ${e.durationOutsideSeconds / 60}min` : ""}`);
    return r;
  };
  run("18:03", "INSIDE", 20);
  run("19:00", "INSIDE", 25);
  run("20:00", "INSIDE", 18);
  const first = run("22:15", "OUTSIDE", 420);
  assert.equal(first.events.length, 0, "first outside reading records nothing");
  assert.equal(first.nextCheckSeconds, 60, "re-check after the verification delay");
  const second = run("22:15", "OUTSIDE", 435, 60);
  assert.equal(second.events[0]?.type, "LOCATION_EXIT");
  run("22:18", "OUTSIDE", 440);          // within the outside interval: no new event
  run("22:25", "OUTSIDE", 480);          // due: LOCATION_OUTSIDE
  run("22:35", "OUTSIDE", 510);
  const back = run("23:05", "INSIDE", 38);
  assert.equal(back.events[0]?.type, "LOCATION_RETURNED");
  assert.equal(back.events[0]?.durationOutsideSeconds, 50 * 60, "outside since the first reading at 22:15");
  assert.deepEqual(out, ["18:03 LOCATION_CHECK", "19:00 LOCATION_CHECK", "20:00 LOCATION_CHECK", "22:15+60s LOCATION_EXIT", "22:25 LOCATION_OUTSIDE", "22:35 LOCATION_OUTSIDE", "23:05 LOCATION_RETURNED 50min"]);
});

test("a single spurious OUTSIDE reading followed by INSIDE creates no exit", () => {
  let s = initialMonitor(0);
  let r = stepMonitor(s, { at: 0, state: "INSIDE", distanceM: 10 }); s = r.next;
  r = stepMonitor(s, { at: 600_000, state: "OUTSIDE", distanceM: 300 }); s = r.next;
  assert.equal(s.phase, "VERIFYING_OUTSIDE");
  r = stepMonitor(s, { at: 660_000, state: "INSIDE", distanceM: 40 }); s = r.next;
  assert.equal(s.phase, "MONITORING");
  assert.equal(r.events[0].type, "LOCATION_CHECK");
});

test("UNKNOWN is never treated as OUTSIDE and is reported once", () => {
  let s = initialMonitor(0);
  let r = stepMonitor(s, { at: 0, state: "UNKNOWN", reason: "permission_revoked" }); s = r.next;
  assert.equal(r.events[0].type, "LOCATION_UNAVAILABLE");
  r = stepMonitor(s, { at: 300_000, state: "UNKNOWN", reason: "permission_revoked" }); s = r.next;
  assert.equal(r.events.length, 0, "repeated unavailability is not re-reported");
  r = stepMonitor(s, { at: 600_000, state: "INSIDE", distanceM: 5 }); s = r.next;
  assert.equal(s.phase, "MONITORING");
});
