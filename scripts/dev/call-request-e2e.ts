/**
 * Calling a guard from the portal through an operations gateway phone, end to end against a real
 * database. Call records travel through processGatewayEvents, exactly as the phone uploads them.
 *
 * What it guards: a request only reaches the phone it names; nothing is ever reported as dialled,
 * connected or completed unless the phone said so or its own call record shows it.
 *
 *   npx tsx scripts/dev/call-request-e2e.ts
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
import { db } from "../../src/lib/db";
import { createGateway, activateGateway } from "../../src/lib/gateway/service";
import { processGatewayEvents } from "../../src/lib/gateway/events";
import { commandsForDevice } from "../../src/lib/gateway/location-requests";
import { acknowledgeCallRequest, cancelCallRequest, createCallRequest, describeCallRequest, expireCallRequests, gatewayOptionsForGuard, CallRequestError } from "../../src/lib/gateway/call-requests";

let passed = 0, failed = 0;
const check = (name: string, ok: boolean, detail = "") => { if (ok) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name} ${detail}`); } };
const TAG = "CALLREQ-E2E";
const GUARD_PHONE = "+263778821001";

async function clean() {
  const guards = await db.guard.findMany({ where: { nationalId: { startsWith: TAG } }, select: { id: true } });
  const gIds = guards.map((g) => g.id);
  const dIds = (await db.gatewayDevice.findMany({ where: { deviceName: { startsWith: TAG } }, select: { id: true } })).map((d) => d.id);
  await db.callRequest.deleteMany({ where: { OR: [{ guardId: { in: gIds } }, { gatewayDeviceId: { in: dIds } }] } });
  const sIds = (await db.shift.findMany({ where: { guardId: { in: gIds } }, select: { id: true } })).map((x) => x.id);
  await db.shiftCheckIn.deleteMany({ where: { shiftId: { in: sIds } } });
  await db.attendanceCheckIn.deleteMany({ where: { shiftId: { in: sIds } } });
  await db.attendance.deleteMany({ where: { shiftId: { in: sIds } } });
  await db.notification.deleteMany({ where: { guardId: { in: gIds } } });
  await db.gatewayEvent.deleteMany({ where: { gatewayDeviceId: { in: dIds } } });
  await db.callLog.deleteMany({ where: { gatewayDeviceId: { in: dIds } } });
  await db.auditLog.deleteMany({ where: { entityId: { in: [...gIds, ...dIds] } } });
  await db.location.updateMany({ where: { code: { startsWith: TAG } }, data: { defaultGatewayId: null } });
  await db.gatewayDevice.deleteMany({ where: { id: { in: dIds } } });
  await db.shift.deleteMany({ where: { id: { in: sIds } } });
  await db.guard.deleteMany({ where: { id: { in: gIds } } });
  await db.location.deleteMany({ where: { code: { startsWith: TAG } } });
  await db.client.deleteMany({ where: { code: { startsWith: TAG } } });
}

async function gateway(name: string, opts: { appVersion?: string; locationId?: string; offline?: boolean; mode?: "OPERATIONS_GATEWAY" | "GUARD"; guardId?: string } = {}) {
  const admin = await db.user.findFirstOrThrow({ where: { role: "SUPER_ADMIN" } });
  const g = await createGateway({ deviceName: `${TAG} ${name}`, phoneNumber: `+26377882${String(Math.floor(Math.random() * 9000) + 1000)}`, mode: opts.mode ?? "OPERATIONS_GATEWAY", guardId: opts.guardId, locationId: opts.locationId, actor: { userId: admin.id, name: admin.name } });
  await activateGateway(g.activationCode!, { appVersion: opts.appVersion ?? "1.8.0", androidVersion: "14", deviceModel: "Test", batteryLevel: 90, networkType: "wifi" }, "41.0.0.11");
  return db.gatewayDevice.update({ where: { id: g.id }, data: { lastSeenAt: opts.offline ? addMinutes(new Date(), -60) : new Date(), status: opts.offline ? "OFFLINE" : "ONLINE", placeCallPermission: "granted" } });
}

/** The phone's own record of a call, uploaded the way the gateway uploads it. */
async function callEvents(deviceId: string, number: string, steps: ("start" | "answer" | "end-answered" | "end-unanswered")[], at = new Date()) {
  const device = await db.gatewayDevice.findUniqueOrThrow({ where: { id: deviceId } });
  const callId = `${TAG}-${randomUUID()}`;
  const evs = steps.map((s, i) => {
    const t = new Date(at.getTime() + i * 15_000).toISOString();
    if (s === "start") return { eventId: `${callId}-s`, eventType: "CALL_STARTED", callId, phoneNumber: number, direction: "OUTGOING", timestamp: t };
    if (s === "answer") return { eventId: `${callId}-a`, eventType: "CALL_ANSWERED", callId, timestamp: t };
    if (s === "end-answered") return { eventId: `${callId}-e`, eventType: "CALL_ENDED", callId, timestamp: t, durationSeconds: 45, answered: true };
    return { eventId: `${callId}-e`, eventType: "CALL_ENDED", callId, timestamp: t, durationSeconds: 0, answered: false };
  });
  for (const ev of evs) await processGatewayEvents(device, [ev], { clockOffsetMs: 0 });
}

