/**
 * What may be changed on a shift, and when it may be removed outright.
 *
 * Two separate questions, deliberately kept apart:
 *
 *  1. **Editing.** A closed shift is a record of what happened and is never edited. An open shift
 *     can always have its paperwork corrected (instructions, notes, supervisor, geofence). Its
 *     *schedule* — guard, site, date, times — may only move while the shift has not started
 *     operating, because the automation markers (arrival SMS sent, welfare midpoint, completion
 *     timers) and the attendance record are already anchored to the original window. Moving them
 *     underneath would make the attendance history describe a shift that never existed.
 *
 *  2. **Deleting.** Cancelling keeps the record and tells the guard; deleting destroys it. A shift
 *     that has produced any operational trace — an arrival, a check-in, a message, a call, a GPS
 *     event, an incident, an alert — is history and is never deleted, only cancelled. Deleting is
 *     for the shift created by mistake five minutes ago that nothing has touched.
 */
import type { ShiftStatus } from "@prisma/client";

/** Finished or abandoned: the record stands. */
export const CLOSED_STATUSES: ShiftStatus[] = ["COMPLETED", "MISSED", "CANCELLED"];
/** The guard is, or should be, on post: the schedule is now load-bearing. */
export const OPERATING_STATUSES: ShiftStatus[] = ["ON_DUTY", "LATE", "NOT_CONFIRMED", "ASSISTANCE", "INCIDENT", "CRITICAL"];

export type ShiftEditSubject = {
  status: ShiftStatus;
  /** Set once the guard is recorded on post, by SMS, GPS or an operator. */
  arrivalConfirmedAt?: Date | string | null;
  /** Set when the first automated check has gone out. */
  arrivalSmsSentAt?: Date | string | null;
};

export type EditPolicy = {
  /** Any change at all. */
  canEdit: boolean;
  /** Guard, site, date and times. */
  canMoveSchedule: boolean;
  /** Shown to the operator when something is refused. */
  reason: string | null;
};

export function editPolicy(s: ShiftEditSubject): EditPolicy {
  if (CLOSED_STATUSES.includes(s.status)) {
    return { canEdit: false, canMoveSchedule: false, reason: `This shift is ${s.status.toLowerCase()}. A closed shift is a record of what happened and cannot be edited.` };
  }
  if (s.arrivalConfirmedAt) {
    return { canEdit: true, canMoveSchedule: false, reason: "The guard is recorded on post, so the guard, site and times are fixed. Cancel the shift and create a new one if the posting itself changed." };
  }
  if (OPERATING_STATUSES.includes(s.status)) {
    return { canEdit: true, canMoveSchedule: false, reason: "This shift is already running, so the guard, site and times are fixed. Cancel it and create a new one if the posting itself changed." };
  }
  if (s.arrivalSmsSentAt) {
    return { canEdit: true, canMoveSchedule: false, reason: "The arrival check has already been sent to the guard, so the guard, site and times are fixed. Cancel the shift and create a new one instead." };
  }
  return { canEdit: true, canMoveSchedule: true, reason: null };
}

/** Rows that would make a shift part of the operational record. */
export type ShiftTraceCounts = {
  checkIns: number;
  welfareChecks: number;
  incidents: number;
  smsMessages: number;
  callLogs: number;
  locationEvents: number;
  alerts: number;
  notifications: number;
};

const TRACE_LABEL: Record<keyof ShiftTraceCounts, string> = {
  checkIns: "check-in", welfareChecks: "welfare check", incidents: "incident", smsMessages: "message",
  callLogs: "call", locationEvents: "location event", alerts: "alert", notifications: "notification",
};

export type DeletePolicy = { canDelete: boolean; reason: string | null };

export function deletePolicy(s: ShiftEditSubject, counts: ShiftTraceCounts): DeletePolicy {
  if (s.arrivalConfirmedAt) return { canDelete: false, reason: "This shift has an attendance record. Cancel it instead; deleting would erase the guard's attendance history." };
  if (OPERATING_STATUSES.includes(s.status) || s.status === "COMPLETED" || s.status === "MISSED") {
    return { canDelete: false, reason: `This shift is ${s.status.toLowerCase()} and is part of the operational record. Cancel it instead.` };
  }
  const traces = (Object.keys(TRACE_LABEL) as (keyof ShiftTraceCounts)[]).filter((k) => (counts[k] ?? 0) > 0);
  if (traces.length) {
    const named = traces.map((k) => `${counts[k]} ${TRACE_LABEL[k]}${counts[k] === 1 ? "" : "s"}`).join(", ");
    return { canDelete: false, reason: `This shift already has ${named}. Cancel it instead; deleting would erase that history.` };
  }
  return { canDelete: true, reason: null };
}

/** One line for the interface, explaining what cancelling does that deleting does not. */
export const DELETE_EXPLAINER = "Deleting removes the shift completely, as if it had never been scheduled. It is only possible while nothing has happened on it. To stop a shift that guards or clients already know about, cancel it instead: that keeps the record and the timeline.";
