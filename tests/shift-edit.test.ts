import { test } from "node:test";
import assert from "node:assert/strict";
import { editPolicy, deletePolicy, type ShiftTraceCounts } from "../src/lib/shift-edit";

const noTrace: ShiftTraceCounts = { checkIns: 0, welfareChecks: 0, incidents: 0, smsMessages: 0, callLogs: 0, locationEvents: 0, alerts: 0, notifications: 0 };

test("a scheduled shift that nothing has touched is fully editable", () => {
  const p = editPolicy({ status: "SCHEDULED" });
  assert.equal(p.canEdit, true);
  assert.equal(p.canMoveSchedule, true);
  assert.equal(p.reason, null);
});

test("a closed shift is a record of what happened and is never edited", () => {
  for (const status of ["COMPLETED", "MISSED", "CANCELLED"] as const) {
    const p = editPolicy({ status });
    assert.equal(p.canEdit, false, status);
    assert.equal(p.canMoveSchedule, false, status);
    assert.match(p.reason!, /cannot be edited/);
  }
});

test("once the guard is on post the paperwork stays editable but the schedule is fixed", () => {
  const p = editPolicy({ status: "ON_DUTY", arrivalConfirmedAt: new Date() });
  assert.equal(p.canEdit, true, "instructions and the geofence can still be corrected");
  assert.equal(p.canMoveSchedule, false, "guard, site and times are anchored to the attendance record");
  assert.match(p.reason!, /on post/);
});

test("a running shift locks the schedule even before an arrival is recorded", () => {
  for (const status of ["LATE", "NOT_CONFIRMED", "ASSISTANCE", "INCIDENT", "CRITICAL"] as const) {
    const p = editPolicy({ status });
    assert.equal(p.canEdit, true, status);
    assert.equal(p.canMoveSchedule, false, status);
  }
});

test("sending the arrival check locks the schedule: the guard has already been told", () => {
  const p = editPolicy({ status: "AWAITING_ARRIVAL", arrivalSmsSentAt: new Date() });
  assert.equal(p.canMoveSchedule, false);
  assert.match(p.reason!, /already been sent/);
  // Before that check goes out, the same shift can still be moved.
  assert.equal(editPolicy({ status: "AWAITING_ARRIVAL" }).canMoveSchedule, true);
});

test("an untouched scheduled shift can be deleted", () => {
  const d = deletePolicy({ status: "SCHEDULED" }, noTrace);
  assert.equal(d.canDelete, true);
  assert.equal(d.reason, null);
});

test("a cancelled shift with no trace can still be deleted; one with history cannot", () => {
  assert.equal(deletePolicy({ status: "CANCELLED" }, noTrace).canDelete, true);
  const withSms = deletePolicy({ status: "CANCELLED" }, { ...noTrace, smsMessages: 2 });
  assert.equal(withSms.canDelete, false);
  assert.match(withSms.reason!, /2 messages/);
  assert.match(withSms.reason!, /Cancel it instead/);
});

test("an attendance record blocks deletion outright", () => {
  const d = deletePolicy({ status: "SCHEDULED", arrivalConfirmedAt: new Date() }, noTrace);
  assert.equal(d.canDelete, false);
  assert.match(d.reason!, /attendance/);
});

test("every kind of operational trace blocks deletion and is named in the reason", () => {
  const cases: [keyof ShiftTraceCounts, RegExp][] = [
    ["checkIns", /1 check-in/], ["welfareChecks", /1 welfare check/], ["incidents", /1 incident/],
    ["smsMessages", /1 message/], ["callLogs", /1 call/], ["locationEvents", /1 location event/],
    ["alerts", /1 alert/], ["notifications", /1 notification/],
  ];
  for (const [key, pattern] of cases) {
    const d = deletePolicy({ status: "SCHEDULED" }, { ...noTrace, [key]: 1 });
    assert.equal(d.canDelete, false, key);
    assert.match(d.reason!, pattern, key);
  }
});

test("a completed or running shift is never deletable, even with no trace rows", () => {
  for (const status of ["COMPLETED", "MISSED", "ON_DUTY", "CRITICAL"] as const) {
    assert.equal(deletePolicy({ status }, noTrace).canDelete, false, status);
  }
});
