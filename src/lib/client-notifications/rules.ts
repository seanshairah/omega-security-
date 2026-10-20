/**
 * Rules that write to clients on their own. Each site chooses which ones apply (Location
 * `clientUpdates` and the `notifyClient*` switches). The supervisor is always told first: these
 * run after the internal notification for the same event.
 *
 *   guard verified on site (GPS) or arrival confirmed (SMS YES)  → "guard on site"   (notifyClientArrival)
 *   no check-in after the grace period, phone online            → "check-in not confirmed" (notifyClientAbsent)
 *                                                                  or "running late"  (notifyClientLate)
 *   no check-in, phone offline                                   → nothing: an offline phone is not an absent guard
 *   guard's phone outside the site                               → draft for the super admin (notifyClientOutside)
 *   emergency reported                                           → draft for the super admin (notifyClientEmergency)
 *   all well, shift ended                                        → as before (notifyClientWelfare, notifyClientCompletion)
 *
 * Every rule message carries a dedupe key per shift (or incident) and channel, so a repeated GPS
 * fix, a retried phone event or a second engine tick never writes to the client twice. Nothing here
 * throws: a failure to notify the client never breaks the attendance or incident flow.
 */
import type { ClientNotificationType } from "@prisma/client";
import { db } from "@/lib/db";
import { ruleKey } from "./policy";
import { createClientNotification, draftMessage, resolveTarget, ruleRecipients } from "./service";

type Rule = Parameters<typeof ruleKey>[0];

export type RuleOutcome = { sent: number; drafted: number; deduped: number; failed: number; skipped?: string };

async function fire(opts: { rule: Rule; type: ClientNotificationType; ref: string; target: { shiftId?: string | null; incidentId?: string | null }; eventRef: string; draft: boolean; at?: Date }): Promise<RuleOutcome> {
  const out: RuleOutcome = { sent: 0, drafted: 0, deduped: 0, failed: 0 };
  const ctx = await resolveTarget(opts.target);
  const recipients = ruleRecipients(ctx.siteRecord);
  if (!recipients.length) return { ...out, skipped: "no client phone or update email on the site or client" };
  const { body, subject } = await draftMessage(ctx, opts.type, opts.at ?? new Date());
  for (const r of recipients) {
    try {
      const { notification, deduped } = await createClientNotification({
        ctx, type: opts.type, channel: r.channel, recipient: r.address, message: body, subject: r.channel === "EMAIL" ? subject : null,
        actor: null, rule: `auto:${opts.type}`, dedupeKey: ruleKey(opts.rule, opts.ref, r.channel), eventRef: opts.eventRef, draft: opts.draft,
      });
      if (deduped) out.deduped++;
      else if (notification.status === "PENDING_APPROVAL") out.drafted++;
      else if (notification.status === "FAILED") out.failed++;
      else out.sent++;
    } catch (e) {
      out.failed++;
      console.error(`client notification rule ${opts.rule} for ${opts.ref}:`, (e as Error).message);
    }
  }
  return out;
}

const none = (skipped: string): RuleOutcome => ({ sent: 0, drafted: 0, deduped: 0, failed: 0, skipped });

async function siteFor(shiftId: string) {
  return db.shift.findUnique({ where: { id: shiftId }, select: { id: true, location: { select: { clientUpdates: true, notifyClientArrival: true, notifyClientWelfare: true, notifyClientCompletion: true, notifyClientLate: true, notifyClientAbsent: true, notifyClientOutside: true, notifyClientEmergency: true } } } });
}

/** The guard's phone confirmed them inside the site at shift start. */
export async function onCheckInVerified(checkInId: string): Promise<RuleOutcome> {
  try {
    const row = await db.attendanceCheckIn.findUnique({ where: { id: checkInId }, select: { shiftId: true, verifiedArrivalAt: true } });
    if (!row) return none("check-in not found");
    return await onGuardArrived(row.shiftId, "GUARD_VERIFIED", `checkin:${checkInId}`, row.verifiedArrivalAt ?? new Date());
  } catch (e) {
    console.error("client notification rule (verified):", (e as Error).message);
    return none((e as Error).message);
  }
}

/**
 * The guard is on site, by GPS or by SMS YES. Both share one dedupe key per shift, so the client
 * hears it once whichever comes first.
 */
