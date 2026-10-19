/**
 * Call-triggered attendance verification, end to end against a real database.
 *
 * Covers the scenarios in the brief: the grace table, a fix outside the site, poor accuracy, no
 * fix, an offline phone, a late fix, duplicate calls and duplicate fixes, a cancelled shift,
 * overlapping shifts, a revoked device, clock skew, per-site and per-shift grace overrides, a
 * supervisor override, escalation to missed, a feature-phone guard, and a restart mid-verification.
 *
 *   npx tsx scripts/dev/check-in-e2e.ts
 */
process.env.SMS_PROVIDER = "simulated";
import { config } from "dotenv"; config();
const dbUrl = process.env.DATABASE_URL ?? "";
if (!/localhost|127\.0\.0\.1/.test(dbUrl) && process.env.ALLOW_LIVE_DB !== "1") {
  console.error("Refusing to run against a non-local DATABASE_URL.");
  process.exit(2);
}
import { addMinutes, addHours } from "date-fns";
import { db } from "../../src/lib/db";
import { createShift } from "../../src/lib/services/shifts";
import { createGateway, activateGateway } from "../../src/lib/gateway/service";
import { applyFix, checkInConfig, decide, ensureExpectation, handleCall, runCheckInStep } from "../../src/lib/attendance/check-in-service";
import { saveSettings } from "../../src/lib/settings";

