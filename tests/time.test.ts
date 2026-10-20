import { test } from "node:test";
import assert from "node:assert/strict";
import {
  combineDateTime, dateInputValue, timeInputValue, fmtTime, fmtDate, fmtShort,
  startOfToday, endOfToday, zonedWallClockToInstant, instantToZonedParts,
} from "../src/lib/time";

// These run under whatever TZ the test host has. That is the point: the results below must not
// depend on it. The suite is run twice by `npm run test:time`, once with TZ=UTC and once with
// TZ=America/New_York, and both must pass.

const HARARE = "Africa/Harare"; // UTC+2 all year, no DST

test("an 18:00 shift typed in the portal is stored as 16:00Z, not 18:00Z", () => {
  const start = combineDateTime("2026-10-21", "18:00");
  assert.equal(start.toISOString(), "2026-10-21T16:00:00.000Z");
});

test("a guard arriving at 18:00 Harare is on time, not two hours early", () => {
  // The defect this file exists for: with the host-clock version the difference was -120 minutes.
  const shiftStart = combineDateTime("2026-10-21", "18:00");
  const arrival = new Date("2026-10-21T18:00:00+02:00");
  assert.equal(arrival.getTime() - shiftStart.getTime(), 0);
});

test("midnight and the end of the day are Harare boundaries", () => {
  const midnight = zonedWallClockToInstant(2026, 10, 21, 0, 0, HARARE);
  assert.equal(midnight.toISOString(), "2026-10-20T22:00:00.000Z");
  const lastMinute = zonedWallClockToInstant(2026, 10, 21, 23, 59, HARARE);
  assert.equal(lastMinute.toISOString(), "2026-10-21T21:59:00.000Z");
});

test("round trip: wall clock -> instant -> wall clock", () => {
  for (const [h, mi] of [[0, 0], [6, 30], [12, 0], [18, 0], [23, 59]] as const) {
    const inst = zonedWallClockToInstant(2026, 10, 21, h, mi, HARARE);
    const back = instantToZonedParts(inst, HARARE);
    assert.deepEqual([back.year, back.month, back.day, back.hour, back.minute], [2026, 10, 21, h, mi]);
  }
});

test("formatting reads the clock in Harare, whatever the host is set to", () => {
  const instant = new Date("2026-10-21T16:00:00.000Z"); // 18:00 Harare
  assert.equal(fmtTime(instant), "18:00");
  assert.equal(fmtDate(instant), "21 Oct 2026");
  assert.equal(fmtShort(instant), "21 Oct 18:00");
});

test("an instant late in the UTC day is already tomorrow in Harare", () => {
  const instant = new Date("2026-10-21T23:30:00.000Z"); // 01:30 on the 22nd, Harare
  assert.equal(fmtDate(instant), "22 Oct 2026");
  assert.equal(fmtTime(instant), "01:30");
});

test("an instant just before Harare midnight is still today", () => {
  const instant = new Date("2026-10-21T21:30:00.000Z"); // 23:30 on the 21st
  assert.equal(fmtDate(instant), "21 Oct 2026");
  assert.equal(fmtTime(instant), "23:30");
});

test("date and time inputs round trip through combineDateTime", () => {
  const original = combineDateTime("2026-03-09", "07:45");
  assert.equal(dateInputValue(original), "2026-03-09");
  assert.equal(timeInputValue(original), "07:45");
  assert.equal(combineDateTime(dateInputValue(original), timeInputValue(original)).getTime(), original.getTime());
});

test("today's boundaries are 24 hours apart and bracket now", () => {
  const a = startOfToday();
  const b = endOfToday();
  assert.ok(b.getTime() - a.getTime() === 24 * 60 * 60 * 1000 - 1, `got ${b.getTime() - a.getTime()}`);
  const now = Date.now();
  assert.ok(a.getTime() <= now && now <= b.getTime());
});

test("midnight is formatted as 00:00, never 24:00", () => {
  const midnight = zonedWallClockToInstant(2026, 10, 21, 0, 0, HARARE);
  assert.equal(fmtTime(midnight), "00:00");
  assert.equal(timeInputValue(midnight), "00:00");
});

test("a zone with DST is handled on both sides of the transition", () => {
  // London: BST (UTC+1) in July, GMT (UTC+0) in January.
  const summer = zonedWallClockToInstant(2026, 7, 15, 12, 0, "Europe/London");
  assert.equal(summer.toISOString(), "2026-07-15T11:00:00.000Z");
  const winter = zonedWallClockToInstant(2026, 1, 15, 12, 0, "Europe/London");
  assert.equal(winter.toISOString(), "2026-01-15T12:00:00.000Z");
});

test("null and invalid dates render as a dash rather than throwing", () => {
  for (const v of [null, undefined, "not a date"]) {
    assert.equal(fmtTime(v as never), "—");
    assert.equal(fmtDate(v as never), "—");
    assert.equal(fmtShort(v as never), "—");
  }
});
