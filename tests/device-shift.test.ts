import { test } from "node:test";
import assert from "node:assert/strict";
import { selectDeviceShift } from "../src/lib/gateway/device-shift";

const at = (iso: string) => new Date(iso);
// Zimbabwe is UTC+2: an 18:00–06:00 local night shift is 16:00Z–04:00Z the next day.
const night = { id: "night", startAt: at("2026-10-20T16:00:00Z"), endAt: at("2026-10-21T04:00:00Z") };
const day = { id: "day", startAt: at("2026-10-21T04:00:00Z"), endAt: at("2026-10-21T16:00:00Z") };
const tomorrowNight = { id: "next", startAt: at("2026-10-21T16:00:00Z"), endAt: at("2026-10-22T04:00:00Z") };

test("a shift in progress is the one, across midnight", () => {
  assert.equal(selectDeviceShift([night, day], at("2026-10-20T23:30:00Z"))?.id, "night"); // 01:30 local
});

test("back-to-back shifts: the earlier unclosed shift no longer hides the current one", () => {
  // The bug from the device test: the earlier shift was still open, the endpoint sent it, the phone showed "No shift".
  assert.equal(selectDeviceShift([night, day], at("2026-10-21T04:20:00Z"))?.id, "day");
  assert.equal(selectDeviceShift([night, day], at("2026-10-21T04:00:00Z"))?.id, "day"); // handover minute: the one that started last
});

test("ten minutes before the start the phone already monitors the new shift", () => {
  assert.equal(selectDeviceShift([night], at("2026-10-20T15:52:00Z"))?.id, "night");
});

test("just ended, with nothing about to start: still the ended shift for 30 minutes", () => {
  assert.equal(selectDeviceShift([day], at("2026-10-21T16:20:00Z"))?.id, "day");
});

test("about to start beats just ended", () => {
  assert.equal(selectDeviceShift([day, tomorrowNight], at("2026-10-21T16:00:00Z"))?.id, "next"); // in progress from 16:00
  assert.equal(selectDeviceShift([day, { ...tomorrowNight, startAt: at("2026-10-21T16:05:00Z") }], at("2026-10-21T16:01:00Z"))?.id, "next");
});

test("otherwise the next shift, and nothing when there is none", () => {
  assert.equal(selectDeviceShift([tomorrowNight], at("2026-10-21T09:00:00Z"))?.id, "next");
  assert.equal(selectDeviceShift([], at("2026-10-21T09:00:00Z")), null);
});