export async function onGuardArrived(shiftId: string, type: "GUARD_VERIFIED" | "GUARD_ARRIVED", eventRef: string, at = new Date()): Promise<RuleOutcome> {
  try {
    const s = await siteFor(shiftId);
    if (!s) return none("shift not found");
    if (!s.location.clientUpdates) return none("site has not opted in");
    if (!s.location.notifyClientArrival) return none('site does not report "guard on site"');
    return await fire({ rule: "ARRIVAL", type, ref: shiftId, target: { shiftId }, eventRef, draft: false, at });
  } catch (e) {
    console.error("client notification rule (arrived):", (e as Error).message);
    return none((e as Error).message);
  }
}

/** The check-in escalated. `status` is what it escalated to. */
export async function onCheckInEscalated(checkInId: string, status: string): Promise<RuleOutcome> {
  try {
    const row = await db.attendanceCheckIn.findUnique({ where: { id: checkInId }, select: { shiftId: true } });
    if (!row) return none("check-in not found");
    if (status === "DEVICE_OFFLINE") return none("the phone is offline; that says nothing about whether the guard is there");
    if (status === "OUTSIDE_AREA") return await onGuardOutside(row.shiftId, `checkin:${checkInId}`);
    if (status === "MISSED") return await onArrivalNotConfirmed(row.shiftId, `checkin:${checkInId}`);
    return none(`no client rule for ${status}`);
  } catch (e) {
    console.error("client notification rule (escalated):", (e as Error).message);
    return none((e as Error).message);
  }
}

/**
 * No check-in after the grace period and escalation window: by GPS (phone online) or by SMS (no
 * reply to the arrival check or the reminder). One message per shift whichever path gets there.
 */
export async function onArrivalNotConfirmed(shiftId: string, eventRef: string): Promise<RuleOutcome> {
  try {
    const s = await siteFor(shiftId);
    if (!s) return none("shift not found");
    if (!s.location.clientUpdates) return none("site has not opted in");
    const type: ClientNotificationType | null = s.location.notifyClientAbsent ? "MISSED_CHECK_IN" : s.location.notifyClientLate ? "GUARD_LATE" : null;
    if (!type) return none("site does not report late or missed check-ins");
    return await fire({ rule: "LATE", type, ref: shiftId, target: { shiftId }, eventRef, draft: false });
  } catch (e) {
    console.error("client notification rule (late):", (e as Error).message);
    return none((e as Error).message);
  }
}

/** Outside the site: an internal alert has already gone out. The client message waits for the super admin. */
export async function onGuardOutside(shiftId: string, eventRef: string): Promise<RuleOutcome> {
  const s = await siteFor(shiftId);
  if (!s) return none("shift not found");
  if (!s.location.clientUpdates || !s.location.notifyClientOutside) return none("site does not report a guard away from the post");
  return fire({ rule: "OUTSIDE", type: "GUARD_OUTSIDE", ref: shiftId, target: { shiftId }, eventRef, draft: true });
}

/** An emergency incident: the control room is alerted first; the client message is a draft for the super admin. */
export async function onEmergencyReported(incidentId: string): Promise<RuleOutcome> {
  try {
    const i = await db.incident.findUnique({ where: { id: incidentId }, select: { id: true, category: true, location: { select: { clientUpdates: true, notifyClientEmergency: true } } } });
    if (!i) return none("incident not found");
    if (!i.location.clientUpdates || !i.location.notifyClientEmergency) return none("site does not report emergencies automatically");
    const type: ClientNotificationType = i.category === "ASSISTANCE_REQUEST" ? "ASSISTANCE" : "EMERGENCY";
    return await fire({ rule: "EMERGENCY", type, ref: incidentId, target: { incidentId }, eventRef: `incident:${incidentId}`, draft: true });
  } catch (e) {
    console.error("client notification rule (emergency):", (e as Error).message);
    return none((e as Error).message);
  }
}

/** The existing "all well" and "shift ended" updates, now with history and dedupe. */
export async function onShiftUpdate(shiftId: string, kind: "WELFARE_OK" | "SHIFT_ENDED", at: Date, ref: string): Promise<RuleOutcome> {
  const s = await siteFor(shiftId);
  if (!s) return none("shift not found");
  if (!s.location.clientUpdates) return none("site has not opted in");
  if (kind === "WELFARE_OK" && !s.location.notifyClientWelfare) return none('site does not report "all well"');
  if (kind === "SHIFT_ENDED" && !s.location.notifyClientCompletion) return none('site does not report "shift ended"');
  return fire({ rule: kind, type: kind === "WELFARE_OK" ? "WELFARE_OK" : "SHIFT_COMPLETED", ref, target: { shiftId }, eventRef: `shift:${shiftId}`, draft: false, at });
}