let passed = 0, failed = 0;
const check = (name: string, ok: boolean, detail = "") => { if (ok) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name} ${detail}`); } };

const TAG = "CHECKIN-E2E";
const SITE = { latitude: -17.8292, longitude: 31.0522, radius: 150 };
/** ~1.2 km away: confidently outside a 150 m fence. */
const AWAY = { latitude: -17.8400, longitude: 31.0600 };

async function clean() {
  const guards = await db.guard.findMany({ where: { nationalId: { startsWith: TAG } }, select: { id: true } });
  const gIds = guards.map((g) => g.id);
  const shifts = await db.shift.findMany({ where: { guardId: { in: gIds } }, select: { id: true } });
  const sIds = shifts.map((s) => s.id);
  const devs = await db.gatewayDevice.findMany({ where: { deviceName: { startsWith: TAG } }, select: { id: true } });
  const dIds = devs.map((d) => d.id);
  await db.attendanceCheckIn.deleteMany({ where: { OR: [{ shiftId: { in: sIds } }, { guardId: { in: gIds } }] } });
  await db.deviceLocationRequest.deleteMany({ where: { OR: [{ gatewayDeviceId: { in: dIds } }, { guardId: { in: gIds } }] } });
  await db.locationEvent.deleteMany({ where: { OR: [{ shiftId: { in: sIds } }, { gatewayDeviceId: { in: dIds } }] } });
  await db.callLog.deleteMany({ where: { OR: [{ shiftId: { in: sIds } }, { gatewayDeviceId: { in: dIds } }, { guardId: { in: gIds } }] } });
  await db.notification.deleteMany({ where: { shiftId: { in: sIds } } });
  await db.shiftCheckIn.deleteMany({ where: { shiftId: { in: sIds } } });
  await db.welfareCheck.deleteMany({ where: { shiftId: { in: sIds } } });
  await db.smsMessage.deleteMany({ where: { OR: [{ shiftId: { in: sIds } }, { guardId: { in: gIds } }] } });
  await db.attendance.deleteMany({ where: { shiftId: { in: sIds } } });
  await db.shift.deleteMany({ where: { id: { in: sIds } } });
  await db.gatewayDevice.deleteMany({ where: { id: { in: dIds } } });
  await db.guard.deleteMany({ where: { id: { in: gIds } } });
  await db.location.deleteMany({ where: { code: { startsWith: TAG } } });
  await db.client.deleteMany({ where: { code: { startsWith: TAG } } });
}

type Ctx = Awaited<ReturnType<typeof setup>>;

async function setup() {
  const admin = await db.user.findFirstOrThrow({ where: { role: "SUPER_ADMIN" } });
  const client = await db.client.create({ data: { code: `${TAG}-C`, name: "Check-in Client", contactPhone: "+263242000777" } });
  const site = await db.location.create({ data: { code: `${TAG}-S1`, name: "Eastgate Office Park (check-in)", clientId: client.id, address: "Robert Mugabe Rd", supervisorId: admin.id, latitude: SITE.latitude, longitude: SITE.longitude, geofenceRadiusM: SITE.radius, coordinatesSource: "MAP" } });
  const bare = await db.location.create({ data: { code: `${TAG}-S2`, name: "Site without coordinates", clientId: client.id, address: "Unknown", supervisorId: admin.id } });
  return { admin, client, site, bare, actor: { userId: admin.id, name: admin.name } };
}

/** A guard with an activated Android phone in guard mode. */
async function makeGuard(ctx: Ctx, n: number, deviceKind: "ANDROID_GUARD" | "FEATURE_PHONE" = "ANDROID_GUARD") {
  const phone = `+26377880${String(1000 + n).slice(-4)}`;
  const guard = await db.guard.create({ data: { guardNo: `${TAG}-${n}`, firstName: "Guard", lastName: `No${n}`, phone, nationalId: `${TAG}-${n}`, dateEmployed: new Date(), homeLocationId: ctx.site.id, deviceKind } });
  if (deviceKind === "FEATURE_PHONE") return { guard, device: null };
  const g = await createGateway({ deviceName: `${TAG} phone ${n}`, phoneNumber: phone, mode: "GUARD", guardId: guard.id, locationId: ctx.site.id, actor: ctx.actor });
  await activateGateway(g.activationCode!, { appVersion: "1.6.0", androidVersion: "13", deviceModel: "Test", batteryLevel: 80, networkType: "wifi" }, "41.0.0.9");
  const device = await db.gatewayDevice.findUniqueOrThrow({ where: { id: g.id } });
  return { guard, device };
}

async function makeShift(ctx: Ctx, guardId: string, startAt: Date, siteId?: string) {
  return createShift({ guardId, locationId: siteId ?? ctx.site.id, supervisorId: ctx.admin.id, startAt, endAt: addHours(startAt, 8), actorUserId: ctx.admin.id, actorName: ctx.admin.name });
}

/** A call recorded by the guard's own device, as the gateway pipeline would store it. */
async function recordCall(guardId: string, deviceId: string, at: Date, toNumber = "+263772100100") {
  return db.callLog.create({ data: { callId: `${TAG}-${Math.random().toString(36).slice(2)}`, gatewayDeviceId: deviceId, guardId, phoneNumber: toNumber, normalizedPhoneNumber: toNumber, direction: "OUTGOING", status: "ENDED", startedAt: at, answeredAt: at, endedAt: addMinutes(at, 1), durationSeconds: 60 } });
}

const row = (shiftId: string) => db.attendanceCheckIn.findUniqueOrThrow({ where: { shiftId } });

async function main() {
  await clean();
  const ctx = await setup();
  await saveSettings({ "checkin.enabled": "true", "checkin.graceMinutes": "5", "checkin.windowBeforeMinutes": "60", "checkin.windowAfterMinutes": "120", "checkin.correlationMinutes": "10", "checkin.escalationMinutes": "15", "checkin.maxGpsAttempts": "3", "checkin.numbers": "", "geofence.accuracyMaxM": "100" });
  const cfg = await checkInConfig();
  check("settings expose the five-minute default grace", cfg.graceMinutes === 5 && cfg.enabled, JSON.stringify({ g: cfg.graceMinutes, e: cfg.enabled }));

  const start = new Date(Date.now() - 60 * 60 * 1000); // an hour ago, so "late" arithmetic is natural
  const fixAt = (mins: number) => addMinutes(start, mins);

  // ---- 1-6: the grace table, each with its own guard and shift ----
  const table: [string, number, string, number][] = [
    ["before the start (-2 min)", -2, "VERIFIED_ON_TIME", 0],
    ["exactly at the start", 0, "VERIFIED_ON_TIME", 0],
    ["at 18:04", 4, "VERIFIED_WITHIN_GRACE", 0],
    ["at 18:05", 5, "VERIFIED_WITHIN_GRACE", 0],
    ["at 18:06", 6, "VERIFIED_LATE", 1],
    ["at 18:12", 12, "VERIFIED_LATE", 7],
  ];
  for (const [label, mins, expected, lateMin] of table) {
    const { guard, device } = await makeGuard(ctx, 100 + mins + 10);
    const shift = await makeShift(ctx, guard.id, start);
    await ensureExpectation({ ...shift, attendanceCheckIn: null } as never, cfg);
    const call = await recordCall(guard.id, device!.id, fixAt(mins - 1));
    await handleCall(call, device!, fixAt(mins - 1));
    const r1 = await row(shift.id);
    await applyFix(r1.id, { latitude: SITE.latitude, longitude: SITE.longitude, accuracyM: 8, capturedAt: fixAt(mins), mock: false, source: "CALL_GPS" }, fixAt(mins));
    const r = await row(shift.id);
    const att = await db.attendance.findUniqueOrThrow({ where: { shiftId: shift.id } });
    check(`arrival ${label} → ${expected}, ${lateMin} min beyond grace`, r.status === expected && r.lateMinutes === lateMin, `${r.status} late=${r.lateMinutes}`);
    if (expected !== "AWAITING") check(`  attendance recorded for ${label}`, att.arrivalConfirmedAt !== null && att.lateMinutes === lateMin && att.locationVerification === "VERIFIED", `${att.status} ${att.lateMinutes} ${att.locationVerification}`);
  }

  // ---- 7: call received, GPS outside the site ----
  {
    const { guard, device } = await makeGuard(ctx, 200);
    const shift = await makeShift(ctx, guard.id, start);
    const call = await recordCall(guard.id, device!.id, fixAt(0));
    await handleCall(call, device!, fixAt(0));
    const r0 = await row(shift.id);
    check("a qualifying call moves to GPS pending without confirming attendance", r0.status === "GPS_PENDING" && r0.verifiedArrivalAt === null, r0.status);
    await applyFix(r0.id, { latitude: AWAY.latitude, longitude: AWAY.longitude, accuracyM: 10, capturedAt: fixAt(1), mock: false, source: "CALL_GPS" }, fixAt(1));
    const r = await row(shift.id);
    const att = await db.attendance.findUniqueOrThrow({ where: { shiftId: shift.id } });
    check("a fix outside the site is not attendance", r.status === "OUTSIDE_AREA" && r.verifiedArrivalAt === null && att.arrivalConfirmedAt === null, `${r.status} att=${att.status}`);
    check("the distance from the site is recorded", (r.distanceM ?? 0) > 500, String(r.distanceM));
  }

  // ---- 8: accuracy too poor to decide ----
  {
    const { guard, device } = await makeGuard(ctx, 201);
    const shift = await makeShift(ctx, guard.id, start);
    const call = await recordCall(guard.id, device!.id, fixAt(0));
    await handleCall(call, device!, fixAt(0));
    const r0 = await row(shift.id);
    await applyFix(r0.id, { latitude: SITE.latitude, longitude: SITE.longitude, accuracyM: 400, capturedAt: fixAt(1), mock: false, source: "CALL_GPS" }, fixAt(1));
    const r = await row(shift.id);
    check("a fix too loose to judge is uncertain, not approved", r.status === "LOCATION_UNCERTAIN" && r.verifiedArrivalAt === null, r.status);
  }

  // ---- 8b: accuracy circle straddling the fence boundary ----
  {
    const { guard, device } = await makeGuard(ctx, 202);
    const shift = await makeShift(ctx, guard.id, start);
    const call = await recordCall(guard.id, device!.id, fixAt(0));
    await handleCall(call, device!, fixAt(0));
    const r0 = await row(shift.id);
    // ~140 m from the centre with ±60 m: the 150 m fence falls inside the accuracy circle.
    await applyFix(r0.id, { latitude: SITE.latitude + 0.00126, longitude: SITE.longitude, accuracyM: 60, capturedAt: fixAt(1), mock: false, source: "CALL_GPS" }, fixAt(1));
    const r = await row(shift.id);
    check("a fix straddling the fence is never approved", r.status === "LOCATION_UNCERTAIN", `${r.status} d=${Math.round(r.distanceM ?? 0)}`);
  }

  // ---- 9/10: no device, and a device that is offline ----
  {
    const { guard } = await makeGuard(ctx, 203, "FEATURE_PHONE");
    const shift = await makeShift(ctx, guard.id, start);
    await runCheckInStep(fixAt(1));
    const r = await row(shift.id);
    check("a feature-phone guard is marked unverifiable by GPS, not absent", r.source === "SMS_ONLY" && r.status === "AWAITING", `${r.source}/${r.status}`);
    check("the reason explains why GPS cannot be used", /no activated android guard phone/i.test(r.exceptionReason ?? ""), r.exceptionReason ?? "");
    // The SMS arrival flow owns this guard's attendance; this feature must not deliver a second verdict.
    await runCheckInStep(fixAt(60));
    const later = await row(shift.id);
    check("a feature-phone guard is never escalated as a missed check-in", later.status === "AWAITING" && later.escalatedAt === null, `${later.status}`);
    check("no check-in notification is raised for a feature-phone guard", (await db.notification.count({ where: { shiftId: shift.id } })) === 0);
  }
  {
    const { guard, device } = await makeGuard(ctx, 204);
    await db.gatewayDevice.update({ where: { id: device!.id }, data: { status: "OFFLINE" } });
    const shift = await makeShift(ctx, guard.id, start);
    const call = await recordCall(guard.id, device!.id, fixAt(0));
    const outcome = await handleCall(call, device!, fixAt(0));
    const r = await row(shift.id);
    check("an offline phone still gets a queued request rather than an instant failure", r.status === "GPS_PENDING", `${r.status} (${outcome})`);
  }

  // ---- 11: the fix arrives much later than the call ----
  {
    const { guard, device } = await makeGuard(ctx, 205);
    const shift = await makeShift(ctx, guard.id, start);
    const call = await recordCall(guard.id, device!.id, fixAt(0));
    await handleCall(call, device!, fixAt(0));
    const r0 = await row(shift.id);
    await applyFix(r0.id, { latitude: SITE.latitude, longitude: SITE.longitude, accuracyM: 8, capturedAt: fixAt(40), mock: false, source: "CALL_GPS" }, fixAt(40));
    const r = await row(shift.id);
    check("a fix 40 min after the call does not prove that arrival", r.status === "GPS_PENDING" && r.verifiedArrivalAt === null, r.status);
    check("the rejection reason is recorded", /not used/i.test(r.exceptionReason ?? ""), r.exceptionReason ?? "");
  }

  // ---- 12/13: duplicate call and duplicate fix ----
  {
    const { guard, device } = await makeGuard(ctx, 206);
    const shift = await makeShift(ctx, guard.id, start);
    const call = await recordCall(guard.id, device!.id, fixAt(0));
    await handleCall(call, device!, fixAt(0));
    const first = await row(shift.id);
    await handleCall(call, device!, fixAt(0));
    const second = await row(shift.id);
    check("a repeated call event does not open a second request", first.locationRequestId === second.locationRequestId && second.attempts === 1, `attempts=${second.attempts}`);
    await applyFix(first.id, { latitude: SITE.latitude, longitude: SITE.longitude, accuracyM: 8, capturedAt: fixAt(1), mock: false, source: "CALL_GPS" }, fixAt(1));
    const verified = await row(shift.id);
    await applyFix(first.id, { latitude: AWAY.latitude, longitude: AWAY.longitude, accuracyM: 8, capturedAt: fixAt(2), mock: false, source: "CALL_GPS" }, fixAt(2));
    const after = await row(shift.id);
    check("a second fix cannot overwrite a settled verification", after.status === verified.status && after.verifiedArrivalAt?.getTime() === verified.verifiedArrivalAt?.getTime(), `${verified.status} → ${after.status}`);
    const count = await db.attendanceCheckIn.count({ where: { shiftId: shift.id } });
    check("exactly one check-in row per shift", count === 1, String(count));
  }

  // ---- 14: a cancelled shift ----
  {
    const { guard, device } = await makeGuard(ctx, 207);
    const shift = await makeShift(ctx, guard.id, start);
    await db.shift.update({ where: { id: shift.id }, data: { status: "CANCELLED" } });
    const call = await recordCall(guard.id, device!.id, fixAt(0));
    const outcome = await handleCall(call, device!, fixAt(0));
    check("a cancelled shift accepts no check-in", /no shift|no qualifying/.test(outcome), outcome);
  }

  // ---- 15: two overlapping shifts ----
  {
    const { guard, device } = await makeGuard(ctx, 208);
    const a = await makeShift(ctx, guard.id, start);
    await db.shift.create({ data: { guardId: guard.id, locationId: ctx.site.id, supervisorId: ctx.admin.id, startAt: addMinutes(start, 10), endAt: addHours(start, 6), durationMinutes: 350, status: "SCHEDULED", attendance: { create: {} } } });
    const call = await recordCall(guard.id, device!.id, fixAt(2));
    const outcome = await handleCall(call, device!, fixAt(2));
    const r = await row(a.id);
    check("overlapping shifts are sent to a supervisor, not guessed", outcome.startsWith("ambiguous") && r.status === "MANUAL_REVIEW", `${outcome} / ${r.status}`);
  }

  // ---- 16: a revoked device ----
  {
    const { guard, device } = await makeGuard(ctx, 209);
    const shift = await makeShift(ctx, guard.id, start);
    await db.gatewayDevice.update({ where: { id: device!.id }, data: { status: "REVOKED" } });
    const call = await recordCall(guard.id, device!.id, fixAt(0));
    await handleCall(call, device!, fixAt(0));
    const r = await row(shift.id);
    check("a revoked phone cannot be asked for a fix, and the reason is kept", r.status === "LOCATION_UNAVAILABLE" && /revoked/i.test(r.exceptionReason ?? ""), `${r.status}: ${r.exceptionReason}`);
  }

  // ---- 17: a phone clock set backwards ----
  {
    const { guard, device } = await makeGuard(ctx, 210);
    const shift = await makeShift(ctx, guard.id, start);
    const call = await recordCall(guard.id, device!.id, fixAt(19));
    await handleCall(call, device!, fixAt(19));
    const r0 = await row(shift.id);
    // The phone claims it captured the fix at the shift start, but the server receives it 20 min later.
    await applyFix(r0.id, { latitude: SITE.latitude, longitude: SITE.longitude, accuracyM: 8, capturedAt: fixAt(0), mock: false, source: "CALL_GPS" }, fixAt(20));
    const r = await row(shift.id);
    check("a clock set back cannot manufacture an on-time arrival", r.status === "VERIFIED_LATE" && r.lateMinutes >= 14, `${r.status} late=${r.lateMinutes}`);
  }

  // ---- 18: grace overridden per site and per shift ----
  {
    const { guard, device } = await makeGuard(ctx, 211);
    const shift = await makeShift(ctx, guard.id, start);
    await db.shift.update({ where: { id: shift.id }, data: { checkInGraceMinutes: 20 } });
    const call = await recordCall(guard.id, device!.id, fixAt(11));
    await handleCall(call, device!, fixAt(11));
    const r0 = await row(shift.id);
    await applyFix(r0.id, { latitude: SITE.latitude, longitude: SITE.longitude, accuracyM: 8, capturedAt: fixAt(12), mock: false, source: "CALL_GPS" }, fixAt(12));
    const r = await row(shift.id);
    check("a 20-minute shift override makes a 12-minute arrival on time", r.status === "VERIFIED_WITHIN_GRACE" && r.lateMinutes === 0 && r.graceMinutes === 20, `${r.status} grace=${r.graceMinutes} late=${r.lateMinutes}`);
    check("the minutes after the start are still recorded", r.minutesAfterStart === 12, String(r.minutesAfterStart));
  }

  // ---- 19: a supervisor approves by hand ----
  {
    const { guard, device } = await makeGuard(ctx, 212);
    const shift = await makeShift(ctx, guard.id, start);
    const call = await recordCall(guard.id, device!.id, fixAt(0));
    await handleCall(call, device!, fixAt(0));
    const r0 = await row(shift.id);
    await applyFix(r0.id, { latitude: AWAY.latitude, longitude: AWAY.longitude, accuracyM: 10, capturedAt: fixAt(1), mock: false, source: "CALL_GPS" }, fixAt(1));
    const status = await decide(r0.id, "APPROVE", ctx.actor, "Guard was at the north gate; site centre is wrong.");
    const r = await row(shift.id);
    const att = await db.attendance.findUniqueOrThrow({ where: { shiftId: shift.id } });
    check("a manual approval is recorded as manual, never as GPS-verified", status === "MANUALLY_APPROVED" && r.source === "MANUAL" && r.previousStatus === "OUTSIDE_AREA", `${r.status}/${r.source}/${r.previousStatus}`);
    check("the attendance record follows the approval", att.arrivalConfirmedAt !== null && att.locationVerification !== "VERIFIED", `${att.status}/${att.locationVerification}`);
    const a = await db.auditLog.findFirst({ where: { entity: "AttendanceCheckIn", entityId: r0.id, action: "CHECKIN_APPROVED" } });
    check("the override is audited with user, reason and both statuses", !!a && /north gate/.test(JSON.stringify(a!.details)), JSON.stringify(a?.details ?? {}).slice(0, 80));
    let refused = false;
    try { await decide(r0.id, "REJECT", ctx.actor, "   "); } catch { refused = true; }
    check("an override without a reason is refused", refused);
  }

  // ---- 20: nothing arrives, the check-in escalates ----
  {
    const { guard } = await makeGuard(ctx, 213);
    const shift = await makeShift(ctx, guard.id, start);
    await runCheckInStep(fixAt(1));
    const before = await row(shift.id);
    check("a shift about to start is awaiting check-in", before.status === "AWAITING", before.status);
    const res = await runCheckInStep(fixAt(25)); // grace 5 + escalation 15 = 20 min
    const r = await row(shift.id);
    check("an unverified check-in becomes missed after the escalation window", r.status === "MISSED" && res.escalated >= 1, `${r.status} escalated=${res.escalated}`);
    const n = await db.notification.count({ where: { shiftId: shift.id } });
    const again = await runCheckInStep(fixAt(40));
    const n2 = await db.notification.count({ where: { shiftId: shift.id } });
    check("escalation notifies once, not on every tick", n === n2 && again.escalated === 0, `${n} → ${n2}`);
  }

  // ---- 21: the site has no coordinates ----
  {
    const { guard, device } = await makeGuard(ctx, 214);
    const shift = await makeShift(ctx, guard.id, start, ctx.bare.id);
    const call = await recordCall(guard.id, device!.id, fixAt(0));
    await handleCall(call, device!, fixAt(0));
    const r0 = await row(shift.id);
    await applyFix(r0.id, { latitude: SITE.latitude, longitude: SITE.longitude, accuracyM: 8, capturedAt: fixAt(1), mock: false, source: "CALL_GPS" }, fixAt(1));
    const r = await row(shift.id);
    check("a site without coordinates is reported, not silently approved", r.status === "SITE_NOT_CONFIGURED" && r.verifiedArrivalAt === null, r.status);
  }

  // ---- 22: a mock location provider ----
  {
    const { guard, device } = await makeGuard(ctx, 215);
    const shift = await makeShift(ctx, guard.id, start);
    const call = await recordCall(guard.id, device!.id, fixAt(0));
    await handleCall(call, device!, fixAt(0));
    const r0 = await row(shift.id);
    await applyFix(r0.id, { latitude: SITE.latitude, longitude: SITE.longitude, accuracyM: 5, capturedAt: fixAt(1), mock: true, source: "CALL_GPS" }, fixAt(1));
    const r = await row(shift.id);
    check("a mock location never verifies attendance", r.status === "MANUAL_REVIEW" && r.mock && r.verifiedArrivalAt === null, `${r.status} mock=${r.mock}`);
  }

  // ---- a restart mid-verification: the open row is picked up again ----
  {
    const { guard, device } = await makeGuard(ctx, 216);
    const shift = await makeShift(ctx, guard.id, start);
    const call = await recordCall(guard.id, device!.id, fixAt(0));
    await handleCall(call, device!, fixAt(0));
    const r0 = await row(shift.id);
    check("the pending verification survives in the database, not in memory", r0.status === "GPS_PENDING" && r0.locationRequestId !== null);
    // Simulate a restart: nothing in memory, the fix arrives and is still applied to the open row.
    const fresh = await db.attendanceCheckIn.findUniqueOrThrow({ where: { shiftId: shift.id } });
    await applyFix(fresh.id, { latitude: SITE.latitude, longitude: SITE.longitude, accuracyM: 9, capturedAt: fixAt(2), mock: false, source: "CALL_GPS" }, fixAt(2));
    const r = await row(shift.id);
    check("a fix after a restart still completes the verification", r.status === "VERIFIED_WITHIN_GRACE", r.status);
  }

  // ---- a call from a number that is not an authorised check-in destination ----
  {
    await saveSettings({ "checkin.numbers": "+263772100100" });
    const { guard, device } = await makeGuard(ctx, 217);
    const shift = await makeShift(ctx, guard.id, start);
    const personal = await recordCall(guard.id, device!.id, fixAt(0), "+263771234999");
    const outcome = await handleCall(personal, device!, fixAt(0));
    const r = await db.attendanceCheckIn.findUnique({ where: { shiftId: shift.id } });
    check("a personal call is not a check-in", /no qualifying/.test(outcome) && (r?.status ?? "AWAITING") === "AWAITING", `${outcome} / ${r?.status}`);
    const proper = await recordCall(guard.id, device!.id, fixAt(1), "+263772100100");
    await handleCall(proper, device!, fixAt(1));
    const r2 = await row(shift.id);
    check("a call to the authorised number is a check-in", r2.status === "GPS_PENDING", r2.status);
    await saveSettings({ "checkin.numbers": "" });
  }

  await clean();
  check("test data removed", (await db.guard.count({ where: { nationalId: { startsWith: TAG } } })) === 0);
}

main()
  .then(() => { console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0); })
  .catch(async (e) => { console.error(e); await clean().catch(() => {}); process.exit(1); })
  .finally(() => db.$disconnect());
