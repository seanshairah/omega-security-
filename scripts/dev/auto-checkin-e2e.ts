/**
 * Automatic shift-start GPS attendance, end to end against a real database.
 *
 * Every fix goes through processGatewayEvents, the same path a phone's upload takes, including
 * the clock offset measured from the batch's `sentAt`. Nobody calls in any case unless the case is
 * about the call.
 *
 *   npx tsx scripts/dev/auto-checkin-e2e.ts
 */
process.env.SMS_PROVIDER = "simulated";
import { config } from "dotenv"; config();
const dbUrl = process.env.DATABASE_URL ?? "";
if (!/localhost|127\.0\.0\.1/.test(dbUrl) && process.env.ALLOW_LIVE_DB !== "1") {
  console.error("Refusing to run against a non-local DATABASE_URL.");
  process.exit(2);
}
import { randomUUID } from "node:crypto";
import { addHours, addMinutes } from "date-fns";
import type { GatewayDevice } from "@prisma/client";
import { db } from "../../src/lib/db";
import { createShift } from "../../src/lib/services/shifts";
import { createGateway, activateGateway } from "../../src/lib/gateway/service";
import { processGatewayEvents } from "../../src/lib/gateway/events";
import { decide, handleCall, runCheckInStep } from "../../src/lib/attendance/check-in-service";
import { complianceFor, type CheckInStatus } from "../../src/lib/attendance/check-in";
import { saveSettings } from "../../src/lib/settings";

