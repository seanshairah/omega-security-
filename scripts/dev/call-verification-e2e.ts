/**
 * Clock-in by call, both directions, for both kinds of guard, through processGatewayEvents exactly as
 * the operations phone uploads calls:
 *
 *   basic phone   guard rings the operations phone → call attendance (existing)
 *                 operator rings the guard, answered → call attendance, flagged OPERATOR_CALLED
 *   guard app     either direction → the guard's own phone is asked for a GPS fix; the fix decides,
 *                 and the call is held (not lost) until it does
 *
 * Also: the engine runs from portal traffic, and "Calls or SMS" is accepted on the guard form.
 *
 *   npx tsx scripts/dev/call-verification-e2e.ts
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
import { applyFix } from "../../src/lib/attendance/check-in-service";
import { saveSettings } from "../../src/lib/settings";
import { maybeTickFromPortal } from "../../src/lib/automation/scheduler";
import { guardSchema } from "../../src/lib/validation";

let passed = 0, failed = 0;
const check = (name: string, ok: boolean, detail = "") => { if (ok) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name} ${detail}`); } };
const TAG = "CALLVERIFY-E2E";
const SITE = { latitude: -17.8292, longitude: 31.0522 };
const KEYS = ["callAttendance.outgoingMode"];

async function clean() {
  const gIds = (await db.guard.findMany({ where: { nationalId: { startsWith: TAG } }, select: { id: true } })).map((g) => g.id);
  const dIds = (await db.gatewayDevice.findMany({ where: { deviceName: { startsWith: TAG } }, select: { id: true } })).map((d) => d.id);
  const sIds = (await db.shift.findMany({ where: { guardId: { in: gIds } }, select: { id: true } })).map((x) => x.id);
  await db.attendanceEvidence.deleteMany({ where: { guardId: { in: gIds } } });
  await db.clientNotification.deleteMany({ where: { guardId: { in: gIds } } });
  await db.attendanceCheckIn.deleteMany({ where: { OR: [{ shiftId: { in: sIds } }, { guardId: { in: gIds } }] } });
  await db.deviceLocationRequest.deleteMany({ where: { OR: [{ gatewayDeviceId: { in: dIds } }, { guardId: { in: gIds } }] } });
  await db.locationEvent.deleteMany({ where: { OR: [{ shiftId: { in: sIds } }, { gatewayDeviceId: { in: dIds } }] } });
  await db.networkLocationCheck.deleteMany({ where: { guardId: { in: gIds } } });
  await db.welfareCheck.deleteMany({ where: { shiftId: { in: sIds } } });
  await db.shiftCheckIn.deleteMany({ where: { shiftId: { in: sIds } } });
  await db.attendance.deleteMany({ where: { shiftId: { in: sIds } } });
  await db.notification.deleteMany({ where: { OR: [{ guardId: { in: gIds } }, { shiftId: { in: sIds } }] } });
  await db.smsMessage.deleteMany({ where: { guardId: { in: gIds } } });
  await db.callRequest.deleteMany({ where: { guardId: { in: gIds } } });
  await db.gatewayEvent.deleteMany({ where: { gatewayDeviceId: { in: dIds } } });
  await db.callLog.deleteMany({ where: { OR: [{ gatewayDeviceId: { in: dIds } }, { guardId: { in: gIds } }] } });
  await db.auditLog.deleteMany({ where: { entityId: { in: [...gIds, ...dIds] } } });
  await db.shift.deleteMany({ where: { id: { in: sIds } } });
  await db.location.updateMany({ where: { code: { startsWith: TAG } }, data: { defaultGatewayId: null } });
  await db.guard.updateMany({ where: { id: { in: gIds } }, data: { assignedGatewayId: null } });
  await db.gatewayDevice.updateMany({ where: { id: { in: dIds } }, data: { guardId: null } });
  await db.gatewayDevice.deleteMany({ where: { id: { in: dIds } } });
  await db.guard.deleteMany({ where: { id: { in: gIds } } });
  await db.location.deleteMany({ where: { code: { startsWith: TAG } } });
  await db.client.deleteMany({ where: { code: { startsWith: TAG } } });
}

/** One call, uploaded as a phone uploads it. */
async function call(deviceId: string, number: string, at: Date, opts: { direction?: "INCOMING" | "OUTGOING"; answered?: boolean; seconds?: number } = {}) {
  const device = await db.gatewayDevice.findUniqueOrThrow({ where: { id: deviceId } });
  const callId = `${TAG}-${randomUUID()}`;
  const answered = opts.answered ?? true;
  const t = (ms: number) => new Date(at.getTime() + ms).toISOString();
  const evs: Record<string, unknown>[] = [{ eventId: `${callId}-s`, eventType: "CALL_STARTED", callId, phoneNumber: number, direction: opts.direction ?? "INCOMING", timestamp: t(0) }];
  if (answered) evs.push({ eventId: `${callId}-a`, eventType: "CALL_ANSWERED", callId, timestamp: t(5_000) });
  evs.push({ eventId: `${callId}-e`, eventType: "CALL_ENDED", callId, timestamp: t(answered ? 50_000 : 25_000), durationSeconds: answered ? opts.seconds ?? 45 : 0, answered });
  await processGatewayEvents(device, evs as never, { clockOffsetMs: 0 });
  return db.callLog.findFirstOrThrow({ where: { callId, gatewayDeviceId: deviceId } });
}

