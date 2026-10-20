/**
 * Messages to clients, end to end against a real database: the composer path, approvals, delivery
 * reports and the automatic rules.
 *
 * What it guards: a message only ever goes to an address on the site's or client's record; a
 * sensitive message is never sent without the super admin; "sent" is never shown as "delivered";
 * a repeated GPS fix, a retried event or a second tick never writes to the client twice.
 *
 *   npx tsx scripts/dev/client-notification-e2e.ts
 */
process.env.SMS_PROVIDER = "simulated";
import { config } from "dotenv"; config();
const dbUrl = process.env.DATABASE_URL ?? "";
if (!/localhost|127\.0\.0\.1/.test(dbUrl) && process.env.ALLOW_LIVE_DB !== "1") {
  console.error("Refusing to run against a non-local DATABASE_URL.");
  process.exit(2);
}
import { randomUUID } from "node:crypto";
import { addMinutes } from "date-fns";
import type { Role } from "@prisma/client";
import { db } from "../../src/lib/db";
import { SimulatedProvider } from "../../src/lib/sms/providers/simulated";
import { sendMode, containsCoordinates } from "../../src/lib/client-notifications/policy";
import {
  approvedRecipients, resolveTarget, composerContext, sendFromComposer, approveClientNotification, discardClientNotification,
  applyDeliveryToNotifications, notificationHistory, ClientNotificationError,
} from "../../src/lib/client-notifications/service";
import { onCheckInVerified, onCheckInEscalated, onArrivalNotConfirmed, onGuardOutside } from "../../src/lib/client-notifications/rules";
import { sendClientUpdate } from "../../src/lib/sms/client-updates";
import { createIncident } from "../../src/lib/services/incidents";
import { shiftInclude } from "../../src/lib/services/shifts";