const view = async (id: string) => (await describeCallRequest(id))!;
const fails = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e) { return e as CallRequestError; } };

async function main() {
  await clean();
  const admin = await db.user.findFirstOrThrow({ where: { role: "SUPER_ADMIN" } });
  const actor = { userId: admin.id, name: admin.name };
  const client = await db.client.create({ data: { code: `${TAG}-C`, name: "Call Client" } });
  const site = await db.location.create({ data: { code: `${TAG}-S`, name: "Call site", clientId: client.id, address: "x", supervisorId: admin.id } });
  const guard = await db.guard.create({ data: { guardNo: `${TAG}-1`, firstName: "Tapiwa", lastName: "Moyo", phone: GUARD_PHONE, nationalId: `${TAG}-1`, dateEmployed: new Date(), homeLocationId: site.id } });
  const now = new Date();
  await db.shift.create({ data: { guardId: guard.id, locationId: site.id, supervisorId: admin.id, startAt: addMinutes(now, -30), endAt: addMinutes(now, 600), durationMinutes: 630, status: "ON_DUTY", attendance: { create: {} } } });

  const other = await gateway("Other office");
  const atSite = await gateway("Site phone", { locationId: site.id });
  const old = await gateway("Old app", { appVersion: "1.7.0" });
  const off = await gateway("Offline", { offline: true });
  await db.location.update({ where: { id: site.id }, data: { defaultGatewayId: atSite.id } });

  console.log("choosing the phone");
  const { options } = await gatewayOptionsForGuard(guard.id);
  const mine = options.filter((o) => o.deviceName.startsWith(TAG));
  check("the site's default phone comes first", mine[0]?.id === atSite.id && mine[0].isDefault, mine.map((o) => o.deviceName).join(", "));
  check("a phone on an app too old to place calls is offered but not eligible", mine.some((o) => o.id === old.id && !o.eligible && /1\.8\.0/.test(o.reason ?? "")));
  check("an offline phone is not eligible", mine.some((o) => o.id === off.id && !o.eligible && o.reason === "offline"));

  console.log("one request, one phone");
  const k1 = randomUUID();
  const { request: r1 } = await createCallRequest({ guardId: guard.id, idempotencyKey: k1, reason: "Missed check-in", actor });
  check("the request goes to the site's default phone", r1.gatewayDeviceId === atSite.id && r1.status === "QUEUED", r1.status);
  check("with the guard's number normalised", r1.phoneNumber === GUARD_PHONE);
  const again = await createCallRequest({ guardId: guard.id, idempotencyKey: k1, actor });
  check("a double click is the same request", again.reused && again.request.id === r1.id);
  const other2 = await createCallRequest({ guardId: guard.id, idempotencyKey: randomUUID(), actor });
  check("a second request while one is in progress returns that one", other2.reused && other2.request.id === r1.id);
  check("it is audited", (await db.auditLog.count({ where: { action: "CALL_REQUESTED", entityId: guard.id } })) === 1);

  const cmdsOther = await commandsForDevice(other);
  check("another gateway phone never sees it", !cmdsOther.some((c) => c.id === r1.id));
  const cmds = await commandsForDevice(atSite);
  const cmd = cmds.find((c) => c.id === r1.id) as { type: string; phoneNumber: string; guardName: string; reason: string } | undefined;
  check("the designated phone receives a PLACE_CALL command", cmd?.type === "PLACE_CALL" && cmd.phoneNumber === GUARD_PHONE && cmd.guardName === "Tapiwa Moyo" && cmd.reason === "Missed check-in");
  check("fetching it marks it delivered, and nothing more", (await view(r1.id)).status === "DELIVERED");

  console.log("what the phone may report");
  check("another phone cannot report on it", (await fails(() => acknowledgeCallRequest(other, r1.id, "DIALING", null)))?.status === 404);
  check("a phone cannot claim the call connected", (await fails(() => acknowledgeCallRequest(atSite, r1.id, "CONNECTED", null)))?.status === 400);
  await acknowledgeCallRequest(atSite, r1.id, "AWAITING_CONFIRMATION", null);
  check("shown to the operator", (await view(r1.id)).status === "AWAITING_CONFIRMATION");
  await acknowledgeCallRequest(atSite, r1.id, "DIALING", null);
  const v1 = await view(r1.id);
  check("the operator tapped Call: dialling, not yet connected", v1.status === "DIALING" && v1.dialedAt !== null && v1.connectedAt === null);
  check("a dialling call cannot be cancelled from the portal", (await cancelCallRequest(r1.id, actor)).status === "DIALING");

  console.log("the phone's call record settles it");
  await callEvents(atSite.id, "+263771111111", ["start", "answer", "end-answered"]);
  check("a call to a different number is not this call", (await view(r1.id)).callLogId === null);
  await callEvents(atSite.id, GUARD_PHONE, ["start"]);
  check("the outgoing call is linked", (await view(r1.id)).callLogId !== null);
  const call = (await db.callRequest.findUniqueOrThrow({ where: { id: r1.id } })).callLogId!;
  const log = await db.callLog.findUniqueOrThrow({ where: { id: call } });
  await processGatewayEvents(atSite, [{ eventId: `${log.callId}-a`, eventType: "CALL_ANSWERED", callId: log.callId, timestamp: new Date(Date.now() + 10_000).toISOString() }], { clockOffsetMs: 0 });
  check("answered: connected", (await view(r1.id)).status === "CONNECTED");
  await processGatewayEvents(atSite, [{ eventId: `${log.callId}-e`, eventType: "CALL_ENDED", callId: log.callId, timestamp: new Date(Date.now() + 55_000).toISOString(), durationSeconds: 45, answered: true }], { clockOffsetMs: 0 });
  const done = await view(r1.id);
  check("ended: completed, with the duration from the record", done.status === "COMPLETED" && done.durationSeconds === 45 && !done.open, `${done.status} ${done.durationSeconds}`);

  console.log("not answered, and the dialler path");
  const { request: r2 } = await createCallRequest({ guardId: guard.id, idempotencyKey: randomUUID(), actor });
  await commandsForDevice(atSite);
  await acknowledgeCallRequest(atSite, r2.id, "DIALING", null);
  await callEvents(atSite.id, GUARD_PHONE, ["start", "end-unanswered"]);
  check("dialled and ended unanswered: not answered", (await view(r2.id)).status === "NO_ANSWER");

  const { request: r3 } = await createCallRequest({ guardId: guard.id, idempotencyKey: randomUUID(), actor });
  await commandsForDevice(atSite);
  await acknowledgeCallRequest(atSite, r3.id, "AWAITING_CONFIRMATION", null);
  // No DIALING: without the call permission the app opened the system dialler and cannot see more.
  await callEvents(atSite.id, GUARD_PHONE, ["start", "answer", "end-answered"]);
  check("dialled from the system dialler: the call record alone completes it", (await view(r3.id)).status === "COMPLETED");

  console.log("withdrawn, lapsed, failed");
  const { request: r4 } = await createCallRequest({ guardId: guard.id, idempotencyKey: randomUUID(), actor });
  await cancelCallRequest(r4.id, actor);
  check("cancelled before anything rang", (await view(r4.id)).status === "CANCELLED");

  const { request: r5 } = await createCallRequest({ guardId: guard.id, idempotencyKey: randomUUID(), actor });
  await db.callRequest.update({ where: { id: r5.id }, data: { expiresAt: addMinutes(new Date(), -1) } });
  await expireCallRequests();
  const v5 = await view(r5.id);
  check("nobody acted on it: timed out, and it says no call was made", v5.status === "TIMED_OUT" && /No call was made/.test(v5.detail), v5.detail);

  await db.callRequest.deleteMany({ where: { guardId: guard.id, id: { notIn: [r1.id] } } });
  const { request: r6 } = await createCallRequest({ guardId: guard.id, idempotencyKey: randomUUID(), actor });
  await acknowledgeCallRequest(atSite, r6.id, "DIALING", null);
  await db.callRequest.update({ where: { id: r6.id }, data: { dialedAt: addMinutes(new Date(), -11) } });
  await expireCallRequests();
  const v6 = await view(r6.id);
  check("'dialling' with no call record after ten minutes is reported as failed", v6.status === "FAILED" && /no call record/.test(v6.detail), v6.detail);

  const { request: r7 } = await createCallRequest({ guardId: guard.id, idempotencyKey: randomUUID(), actor });
  await acknowledgeCallRequest(atSite, r7.id, "FAILED", "No SIM card");
  const v7 = await view(r7.id);
  check("the phone reports it could not dial", v7.status === "FAILED" && v7.detail === "No SIM card");
  check("and whoever asked is told", (await db.notification.count({ where: { type: "CALL_REQUEST_FAILED", guardId: guard.id } })) === 1);

  console.log("limits");
  for (let i = 0; i < 6; i++) {
    const open = await db.callRequest.findMany({ where: { guardId: guard.id, status: { in: ["QUEUED", "DELIVERED", "AWAITING_CONFIRMATION", "DIALING", "CONNECTED"] } } });
    for (const o of open) await cancelCallRequest(o.id, actor);
    const e = await fails(() => createCallRequest({ guardId: guard.id, idempotencyKey: randomUUID(), actor: { userId: null, name: "test" } }));
    if (e) { check("a guard cannot be called more than five times in ten minutes", e.status === 429, e.message); break; }
  }
  const badGuard = await db.guard.create({ data: { guardNo: `${TAG}-2`, firstName: "Bad", lastName: "Number", phone: "12", nationalId: `${TAG}-2`, dateEmployed: new Date(), homeLocationId: site.id } });
  const bad = await fails(() => createCallRequest({ guardId: badGuard.id, idempotencyKey: randomUUID(), actor }));
  check("a number that cannot be dialled is refused before anything is sent", bad?.status === 422, bad?.message ?? "");

  // Every operations phone offline for this one check, including ones this test did not create;
  // they are put back exactly as they were straight after.
  const bystanders = await db.gatewayDevice.findMany({ where: { mode: "OPERATIONS_GATEWAY", NOT: { deviceName: { startsWith: TAG } } }, select: { id: true, status: true, lastSeenAt: true } });
  await db.gatewayDevice.updateMany({ where: { mode: "OPERATIONS_GATEWAY" }, data: { status: "OFFLINE", lastSeenAt: addMinutes(new Date(), -60) } });
  const g3 = await db.guard.create({ data: { guardNo: `${TAG}-3`, firstName: "No", lastName: "Gateway", phone: "+263778821003", nationalId: `${TAG}-3`, dateEmployed: new Date(), homeLocationId: site.id } });
  const none = await fails(() => createCallRequest({ guardId: g3.id, idempotencyKey: randomUUID(), actor }));
  check("with no phone able to call, the error says which phones and why", none?.status === 409 && /offline/.test(none.message), none?.message.slice(0, 90) ?? "");
  for (const b of bystanders) await db.gatewayDevice.update({ where: { id: b.id }, data: { status: b.status, lastSeenAt: b.lastSeenAt } });

  const guardPhone = await gateway("Guard handset", { mode: "GUARD", guardId: guard.id });
  const gcmds = await commandsForDevice(guardPhone);
  check("a guard-mode phone never receives call requests", !gcmds.some((c) => (c as { type: string }).type === "PLACE_CALL"));

  await clean();
  console.log(`\n${passed} passed, ${failed} failed`);
  await db.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await clean().catch(() => undefined); await db.$disconnect(); process.exit(1); });