let passed = 0, failed = 0;
const check = (name: string, ok: boolean, detail = "") => { if (ok) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name} ${detail}`); } };

const TAG = "AUTOCI-E2E";
const SITE = { latitude: -17.8292, longitude: 31.0522, radius: 150 };
const INSIDE = { latitude: -17.8293, longitude: 31.0523 };
const AWAY = { latitude: -17.8400, longitude: 31.0600 };

async function clean() {
  const guards = await db.guard.findMany({ where: { nationalId: { startsWith: TAG } }, select: { id: true } });
  const gIds = guards.map((g) => g.id);
  const sIds = (await db.shift.findMany({ where: { guardId: { in: gIds } }, select: { id: true } })).map((s) => s.id);
  const dIds = (await db.gatewayDevice.findMany({ where: { deviceName: { startsWith: TAG } }, select: { id: true } })).map((d) => d.id);
  await db.clientNotification.deleteMany({ where: { OR: [{ shiftId: { in: sIds } }, { guardId: { in: gIds } }] } });
  await db.attendanceCheckIn.deleteMany({ where: { OR: [{ shiftId: { in: sIds } }, { guardId: { in: gIds } }] } });
  await db.deviceLocationRequest.deleteMany({ where: { OR: [{ gatewayDeviceId: { in: dIds } }, { guardId: { in: gIds } }] } });
  await db.locationEvent.deleteMany({ where: { OR: [{ shiftId: { in: sIds } }, { gatewayDeviceId: { in: dIds } }] } });
  await db.gatewayEvent.deleteMany({ where: { gatewayDeviceId: { in: dIds } } });
  await db.callLog.deleteMany({ where: { OR: [{ shiftId: { in: sIds } }, { gatewayDeviceId: { in: dIds } }, { guardId: { in: gIds } }] } });
  await db.notification.deleteMany({ where: { OR: [{ shiftId: { in: sIds } }, { guardId: { in: gIds } }] } });
  await db.shiftCheckIn.deleteMany({ where: { shiftId: { in: sIds } } });
  await db.smsMessage.deleteMany({ where: { OR: [{ shiftId: { in: sIds } }, { guardId: { in: gIds } }] } });
  await db.attendance.deleteMany({ where: { shiftId: { in: sIds } } });
  await db.shift.deleteMany({ where: { id: { in: sIds } } });
  await db.gatewayDevice.deleteMany({ where: { id: { in: dIds } } });
  await db.guard.deleteMany({ where: { id: { in: gIds } } });
  await db.location.deleteMany({ where: { code: { startsWith: TAG } } });
  await db.client.deleteMany({ where: { code: { startsWith: TAG } } });
}

async function setup() {
  const admin = await db.user.findFirstOrThrow({ where: { role: "SUPER_ADMIN" } });
  const client = await db.client.create({ data: { code: `${TAG}-C`, name: "Auto check-in Client", contactPhone: "+263242000778" } });
  const site = await db.location.create({ data: { code: `${TAG}-S1`, name: "Belgravia Depot (auto)", clientId: client.id, address: "Second St", supervisorId: admin.id, latitude: SITE.latitude, longitude: SITE.longitude, geofenceRadiusM: SITE.radius, coordinatesSource: "MAP" } });
  return { admin, client, site, actor: { userId: admin.id, name: admin.name } };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

let n = 0;
async function makeGuard(ctx: Ctx, kind: "ANDROID_GUARD" | "FEATURE_PHONE" = "ANDROID_GUARD") {
  n++;
  const phone = `+26377881${String(1000 + n).slice(-4)}`;
  const guard = await db.guard.create({ data: { guardNo: `${TAG}-${n}`, firstName: "Auto", lastName: `No${n}`, phone, nationalId: `${TAG}-${n}`, dateEmployed: new Date(), homeLocationId: ctx.site.id, deviceKind: kind } });
  if (kind === "FEATURE_PHONE") return { guard, device: null as GatewayDevice | null };
  const g = await createGateway({ deviceName: `${TAG} phone ${n}`, phoneNumber: phone, mode: "GUARD", guardId: guard.id, locationId: ctx.site.id, actor: ctx.actor });
  await activateGateway(g.activationCode!, { appVersion: "1.8.0", androidVersion: "14", deviceModel: "Test", batteryLevel: 80, networkType: "wifi" }, "41.0.0.10");
  const device = await db.gatewayDevice.update({ where: { id: g.id }, data: { lastSeenAt: new Date() } });
  return { guard, device: device as GatewayDevice | null };
}

const makeShift = (ctx: Ctx, guardId: string, startAt: Date) =>
  createShift({ guardId, locationId: ctx.site.id, supervisorId: ctx.admin.id, startAt, endAt: addHours(startAt, 8), actorUserId: ctx.admin.id, actorName: ctx.admin.name });

/** A monitoring fix, uploaded the way the phone uploads it. `clockOffsetMs` undefined = an app too old to send `sentAt`. */
async function sendFix(deviceId: string, shiftId: string, at: Date, where: { latitude: number; longitude: number }, opts: { accuracyM?: number; mock?: boolean; clockOffsetMs?: number | null; eventId?: string } = {}) {
  const device = await db.gatewayDevice.findUniqueOrThrow({ where: { id: deviceId } });
  const ev = { eventId: opts.eventId ?? randomUUID(), eventType: "LOCATION_CHECK", timestamp: at.toISOString(), latitude: where.latitude, longitude: where.longitude, accuracyM: opts.accuracyM ?? 12, shiftId, mock: Boolean(opts.mock) };
  const [ack] = await processGatewayEvents(device, [ev], { clockOffsetMs: opts.clockOffsetMs === null ? undefined : opts.clockOffsetMs ?? 0 });
  return ack;
}

const row = (shiftId: string) => db.attendanceCheckIn.findUniqueOrThrow({ where: { shiftId } });
const mins = (a: Date | null, b: Date) => (a ? Math.round((a.getTime() - b.getTime()) / 60_000) : NaN);

async function main() {
  await clean();
  const ctx = await setup();
  await saveSettings({ "checkin.enabled": "true", "checkin.autoGps": "true", "checkin.autoBeforeMinutes": "10", "checkin.callRequired": "false", "checkin.graceMinutes": "5", "checkin.escalationMinutes": "15", "checkin.windowBeforeMinutes": "60", "checkin.windowAfterMinutes": "120", "checkin.maxGpsAttempts": "3", "checkin.numbers": "", "geofence.accuracyMaxM": "100", "gateway.offlineMinutes": "5" });
  const now = () => new Date();

  console.log("verified before the shift, with no call");
  {
    const { guard, device } = await makeGuard(ctx);
    const t = now();
    const shift = await makeShift(ctx, guard.id, addMinutes(t, 8));
    await sendFix(device!.id, shift.id, t, INSIDE);
    const r = await row(shift.id);
    check("a fix inside the site 8 min before the start verifies attendance", r.status === "VERIFIED_ON_TIME", r.status);
    check("no call was needed", r.callAt === null);
    check("the source is the phone's own monitoring", r.source === "MONITORING", r.source);
    check("the arrival is the fix's capture time", Math.abs(r.verifiedArrivalAt!.getTime() - t.getTime()) < 1000);
    check("with the call optional, the shift is compliant", complianceFor({ status: r.status as CheckInStatus, source: r.source, callRequired: r.callRequired, callAt: r.callAt }).overall === "COMPLIANT");
    const att = await db.attendance.findUniqueOrThrow({ where: { shiftId: shift.id } });
    check("the attendance record says present and GPS-verified", att.status === "PRESENT" && att.locationVerification === "VERIFIED", `${att.status} ${att.locationVerification}`);
  }

  console.log("a fix from before the window does not count");
  {
    const { guard, device } = await makeGuard(ctx);
    const t = now();
    const shift = await makeShift(ctx, guard.id, addMinutes(t, 30));
    await sendFix(device!.id, shift.id, t, INSIDE);
    const r = await row(shift.id);
    check("a fix 30 min before a shift is not arrival evidence", r.status === "AWAITING" && r.verifiedArrivalAt === null, r.status);
    check("the reason is recorded", /before the check-in window opens/.test(r.exceptionReason ?? ""), r.exceptionReason ?? "");
  }

  console.log("the server asks the phone at -10, at the start and at the end of grace");
  {
    const { guard, device } = await makeGuard(ctx);
    const t = now();
    const start = addMinutes(t, 9);
    const shift = await makeShift(ctx, guard.id, start);
    await runCheckInStep(t);
    const r1 = await row(shift.id);
    const req = await db.deviceLocationRequest.findFirst({ where: { guardId: guard.id }, orderBy: { requestedAt: "desc" } });
    check("ten minutes before, a position request goes to the phone without a call", r1.status === "GPS_PENDING" && r1.autoRequestedAt !== null && req?.purpose === "CHECKIN", `${r1.status} ${req?.purpose}`);
    await runCheckInStep(addMinutes(t, 0.5));
    const r2 = await row(shift.id);
    check("the same moment is not asked twice", r2.autoRequestedAt!.getTime() === r1.autoRequestedAt!.getTime());
    // The phone answers the open request.
    const open = await db.deviceLocationRequest.findFirstOrThrow({ where: { guardId: guard.id, status: { in: ["PENDING", "DELIVERED", "PROCESSING"] } } });
    const dev = await db.gatewayDevice.findUniqueOrThrow({ where: { id: device!.id } });
    const capturedAt = now();
    await processGatewayEvents(dev, [{ eventId: randomUUID(), eventType: "LOCATION_REQUEST_RESULT", timestamp: capturedAt.toISOString(), requestId: open.id, status: "COMPLETED", latitude: INSIDE.latitude, longitude: INSIDE.longitude, accuracyM: 8, capturedAt: capturedAt.toISOString() }], { clockOffsetMs: 0 });
    const r4 = await row(shift.id);
    check("the phone's answer verifies attendance", r4.status === "VERIFIED_ON_TIME", r4.status);
    check("and is recorded as an automatic shift-start fix", r4.source === "AUTO_GPS", r4.source);
  }
  {
    // Nothing answered the request ten minutes before: at the start the phone is asked again.
    const { guard } = await makeGuard(ctx);
    const start = now();
    const shift = await makeShift(ctx, guard.id, start);
    await runCheckInStep(addMinutes(start, -10));
    const before = await row(shift.id);
    await runCheckInStep(start);
    const r = await row(shift.id);
    check("unanswered at -10, it is asked again at the start", before.autoRequestedAt!.getTime() === addMinutes(start, -10).getTime() && r.autoRequestedAt!.getTime() === start.getTime());
    await runCheckInStep(addMinutes(start, 5));
    const r2 = await row(shift.id);
    check("and once more at the end of the grace period", r2.autoRequestedAt!.getTime() === addMinutes(start, 5).getTime());
  }

  console.log("on the way: outside before the grace period ends, then inside");
  {
    const { guard, device } = await makeGuard(ctx);
    const t = now();
    const start = addMinutes(t, -2);
    const shift = await makeShift(ctx, guard.id, start);
    await sendFix(device!.id, shift.id, t, AWAY);
    const r1 = await row(shift.id);
    check("outside 2 min after the start is recorded", r1.status === "OUTSIDE_AREA", r1.status);
    check("but nobody is alerted yet", r1.notifiedAt === null && (await db.notification.count({ where: { shiftId: shift.id, type: "LOCATION_EXCEPTION" } })) === 0);
    const att = await db.attendance.findUniqueOrThrow({ where: { shiftId: shift.id } });
    check("and the attendance record is left alone", att.locationVerification !== "EXCEPTION", att.locationVerification);
    await sendFix(device!.id, shift.id, addMinutes(t, 0.1), INSIDE);
    const r2 = await row(shift.id);
    check("arriving inside the grace period verifies within grace", r2.status === "VERIFIED_WITHIN_GRACE", r2.status);
  }

  console.log("still outside when time runs out");
  {
    const { guard, device } = await makeGuard(ctx);
    const t = now();
    const start = addMinutes(t, -3);
    const shift = await makeShift(ctx, guard.id, start);
    await sendFix(device!.id, shift.id, t, AWAY);
    await runCheckInStep(addMinutes(start, 21));
    const r = await row(shift.id);
    check("the shift stays 'outside the site', not 'missed'", r.status === "OUTSIDE_AREA" && r.escalatedAt !== null, r.status);
    const n1 = await db.notification.findFirst({ where: { shiftId: shift.id, type: "GUARD_NOT_REPORTED" } });
    check("and the supervisor is told it is outside, critically", Boolean(n1 && n1.severity === "CRITICAL" && /Outside the assigned site/.test(n1.title)), n1?.title ?? "none");
  }

  console.log("GPS too vague");
  {
    const { guard, device } = await makeGuard(ctx);
    const t = now();
    const start = addMinutes(t, 1);
    const shift = await makeShift(ctx, guard.id, start);
    await sendFix(device!.id, shift.id, t, INSIDE, { accuracyM: 400 });
    const r1 = await row(shift.id);
    check("a ±400 m fix is uncertain, never inside", r1.status === "LOCATION_UNCERTAIN", r1.status);
    await runCheckInStep(addMinutes(start, 21));
    const r2 = await row(shift.id);
    check("and stays uncertain when escalated", r2.status === "LOCATION_UNCERTAIN" && r2.escalatedAt !== null, r2.status);
  }

  console.log("no fix at all");
  {
    const { guard } = await makeGuard(ctx);
    const t = now();
    const shift = await makeShift(ctx, guard.id, addMinutes(t, -30));
    await runCheckInStep(t);
    const r = await row(shift.id);
    check("an online phone that never sent a usable fix is missed", r.status === "MISSED", r.status);
  }
  {
    const { guard, device } = await makeGuard(ctx);
    const t = now();
    await db.gatewayDevice.update({ where: { id: device!.id }, data: { lastSeenAt: addMinutes(t, -90) } });
    const shift = await makeShift(ctx, guard.id, addMinutes(t, -30));
    await runCheckInStep(t);
    const r = await row(shift.id);
    check("a phone that stopped reporting is 'phone offline', not missed", r.status === "DEVICE_OFFLINE", r.status);
    check("the reason says it is not the same as absent", /not the same as absent/.test(r.exceptionReason ?? ""), r.exceptionReason ?? "");
    const decided = await decide(r.id, "APPROVE", ctx.actor, "Supervisor visited the site and found the guard on post");
    const after = await row(shift.id);
    check("a supervisor can approve it by hand", decided === "MANUALLY_APPROVED" && after.source === "MANUAL" && after.previousStatus === "DEVICE_OFFLINE");
    check("and it reads as a manual decision, not GPS", complianceFor({ status: after.status as CheckInStatus, source: after.source, callRequired: after.callRequired, callAt: after.callAt }).presence === "MANUAL");
  }

  console.log("delayed upload and wrong clocks");
  {
    const { guard, device } = await makeGuard(ctx);
    const t = now();
    const start = addMinutes(t, -32);
    const shift = await makeShift(ctx, guard.id, start);
    await sendFix(device!.id, shift.id, addMinutes(start, -2), INSIDE, { clockOffsetMs: 0 });
    const r = await row(shift.id);
    check("a fix taken 2 min before the start and uploaded 32 min later is on time", r.status === "VERIFIED_ON_TIME" && mins(r.verifiedArrivalAt, start) === -2, `${r.status} ${mins(r.verifiedArrivalAt, start)}`);
  }
  {
    const { guard, device } = await makeGuard(ctx);
    const t = now();
    const start = addMinutes(t, -32);
    const shift = await makeShift(ctx, guard.id, start);
    await sendFix(device!.id, shift.id, addMinutes(start, -2), INSIDE, { clockOffsetMs: null });
    const r = await row(shift.id);
    check("from an app too old to send its clock, the same upload is conservatively late", r.status === "VERIFIED_LATE", r.status);
  }
  {
    const { guard, device } = await makeGuard(ctx);
    const t = now();
    const start = addMinutes(t, -10);
    const shift = await makeShift(ctx, guard.id, start);
    const twoHours = 2 * 3_600_000;
    // The phone's clock runs two hours slow: it stamps the fix two hours early, and says so in sentAt.
    await sendFix(device!.id, shift.id, new Date(addMinutes(start, -1).getTime() - twoHours), INSIDE, { clockOffsetMs: twoHours });
    const r = await row(shift.id);
    check("a phone clock two hours slow is corrected, not believed", r.status === "VERIFIED_ON_TIME" && mins(r.verifiedArrivalAt, start) === -1, `${r.status} ${mins(r.verifiedArrivalAt, start)}`);
  }

  console.log("duplicates and out-of-order uploads");
  {
    const { guard, device } = await makeGuard(ctx);
    const t = now();
    const start = addMinutes(t, -10);
    const shift = await makeShift(ctx, guard.id, start);
    const id = randomUUID();
    const a1 = await sendFix(device!.id, shift.id, addMinutes(start, 3), INSIDE, { eventId: id });
    const a2 = await sendFix(device!.id, shift.id, addMinutes(start, 3), INSIDE, { eventId: id });
    check("the same event twice is acknowledged as a duplicate", a1.status === "ok" && a2.status === "duplicate", `${a1.status} ${a2.status}`);
    check("and creates one attendance decision", (await db.attendanceCheckIn.count({ where: { shiftId: shift.id } })) === 1);
    const r1 = await row(shift.id);
    check("first upload: verified within grace", r1.status === "VERIFIED_WITHIN_GRACE", r1.status);
    await sendFix(device!.id, shift.id, addMinutes(start, -1), INSIDE);
    const r2 = await row(shift.id);
    check("an earlier fix arriving later moves the arrival back to the truth", r2.status === "VERIFIED_ON_TIME" && mins(r2.verifiedArrivalAt, start) === -1, `${r2.status} ${mins(r2.verifiedArrivalAt, start)}`);
    await sendFix(device!.id, shift.id, addMinutes(start, 8), AWAY);
    const r3 = await row(shift.id);
    check("a later outside fix does not undo a verified arrival", r3.status === "VERIFIED_ON_TIME");
  }

  console.log("the five-minute grace table");
  {
    const t = now();
    const start = addMinutes(t, -15);
    const table: [number, CheckInStatus, number][] = [[-2, "VERIFIED_ON_TIME", 0], [3, "VERIFIED_WITHIN_GRACE", 0], [5, "VERIFIED_WITHIN_GRACE", 0], [6, "VERIFIED_LATE", 1], [12, "VERIFIED_LATE", 7]];
    for (const [m, expect, late] of table) {
      const { guard, device } = await makeGuard(ctx);
      const shift = await makeShift(ctx, guard.id, start);
      await sendFix(device!.id, shift.id, addMinutes(start, m), INSIDE);
      const r = await row(shift.id);
      check(`arrival ${m >= 0 ? "+" : ""}${m} min → ${expect}${late ? `, ${late} min beyond grace` : ""}`, r.status === expect && r.lateMinutes === late, `${r.status} late ${r.lateMinutes}`);
    }
  }

  console.log("when the company also requires the call");
  {
    await saveSettings({ "checkin.callRequired": "true" });
    const { guard, device } = await makeGuard(ctx);
    const t = now();
    const start = addMinutes(t, -25);
    const shift = await makeShift(ctx, guard.id, start);
    await sendFix(device!.id, shift.id, addMinutes(start, 1), INSIDE);
    await runCheckInStep(t);
    const r1 = await row(shift.id);
    check("presence verified by GPS", r1.status === "VERIFIED_WITHIN_GRACE", r1.status);
    check("the shift reads 'call outstanding', not absent", complianceFor({ status: r1.status as CheckInStatus, source: r1.source, callRequired: r1.callRequired, callAt: r1.callAt }).overall === "CALL_OUTSTANDING");
    const out1 = await db.notification.count({ where: { shiftId: shift.id, type: "CHECK_IN_CALL_OUTSTANDING" } });
    await runCheckInStep(addMinutes(t, 1));
    const out2 = await db.notification.count({ where: { shiftId: shift.id, type: "CHECK_IN_CALL_OUTSTANDING" } });
    check("the supervisor is told once", out1 === 1 && out2 === 1, `${out1} ${out2}`);
    const call = await db.callLog.create({ data: { callId: `${TAG}-${randomUUID()}`, gatewayDeviceId: device!.id, guardId: guard.id, phoneNumber: "+263772100100", normalizedPhoneNumber: "+263772100100", direction: "OUTGOING", status: "ENDED", startedAt: addMinutes(start, 2), answeredAt: addMinutes(start, 2), endedAt: addMinutes(start, 3), durationSeconds: 60 } });
    const outcome = await handleCall(call, (await db.gatewayDevice.findUniqueOrThrow({ where: { id: device!.id } })));
    const r2 = await row(shift.id);
    check("a call after GPS verification is recorded, not turned away", outcome.startsWith("call recorded") && r2.callAt !== null, outcome);
    check("and the shift is compliant", complianceFor({ status: r2.status as CheckInStatus, source: r2.source, callRequired: r2.callRequired, callAt: r2.callAt }).overall === "COMPLIANT");
    await saveSettings({ "checkin.callRequired": "false" });
  }

  console.log("other guards' phones, fake locations, basic phones");
  {
    const a = await makeGuard(ctx);
    const b = await makeGuard(ctx);
    const t = now();
    const shiftA = await makeShift(ctx, a.guard.id, addMinutes(t, -2));
    await sendFix(b.device!.id, shiftA.id, t, INSIDE);
    const r = await db.attendanceCheckIn.findUnique({ where: { shiftId: shiftA.id } });
    check("a fix from another guard's phone, naming this shift, verifies nothing", !r || r.verifiedArrivalAt === null, r?.status ?? "no row");
  }
  {
    const { guard, device } = await makeGuard(ctx);
    const t = now();
    const shift = await makeShift(ctx, guard.id, addMinutes(t, -2));
    await sendFix(device!.id, shift.id, t, INSIDE, { mock: true });
    const r = await row(shift.id);
    check("a mock location goes to manual review, never verified", r.status === "MANUAL_REVIEW" && r.mock, r.status);
  }
  {
    const { guard } = await makeGuard(ctx, "FEATURE_PHONE");
    const t = now();
    const shift = await makeShift(ctx, guard.id, addMinutes(t, -40));
    await runCheckInStep(t);
    const r = await row(shift.id);
    const reqs = await db.deviceLocationRequest.count({ where: { guardId: guard.id } });
    check("a basic-phone guard is SMS attendance: no GPS request, no escalation", r.source === "SMS_ONLY" && reqs === 0 && r.escalatedAt === null, `${r.source} ${reqs}`);
  }

  await clean();
  console.log(`\n${passed} passed, ${failed} failed`);
  await db.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