let passed = 0, failed = 0;
const check = (name: string, ok: boolean, detail = "") => { if (ok) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name} ${detail}`); } };
const TAG = "CLIENTNOTE-E2E";
const SITE_PHONE = "+263778830001";
const CLIENT_PHONE = "+263778830002";
const OTHER_PHONE = "+263778830009";

async function clean() {
  const cIds = (await db.client.findMany({ where: { code: { startsWith: TAG } }, select: { id: true } })).map((c) => c.id);
  const gIds = (await db.guard.findMany({ where: { nationalId: { startsWith: TAG } }, select: { id: true } })).map((g) => g.id);
  const sIds = (await db.shift.findMany({ where: { guardId: { in: gIds } }, select: { id: true } })).map((x) => x.id);
  const nIds = (await db.clientNotification.findMany({ where: { clientId: { in: cIds } }, select: { id: true } })).map((n) => n.id);
  await db.clientNotification.deleteMany({ where: { clientId: { in: cIds } } });
  await db.smsMessage.deleteMany({ where: { OR: [{ clientId: { in: cIds } }, { toNumber: { in: [SITE_PHONE, CLIENT_PHONE, OTHER_PHONE] } }] } });
  await db.incident.deleteMany({ where: { guardId: { in: gIds } } });
  await db.shiftCheckIn.deleteMany({ where: { shiftId: { in: sIds } } });
  await db.attendanceCheckIn.deleteMany({ where: { shiftId: { in: sIds } } });
  await db.attendance.deleteMany({ where: { shiftId: { in: sIds } } });
  await db.notification.deleteMany({ where: { OR: [{ guardId: { in: gIds } }, { shiftId: { in: sIds } }] } });
  await db.auditLog.deleteMany({ where: { entityId: { in: [...nIds, ...gIds] } } });
  await db.shift.deleteMany({ where: { id: { in: sIds } } });
  await db.guard.deleteMany({ where: { id: { in: gIds } } });
  await db.location.deleteMany({ where: { code: { startsWith: TAG } } });
  await db.client.deleteMany({ where: { id: { in: cIds } } });
}

const err = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e) { return e as ClientNotificationError; } };

async function main() {
  await clean();
  const admin = await db.user.findFirstOrThrow({ where: { role: "SUPER_ADMIN" } });
  const ops = await db.user.findFirst({ where: { role: "ADMIN" } }) ?? admin;
  const sup = await db.user.findFirst({ where: { role: "SUPERVISOR" } }) ?? admin;
  const as = (u: { id: string; name: string }, role: Role) => ({ id: u.id, name: u.name, role });

  const client = await db.client.create({ data: { code: `${TAG}-C`, name: "Notify Client Ltd", contactName: "Rudo", contactPhone: CLIENT_PHONE, contactEmail: "ops@notify-client.test" } });
  const otherClient = await db.client.create({ data: { code: `${TAG}-O`, name: "Unrelated Client", contactPhone: OTHER_PHONE } });
  const site = await db.location.create({ data: {
    code: `${TAG}-S`, name: "Notify Depot", clientId: client.id, address: "x", supervisorId: admin.id, latitude: -17.829211, longitude: 31.052234,
    clientUpdates: true, clientUpdatePhone: SITE_PHONE, clientUpdateEmail: "updates@notify-client.test",
    notifyClientArrival: true, notifyClientLate: true, notifyClientAbsent: false, notifyClientOutside: true, notifyClientEmergency: true,
  } });
  const otherSite = await db.location.create({ data: { code: `${TAG}-X`, name: "Unrelated Site", clientId: otherClient.id, address: "y", clientUpdates: true, clientUpdatePhone: OTHER_PHONE } });
  const offSite = await db.location.create({ data: { code: `${TAG}-F`, name: "Quiet Site", clientId: client.id, address: "z", clientUpdates: false, clientUpdatePhone: SITE_PHONE } });
  const mk = async (n: number, locationId: string, startOffset = -20) => {
    const g = await db.guard.create({ data: { guardNo: `${TAG}-${n}`, firstName: "Chipo", lastName: `Test${n}`, phone: `+26377883010${n}`, nationalId: `${TAG}-${n}`, dateEmployed: new Date(), homeLocationId: locationId } });
    const now = new Date();
    const s = await db.shift.create({ data: { guardId: g.id, locationId, supervisorId: admin.id, startAt: addMinutes(now, startOffset), endAt: addMinutes(now, 600), durationMinutes: 600, status: "ON_DUTY", attendance: { create: {} } } });
    return { g, s };
  };
  const { g: guard, s: shift } = await mk(1, site.id);
  await mk(2, otherSite.id);

  console.log("policy");
  check("an operations admin sends routine updates", sendMode("ADMIN", "GUARD_LATE") === "SEND");
  check("an operations admin only drafts an emergency", sendMode("ADMIN", "EMERGENCY") === "DRAFT");
  check("the super admin sends an emergency", sendMode("SUPER_ADMIN", "EMERGENCY") === "SEND");
  check("a supervisor only drafts", sendMode("SUPERVISOR", "GUARD_VERIFIED") === "DRAFT" && sendMode("SUPERVISOR", "SITE_STATUS") === "DRAFT");
  check("coordinates are recognised", containsCoordinates("seen at -17.829211, 31.052234") && containsCoordinates("lat: -17.8292"));
  check("times and phone numbers are not coordinates", !containsCoordinates("Shift 18:00-06:00, call +263771234567") && !containsCoordinates("Gate 3.5 metres"));

  console.log("finding the client");
  const ctx = await resolveTarget({ guardId: guard.id });
  check("a guard's current shift names the site and its client", ctx.site.id === site.id && ctx.client.id === client.id && ctx.shift?.id === shift.id);
  const recips = approvedRecipients(ctx.siteRecord);
  check("recipients are the site and client record only", recips.some((r) => r.address === SITE_PHONE) && recips.some((r) => r.address === CLIENT_PHONE) && recips.some((r) => r.channel === "EMAIL") && !recips.some((r) => r.address === OTHER_PHONE));
  check("a shift and a different site do not mix", (await err(() => resolveTarget({ shiftId: shift.id, locationId: otherSite.id })))?.message.includes("different site") === true);
  const composer = await composerContext({ shiftId: shift.id }, "ADMIN");
  const late = composer.types.find((t) => t.type === "GUARD_LATE")!;
  check("drafts name the site and carry no coordinates", late.body.includes("Notify Depot") && composer.types.every((t) => !containsCoordinates(t.body)) && !composer.types.some((t) => t.body.includes("31.05")));
  check("the composer marks sensitive types for approval for an operations admin", composer.types.find((t) => t.type === "EMERGENCY")!.mode === "DRAFT" && late.mode === "SEND");

  console.log("sending from the composer");
  const key = randomUUID();
  const send = (over: Partial<Parameters<typeof sendFromComposer>[0]> = {}) => sendFromComposer({ target: { shiftId: shift.id }, type: "GUARD_LATE", channel: "SMS", recipient: SITE_PHONE, message: late.body, idempotencyKey: key, actor: as(ops, "ADMIN"), ...over });
  const first = await send();
  check("an operations admin's update is sent, not delivered", first.notification.status === "SENT" && !first.deduped, first.notification.status);
  const sms = first.notification.smsMessageId ? await db.smsMessage.findUnique({ where: { id: first.notification.smsMessageId } }) : null;
  check("it is in the SMS log against the client and site", sms?.clientId === client.id && sms.locationId === site.id && sms.type === "CLIENT_UPDATE");
  check("with who sent it", first.notification.sentById === ops.id && first.notification.rule === null);
  check("and on the shift timeline", (await db.shiftCheckIn.count({ where: { shiftId: shift.id, type: "CLIENT_NOTIFIED" } })) === 1);
  check("and audited", (await db.auditLog.count({ where: { entityId: first.notification.id, action: "CLIENT_NOTIFICATION_SENT" } })) === 1);
  const dup = await send();
  check("a double click sends once", dup.deduped && dup.notification.id === first.notification.id && (await db.smsMessage.count({ where: { toNumber: SITE_PHONE } })) === 1);
  check("an address not on the record is refused", (await err(() => send({ recipient: OTHER_PHONE, idempotencyKey: randomUUID() })))?.message.includes("not on this site") === true);
  check("a number typed by hand is refused", (await err(() => send({ recipient: "+263771111111", idempotencyKey: randomUUID() })))?.status === 400);
  check("coordinates are refused for an operations admin", (await err(() => send({ message: "Guard seen at -17.829211, 31.052234 outside.", idempotencyKey: randomUUID() })))?.message.includes("coordinates") === true);

  const supDraft = await send({ type: "GUARD_VERIFIED", actor: as(sup, "SUPERVISOR"), idempotencyKey: randomUUID(), message: composer.types.find((t) => t.type === "GUARD_VERIFIED")!.body });
  check("a supervisor's message is a draft, nothing sent", supDraft.notification.status === "PENDING_APPROVAL" && supDraft.notification.smsMessageId === null);
  check("someone is told it awaits approval", (await db.notification.count({ where: { type: "CLIENT_NOTIFICATION_APPROVAL", shiftId: shift.id } })) >= 1);
  const disc = await discardClientNotification(supDraft.notification.id, as(ops, "ADMIN"));
  check("an operations admin can discard a routine draft", disc.status === "DISCARDED");
  check("a discarded draft cannot be approved", (await err(() => approveClientNotification(supDraft.notification.id, as(admin, "SUPER_ADMIN"))))?.status === 409);

  const emer = await send({ type: "EMERGENCY", idempotencyKey: randomUUID(), message: "URGENT: an emergency has been reported at Notify Depot. Our team is responding." });
  check("an operations admin's emergency message is a draft", emer.notification.status === "PENDING_APPROVAL");
  check("an operations admin cannot approve it", (await err(() => approveClientNotification(emer.notification.id, as(ops, "ADMIN"))))?.status === 403);
  const approved = await approveClientNotification(emer.notification.id, as(admin, "SUPER_ADMIN"), { message: "URGENT from Omega: an emergency was reported at Notify Depot. Supervisor on the way." });
  check("the super admin approves it with an edit, and it is sent", approved.status === "SENT" && approved.message.includes("Supervisor on the way") && approved.approvedById === admin.id);
  check("approving twice does nothing", (await err(() => approveClientNotification(emer.notification.id, as(admin, "SUPER_ADMIN"))))?.status === 409);

  const email = await send({ type: "SITE_STATUS", channel: "EMAIL", recipient: "updates@notify-client.test", idempotencyKey: randomUUID(), message: "Omega update for Notify Depot: the site is secure.", subject: "Site status" });
  const emailMsg = await db.smsMessage.findUnique({ where: { id: email.notification.smsMessageId! } });
  check("email goes out with its subject and is logged as email", email.notification.status === "SENT" && emailMsg?.channel === "EMAIL" && emailMsg.subject === "Site status");

  console.log("delivery reports");
  check("a delivery report marks it delivered", (await applyDeliveryToNotifications([first.notification.smsMessageId!], "DELIVERED")) === 1 && (await db.clientNotification.findUnique({ where: { id: first.notification.id } }))?.status === "DELIVERED");
  await applyDeliveryToNotifications([approved.smsMessageId!], "FAILED", "Handset unreachable");
  const undelivered = await db.clientNotification.findUnique({ where: { id: approved.id } });
  check("an undelivered report marks it failed, with the reason", undelivered?.status === "FAILED" && undelivered.failureReason === "Handset unreachable");
  const realSend = SimulatedProvider.prototype.sendSMS;
  SimulatedProvider.prototype.sendSMS = async () => ({ ok: false, error: "402 insufficient funds" });
  const refused = await send({ type: "SITE_STATUS", idempotencyKey: randomUUID(), message: "Omega update for Notify Depot: all is in order." });
  SimulatedProvider.prototype.sendSMS = realSend;
  check("a provider refusal is stored as failed, never as sent", refused.notification.status === "FAILED" && refused.notification.failureReason === "402 insufficient funds" && refused.notification.sentAt === null);

  console.log("rules");
  const before = await db.clientNotification.count({ where: { shiftId: shift.id, rule: { not: null } } });
  const ci = await db.attendanceCheckIn.create({ data: { shiftId: shift.id, guardId: guard.id, scheduledStartAt: shift.startAt, status: "VERIFIED_ON_TIME", verifiedArrivalAt: new Date(), source: "AUTO_GPS" } });
  const v1 = await onCheckInVerified(ci.id);
  check("a GPS-verified check-in tells the client by SMS and email", v1.sent === 2, JSON.stringify(v1));
  const v2 = await onCheckInVerified(ci.id);
  check("a repeated GPS fix does not tell them again", v2.deduped === 2 && v2.sent === 0, JSON.stringify(v2));
  const full = await db.shift.findUniqueOrThrow({ where: { id: shift.id }, include: shiftInclude });
  const yes = await sendClientUpdate(full, "ARRIVAL");
  check("an SMS YES after the GPS check-in does not tell them again", !yes.sent && (await db.clientNotification.count({ where: { shiftId: shift.id, rule: { not: null } } })) === before + 2, JSON.stringify(yes));
  const arrival = await db.clientNotification.findFirst({ where: { shiftId: shift.id, type: "GUARD_VERIFIED", channel: "SMS", rule: { not: null } } });
  check("the rule message goes to the site's client-update number, with no sender", arrival?.recipient === SITE_PHONE && arrival.sentById === null && arrival.rule === "auto:GUARD_VERIFIED");

  const { g: g3, s: s3 } = await mk(3, site.id, -40);
  const ci3 = await db.attendanceCheckIn.create({ data: { shiftId: s3.id, guardId: g3.id, scheduledStartAt: s3.startAt, status: "DEVICE_OFFLINE" } });
  const off = await onCheckInEscalated(ci3.id, "DEVICE_OFFLINE");
  check("an offline phone tells the client nothing", off.sent === 0 && off.drafted === 0 && (await db.clientNotification.count({ where: { shiftId: s3.id } })) === 0);
  const missed = await onCheckInEscalated(ci3.id, "MISSED");
  const lateRow = await db.clientNotification.findFirst({ where: { shiftId: s3.id, channel: "SMS" } });
  check("a missed check-in tells the client the guard is late, per the site's choice", missed.sent === 2 && lateRow?.type === "GUARD_LATE", JSON.stringify(missed));
  const smsPath = await onArrivalNotConfirmed(s3.id, `shift:${s3.id}:arrival-escalated`);
  check("the SMS escalation for the same shift does not tell them again", smsPath.deduped === 2 && smsPath.sent === 0);
  await db.location.update({ where: { id: site.id }, data: { notifyClientAbsent: true } });
  const { s: s4 } = await mk(4, site.id, -40);
  await onArrivalNotConfirmed(s4.id, `shift:${s4.id}:arrival-escalated`);
  check("with missed check-ins switched on, the message says so", (await db.clientNotification.findFirst({ where: { shiftId: s4.id, channel: "SMS" } }))?.type === "MISSED_CHECK_IN");

  const out = await onGuardOutside(s3.id, "location:test");
  const outRows = await db.clientNotification.findMany({ where: { shiftId: s3.id, type: "GUARD_OUTSIDE" } });
  check("a guard away from the post is only drafted for approval", out.drafted === 2 && outRows.every((r) => r.status === "PENDING_APPROVAL" && r.smsMessageId === null));
  check("and drafted once", (await onGuardOutside(s3.id, "location:again")).deduped === 2);

  const inc = await createIncident({ guardId: guard.id, locationId: site.id, shiftId: shift.id, category: "EMERGENCY", severity: "CRITICAL", description: "Test emergency", source: "EMERGENCY", actorName: "test" });
  const incRows = await db.clientNotification.findMany({ where: { incidentId: inc.id } });
  check("an emergency is drafted for the super admin, never sent by the rule", incRows.length === 2 && incRows.every((r) => r.status === "PENDING_APPROVAL" && r.type === "EMERGENCY"));
  await db.location.update({ where: { id: site.id }, data: { notifyClientEmergency: false } });
  const inc2 = await createIncident({ guardId: guard.id, locationId: site.id, shiftId: shift.id, category: "EMERGENCY", severity: "CRITICAL", description: "Second", source: "EMERGENCY", actorName: "test" });
  check("a site that does not ask for it gets no emergency draft", (await db.clientNotification.count({ where: { incidentId: inc2.id } })) === 0);

  const { g: g5, s: s5 } = await mk(5, offSite.id);
  const ci5 = await db.attendanceCheckIn.create({ data: { shiftId: s5.id, guardId: g5.id, scheduledStartAt: s5.startAt, status: "VERIFIED_ON_TIME", verifiedArrivalAt: new Date() } });
  const quiet = await onCheckInVerified(ci5.id);
  check("a site with client updates off sends nothing", quiet.sent === 0 && /opted in/.test(quiet.skipped ?? ""));

  const at = new Date();
  await db.location.update({ where: { id: site.id }, data: { notifyClientWelfare: true, notifyClientCompletion: true } });
  const w1 = await sendClientUpdate(full, "WELFARE_OK", at);
  const w2 = await sendClientUpdate(full, "WELFARE_OK", at);
  check("an 'all well' retried within the minute is sent once", w1.sent && !w2.sent);
  const e1 = await sendClientUpdate(full, "SHIFT_ENDED", at);
  const e2 = await sendClientUpdate(full, "SHIFT_ENDED", addMinutes(at, 5));
  check("'shift ended' is sent once per shift", e1.sent && !e2.sent);

  console.log("history");
  const hist = await notificationHistory({ clientId: client.id }, 200);
  check("the client's history holds its messages and no one else's", hist.length > 10 && hist.every((h) => h.client.id === client.id));
  const h = hist.find((x) => x.id === first.notification.id)!;
  check("each entry says who, what, where, to whom and what happened", h.sentBy === ops.name && h.site?.id === site.id && h.guard?.id === guard.id && h.shiftId === shift.id && h.recipient === SITE_PHONE && h.statusLabel === "Delivered" && h.eventRef === `shift:${shift.id}`);
  check("an automatic entry names its rule and no sender", hist.some((x) => x.rule === "auto:GUARD_VERIFIED" && x.sentBy === null));
  check("the unrelated client's history is empty", (await notificationHistory({ clientId: otherClient.id })).length === 0);

  await clean();
  console.log(`\n${passed} passed, ${failed} failed`);
  await db.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await clean().catch(() => undefined); await db.$disconnect(); process.exit(1); });