async function main() {
  const saved = await db.setting.findMany({ where: { key: { in: KEYS } } });
  await clean();
  await saveSettings({ "checkin.enabled": "true", "checkin.numbers": "", "checkin.maxGpsAttempts": "3", "callAttendance.enabled": "true", "callAttendance.outgoingMode": "CONFIRMED" });
  const admin = await db.user.findFirstOrThrow({ where: { role: "SUPER_ADMIN" } });
  const actor = { userId: admin.id, name: admin.name };
  const client = await db.client.create({ data: { code: `${TAG}-C`, name: "Call Verify Client" } });
  const site = await db.location.create({ data: { code: `${TAG}-S`, name: "Call Verify Site", clientId: client.id, address: "1 Verify Road", supervisorId: admin.id, latitude: SITE.latitude, longitude: SITE.longitude, geofenceRadiusM: 150, coordinatesSource: "MAP" } });
  const ops = await createGateway({ deviceName: `${TAG} Operations Phone`, phoneNumber: "+263778859999", mode: "OPERATIONS_GATEWAY", locationId: site.id, actor });
  await activateGateway(ops.activationCode!, { appVersion: "1.8.0", androidVersion: "14", deviceModel: "Test", batteryLevel: 90, networkType: "wifi" }, "41.0.0.12");
  await db.gatewayDevice.update({ where: { id: ops.id }, data: { lastSeenAt: new Date(), status: "ONLINE" } });
  let n = 0;
  const mkGuard = (name: string, extra: Record<string, unknown> = {}) => db.guard.create({ data: { guardNo: `${TAG}-${name}`, firstName: name, lastName: "Verify", phone: `+2637788500${String(++n).padStart(2, "0")}`, nationalId: `${TAG}-${name}`, dateEmployed: new Date(), homeLocationId: site.id, phoneType: "BASIC", ...extra } });
  const now = new Date();
  const mkShift = (guardId: string, startOffset = 2) => db.shift.create({ data: { guardId, locationId: site.id, supervisorId: admin.id, startAt: addMinutes(now, startOffset), endAt: addMinutes(now, startOffset + 720), durationMinutes: 720, status: "SCHEDULED", attendance: { create: {} } } });
  const evidence = (shiftId: string) => db.attendanceEvidence.findMany({ where: { shiftId }, orderBy: { occurredAt: "asc" } });
  async function smartGuard(name: string) {
    const guard = await mkGuard(name, { phoneType: "ANDROID", deviceKind: "ANDROID_GUARD" });
    const g = await createGateway({ deviceName: `${TAG} ${name} phone`, phoneNumber: guard.phone, mode: "GUARD", guardId: guard.id, locationId: site.id, actor });
    await activateGateway(g.activationCode!, { appVersion: "1.8.0", androidVersion: "14", deviceModel: "Pixel", batteryLevel: 80, networkType: "lte" }, "41.0.0.20");
    const device = await db.gatewayDevice.update({ where: { id: g.id }, data: { lastSeenAt: new Date(), status: "ONLINE" } });
    return { guard, device };
  }

  console.log("Basic phone: the operator rings the guard");
  const bea = await mkGuard("Bea");
  const beaShift = await mkShift(bea.id);
  await call(ops.id, bea.phone, now, { direction: "OUTGOING" });
  let ev = await evidence(beaShift.id);
  let att = await db.attendance.findUniqueOrThrow({ where: { shiftId: beaShift.id } });
  let sh = await db.shift.findUniqueOrThrow({ where: { id: beaShift.id } });
  check("the guard answers: clocked in by call, flagged as the operator's call", ev.length === 1 && ev[0].kind === "CHECK_IN" && ev[0].status === "CONFIRMED" && ev[0].source === "CALL" && ev[0].flags.includes("OPERATOR_CALLED") && att.arrivalConfirmedAt != null && sh.status === "ON_DUTY", JSON.stringify(ev.map((e) => [e.status, e.flags])));
  const ben = await mkGuard("Ben");
  const benShift = await mkShift(ben.id);
  await call(ops.id, ben.phone, now, { direction: "OUTGOING", answered: false });
  check("the guard does not answer: nothing is recorded", (await evidence(benShift.id)).length === 0 && (await db.attendance.findUniqueOrThrow({ where: { shiftId: benShift.id } })).arrivalConfirmedAt == null);
  await saveSettings({ "callAttendance.outgoingMode": "PENDING" });
  const bob = await mkGuard("Bob");
  const bobShift = await mkShift(bob.id);
  await call(ops.id, bob.phone, now, { direction: "OUTGOING" });
  ev = await evidence(bobShift.id);
  check("outgoingMode PENDING: held for a supervisor", ev.length === 1 && ev[0].status === "PENDING" && (await db.attendance.findUniqueOrThrow({ where: { shiftId: bobShift.id } })).arrivalConfirmedAt == null);
  await saveSettings({ "callAttendance.outgoingMode": "DISABLED" });
  const bud = await mkGuard("Bud");
  const budShift = await mkShift(bud.id);
  await call(ops.id, bud.phone, now, { direction: "OUTGOING" });
  check("outgoingMode DISABLED: operator calls are ignored", (await evidence(budShift.id)).length === 0);
  await saveSettings({ "callAttendance.outgoingMode": "CONFIRMED" });
  const bix = await mkGuard("Bix");
  const bixShift = await mkShift(bix.id);
  await call(ops.id, bix.phone, now);
  check("basic phone ringing in still clocks in as before", (await evidence(bixShift.id))[0]?.status === "CONFIRMED" && !(await evidence(bixShift.id))[0]?.flags.includes("OPERATOR_CALLED"));

  console.log("Guard app: the guard rings the operations phone");
  const { guard: sam, device: samPhone } = await smartGuard("Sam");
  const samShift = await mkShift(sam.id);
  await call(ops.id, sam.phone, now);
  let ci = await db.attendanceCheckIn.findUnique({ where: { shiftId: samShift.id } });
  let reqs = await db.deviceLocationRequest.findMany({ where: { guardId: sam.id } });
  check("the call seen by the operations phone asks the guard's own phone for a fix", ci?.status === "GPS_PENDING" && reqs.length === 1 && reqs[0].gatewayDeviceId === samPhone.id, JSON.stringify({ status: ci?.status, reqs: reqs.length }));
  ev = await evidence(samShift.id);
  check("the call is kept, held until the fix decides, not shown as clocked in", ev.length === 1 && ev[0].status === "PENDING" && ev[0].flags.includes("GPS_REQUESTED") && (await db.attendance.findUniqueOrThrow({ where: { shiftId: samShift.id } })).arrivalConfirmedAt == null, JSON.stringify(ev.map((e) => [e.status, e.flags])));
  check("no 'confirm this call' alert while the GPS check is running", (await db.notification.count({ where: { shiftId: samShift.id, type: "CALL_ATTENDANCE_PENDING" } })) === 0);
  // The guard's own phone also reports its side of the same conversation.
  await call(samPhone.id, ops.phoneNumber!, addMinutes(now, 0), { direction: "OUTGOING" });
  check("the guard's phone reporting the same call does not ask for a second fix", (await db.deviceLocationRequest.count({ where: { guardId: sam.id } })) === 1);
  ci = await db.attendanceCheckIn.findUniqueOrThrow({ where: { shiftId: samShift.id } });
  await applyFix(ci.id, { latitude: SITE.latitude, longitude: SITE.longitude, accuracyM: 9, capturedAt: addMinutes(now, 1), mock: false, source: "CALL_GPS", locationRequestId: reqs[0].id }, addMinutes(now, 1));
  ci = await db.attendanceCheckIn.findUniqueOrThrow({ where: { shiftId: samShift.id } });
  att = await db.attendance.findUniqueOrThrow({ where: { shiftId: samShift.id } });
  sh = await db.shift.findUniqueOrThrow({ where: { id: samShift.id } });
  ev = await evidence(samShift.id);
  check("the fix inside the geofence clocks the guard in, GPS verified", ci.status.startsWith("VERIFIED") && att.arrivalConfirmedAt != null && att.locationVerification === "VERIFIED" && sh.status === "ON_DUTY", `${ci.status} ${att.locationVerification} ${sh.status}`);
  check("…and settles the held call; GPS evidence recorded beside it", ev.some((e) => e.source === "GPS" && e.status === "CONFIRMED") && ev.filter((e) => e.source === "CALL").every((e) => e.status === "CONFIRMED"), JSON.stringify(ev.map((e) => [e.source, e.status])));

  console.log("Guard app: the operator rings the guard");
  const { guard: sue, device: suePhone } = await smartGuard("Sue");
  const sueShift = await mkShift(sue.id);
  await call(ops.id, sue.phone, now, { direction: "OUTGOING" });
  ci = await db.attendanceCheckIn.findUnique({ where: { shiftId: sueShift.id } });
  reqs = await db.deviceLocationRequest.findMany({ where: { guardId: sue.id } });
  check("the operator's call asks the guard's phone for a fix", ci?.status === "GPS_PENDING" && reqs.length === 1 && reqs[0].gatewayDeviceId === suePhone.id, JSON.stringify({ status: ci?.status, reqs: reqs.length }));
  const tl = await db.shiftCheckIn.findFirst({ where: { shiftId: sueShift.id, type: "CALL_OUTGOING", note: { contains: "operator rang" } } });
  check("the timeline says the operator rang and a GPS fix was requested", Boolean(tl?.note?.includes("GPS fix")), tl?.note ?? "");

  console.log("Guard app: the phone cannot be asked");
  const { guard: sid, device: sidPhone } = await smartGuard("Sid");
  await db.gatewayDevice.update({ where: { id: sidPhone.id }, data: { status: "REVOKED" } });
  const sidShift = await mkShift(sid.id);
  await call(ops.id, sid.phone, now);
  ci = await db.attendanceCheckIn.findUnique({ where: { shiftId: sidShift.id } });
  ev = await evidence(sidShift.id);
  check("a revoked phone: location unavailable, with the reason", ci?.status === "LOCATION_UNAVAILABLE" && Boolean(ci.exceptionReason?.includes("revoked")), `${ci?.status} ${ci?.exceptionReason}`);
  check("…so no fix is coming and the call is decided like a basic phone's: clocked in by call", ev.length === 1 && ev[0].status === "CONFIRMED" && ev[0].source === "CALL" && !ev[0].flags.includes("GPS_REQUESTED"), JSON.stringify(ev.map((e) => [e.status, e.flags])));
  check("…never shown as GPS verified", (await db.attendance.findUniqueOrThrow({ where: { shiftId: sidShift.id } })).locationVerification !== "VERIFIED");

  console.log("Engine runs from the portal; Calls or SMS");
  const lia = await mkGuard("Lia");
  const liaShift = await mkShift(lia.id, -3); // started three minutes ago, still SCHEDULED
  await db.schedulerLease.updateMany({ where: { name: "automation" }, data: { lastRunAt: new Date(Date.now() - 10 * 60_000), leaseUntil: new Date(0) } });
  await maybeTickFromPortal();
  const lease = await db.schedulerLease.findUnique({ where: { name: "automation" } });
  check("a portal page view runs the engine when it has not run for a minute", lease?.lastSource === "portal" && Boolean(lease.lastRunAt && Date.now() - lease.lastRunAt.getTime() < 60_000), JSON.stringify({ src: lease?.lastSource, at: lease?.lastRunAt }));
  await maybeTickFromPortal();
  const lease2 = await db.schedulerLease.findUnique({ where: { name: "automation" } });
  check("…but not twice within the minute", lease2?.lastRunAt?.getTime() === lease?.lastRunAt?.getTime());
  const started = await db.shift.findUniqueOrThrow({ where: { id: liaShift.id } });
  check("that run moved a shift whose start had passed out of SCHEDULED", started.status === "AWAITING_ARRIVAL" && started.arrivalSmsSentAt != null, started.status);
  const parsed = guardSchema.safeParse({ firstName: "A", lastName: "B", phone: "0772123456", nationalId: "63-123456-X-07", gender: "MALE", dateEmployed: "2026-01-01", employmentStatus: "ACTIVE", preferredAttendance: "CALL_OR_SMS" });
  check("the guard form accepts 'Calls or SMS'", parsed.success && parsed.data.preferredAttendance === "CALL_OR_SMS", parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 2)));

  await clean();
  await db.setting.deleteMany({ where: { key: { in: KEYS } } });
  for (const s of saved) await db.setting.create({ data: s });
  console.log(`\n${passed} passed, ${failed} failed · test data removed`);
  await db.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
