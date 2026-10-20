/**
 * GPS / geofence / guard-device scenario (spec section 50) plus the 15 critical cases, over real HTTP.
 * Tagged data: client ABC-E2E, site "Silverpeak Mine (E2E)", guards G-E2E01 (Android) and G-E2E02 (feature phone),
 * devices "E2E …". Everything is removed at the end. Needs: npm run dev with SMS_PROVIDER=simulated.
 *
 *   ALLOW_LIVE_DB=1 npx tsx scripts/dev/location-e2e.ts
 */
process.env.SMS_PROVIDER = process.env.SMS_PROVIDER || "simulated";
import { config } from "dotenv"; config();
const dbUrl = process.env.DATABASE_URL ?? "";
if (!/localhost|127\.0\.0\.1/.test(dbUrl) && process.env.ALLOW_LIVE_DB !== "1") { console.error("Refusing to run against a non-local DATABASE_URL. Set ALLOW_LIVE_DB=1 only for a database that holds no real data."); process.exit(2); }
import { addHours, subMinutes } from "date-fns";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { processIncomingMessage } from "../../src/lib/sms/pipeline";
import { runAutomationTick } from "../../src/lib/automation/engine";
import { createGateway, revokeGateway, gatewayMaintenance } from "../../src/lib/gateway/service";
import { locationMaintenance } from "../../src/lib/gateway/location-events";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const SITE = { latitude: -17.8292, longitude: 31.0522, radius: 150 };
const GUARD_PHONE = "+263779900771"; // numbers no seed uses
const PETER_PHONE = "+263779900772";
const OPS_PHONE = "+263772100100";
let passed = 0, failed = 0;
const check = (name: string, ok: boolean, detail = "") => { if (ok) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name} ${detail}`); } };
const post = async (path: string, body: unknown, token?: string) => { const r = await fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }); return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, any> }; };
const get = async (path: string, token: string) => { const r = await fetch(`${BASE}${path}`, { headers: { authorization: `Bearer ${token}` } }); return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, any> }; };
const offset = (m: number) => m / 111_000; // metres north → degrees latitude
const fix = (m: number, acc = 12) => ({ latitude: SITE.latitude + offset(m), longitude: SITE.longitude, accuracyM: acc, distanceM: m, locationState: m + acc <= SITE.radius ? "INSIDE" : m - acc > SITE.radius ? "OUTSIDE" : "UNKNOWN", provider: "gps" });
const T = (hhmm: string, dayOffset = 0) => { const d = new Date(); d.setHours(Number(hhmm.slice(0, 2)), Number(hhmm.slice(3)), 0, 0); d.setDate(d.getDate() + dayOffset); return d; };

async function cleanup() {
  const guards = await db.guard.findMany({ where: { guardNo: { in: ["G-E2E01", "G-E2E02"] } }, select: { id: true } });
  const gIds = guards.map((g) => g.id);
  const shifts = await db.shift.findMany({ where: { guardId: { in: gIds } }, select: { id: true } });
  const sIds = shifts.map((s) => s.id);
  const gws = await db.gatewayDevice.findMany({ where: { deviceName: { startsWith: "E2E " } }, select: { id: true } });
  const gwIds = gws.map((g) => g.id);
  const clients = await db.client.findMany({ where: { code: "ABC-E2E" }, select: { id: true } });
  await db.$transaction([
    db.notification.deleteMany({ where: { OR: [{ guardId: { in: gIds } }, { shiftId: { in: sIds } }, { title: { contains: "E2E " } }] } }),
    db.locationEvent.deleteMany({ where: { OR: [{ gatewayDeviceId: { in: gwIds } }, { shiftId: { in: sIds } }] } }),
    db.shiftCheckIn.deleteMany({ where: { shiftId: { in: sIds } } }), db.welfareCheck.deleteMany({ where: { shiftId: { in: sIds } } }),
    db.incident.deleteMany({ where: { guardId: { in: gIds } } }), db.smsMessage.deleteMany({ where: { guardId: { in: gIds } } }),
    db.callLog.deleteMany({ where: { gatewayDeviceId: { in: gwIds } } }), db.gatewayEvent.deleteMany({ where: { gatewayDeviceId: { in: gwIds } } }),
    db.attendance.deleteMany({ where: { shiftId: { in: sIds } } }), db.shift.deleteMany({ where: { id: { in: sIds } } }),
    db.gatewayDevice.deleteMany({ where: { id: { in: gwIds } } }),
    db.guard.deleteMany({ where: { id: { in: gIds } } }), db.location.deleteMany({ where: { code: "ABC-E2E-01" } }), db.client.deleteMany({ where: { id: { in: clients.map((c) => c.id) } } }),
    db.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [...gwIds, ...gIds, ...sIds] } }, { action: { in: ["SMS_SENT", "SMS_FAILED"] }, details: { path: ["to"], equals: GUARD_PHONE } }] } }),
  ]);
}

async function main() {
  if ((await fetch(`${BASE}/api/health`).then((r) => r.status).catch(() => 0)) !== 200) throw new Error(`Server at ${BASE} not reachable. Start it with npm run dev.`);
  await cleanup();
  const admin = await db.user.findFirstOrThrow({ where: { role: "SUPER_ADMIN" } });
  const actor = { userId: admin.id, name: admin.name };
  console.log("Setup: client, site with geofence, Android guard John, feature-phone guard Peter, guard device, operations gateway");
  const client = await db.client.create({ data: { code: "ABC-E2E", name: "ABC Security Client (E2E)", contactPhone: "+263242000111" } });
  const site = await db.location.create({ data: { code: "ABC-E2E-01", name: "Silverpeak Mine (E2E)", clientId: client.id, address: "Silverpeak", supervisorId: admin.id, latitude: SITE.latitude, longitude: SITE.longitude, geofenceRadiusM: SITE.radius } });
  const john = await db.guard.create({ data: { guardNo: "G-E2E01", firstName: "John", lastName: "Moyo", phone: GUARD_PHONE, nationalId: "E2E-63-1", dateEmployed: new Date(), homeLocationId: site.id } });
  const peter = await db.guard.create({ data: { guardNo: "G-E2E02", firstName: "Peter", lastName: "Ncube", phone: PETER_PHONE, nationalId: "E2E-63-2", dateEmployed: new Date(), homeLocationId: site.id } });
  const guardDev = await createGateway({ deviceName: "E2E John's phone", phoneNumber: GUARD_PHONE, mode: "GUARD", guardId: john.id, actor });
  const opsDev = await createGateway({ deviceName: "E2E Control Room 01", phoneNumber: OPS_PHONE, locationId: site.id, actor });
  try {
    // ── registration
    console.log("Registration and configuration");
    const a1 = await post("/api/gateways/activate", { activationCode: guardDev.activationCode, appVersion: "1.1.0", androidVersion: "13", locationPermission: "background", callPermission: "granted" });
    check("guard device activates with mode GUARD and guard name", a1.status === 200 && a1.json.mode === "GUARD" && a1.json.guard?.name === "John Moyo", JSON.stringify(a1.json));
    const gt = a1.json.deviceToken as string;
    const a2 = await post("/api/gateways/activate", { activationCode: opsDev.activationCode, appVersion: "1.1.0" });
    const ot = a2.json.deviceToken as string;
    check("operations gateway activates", a2.status === 200 && a2.json.mode === "OPERATIONS_GATEWAY");
    const johnAfter = await db.guard.findUniqueOrThrow({ where: { id: john.id } });
    check("John is now an ANDROID_GUARD; Peter stays FEATURE_PHONE", johnAfter.deviceKind === "ANDROID_GUARD" && (await db.guard.findUniqueOrThrow({ where: { id: peter.id } })).deviceKind === "FEATURE_PHONE");
    const now = new Date();
    const shift = await db.shift.create({ data: { guardId: john.id, locationId: site.id, supervisorId: admin.id, startAt: subMinutes(now, 2), endAt: addHours(now, 12), durationMinutes: 722, status: "SCHEDULED", attendance: { create: { status: "PENDING" } } } });
    const peterShift = await db.shift.create({ data: { guardId: peter.id, locationId: site.id, supervisorId: admin.id, startAt: subMinutes(now, 2), endAt: addHours(now, 12), durationMinutes: 722, status: "SCHEDULED", attendance: { create: { status: "PENDING" } } } });
    const cfg = await get("/api/gateways/config", gt);
    check("device config carries the shift, site coordinates, radius and policy", cfg.status === 200 && cfg.json.shift?.id === shift.id && cfg.json.shift.site.radiusM === 150 && cfg.json.shift.site.hasCoordinates && cfg.json.config.geofence.checkMinutes === 10, JSON.stringify(cfg.json).slice(0, 200));
    const hb = await post("/api/gateways/heartbeat", { batteryLevel: 80, networkType: "mobile", locationPermission: "background", callPermission: "granted", monitoringState: "WAITING_FOR_SHIFT" }, gt);
    check("heartbeat stores permissions and monitoring state", hb.status === 200 && (await db.gatewayDevice.findUniqueOrThrow({ where: { id: guardDev.id } })).locationPermission === "background");

    // ── 18:00 existing SMS + GPS inside → ARRIVAL VERIFIED (Test 13, Test 15)
    console.log("18:00–18:05 SMS arrival + GPS inside");
    await runAutomationTick(new Date());
    check("existing engine sent arrival SMS to both guards", (await db.smsMessage.count({ where: { type: "ARRIVAL", direction: "OUTBOUND", shiftId: { in: [shift.id, peterShift.id] } } })) === 2);
    const yes = await processIncomingMessage({ from: GUARD_PHONE, body: "YES", provider: "simulated" });
    check("YES handled by the existing pipeline (attendance CONFIRMED)", yes.interpreted === "YES" && (await db.attendance.findUniqueOrThrow({ where: { shiftId: shift.id } })).status === "PRESENT");
    const ev = (eventType: string, f: Record<string, unknown>, at: Date, extra: Record<string, unknown> = {}) => ({ eventId: `e2e-${randomUUID()}`, eventType, timestamp: at.toISOString(), shiftId: shift.id, siteId: site.id, geofenceRadiusM: SITE.radius, ...f, ...extra });
    const r1 = await post("/api/gateways/events", { events: [ev("SHIFT_STARTED", fix(20), new Date())] }, gt);
    check("SHIFT_STARTED inside accepted and classified INSIDE by the server", r1.json.acks?.[0]?.status === "ok" && (await db.locationEvent.findFirst({ where: { shiftId: shift.id, eventType: "SHIFT_STARTED" } }))?.locationState === "INSIDE", JSON.stringify(r1.json));
    let att = await db.attendance.findUniqueOrThrow({ where: { shiftId: shift.id } });
    check("ARRIVAL VERIFIED: SMS yes + GPS inside (Test 1, 13)", att.locationVerification === "VERIFIED", att.locationVerification);
    check("verification is on the shift timeline", Boolean(await db.shiftCheckIn.findFirst({ where: { shiftId: shift.id, type: "LOCATION_VERIFIED" } })));
    // periodic inside checks (no alerts)
    await post("/api/gateways/events", { events: [ev("LOCATION_CHECK", fix(25), new Date()), ev("LOCATION_CHECK", fix(18), new Date())] }, gt);
    check("inside checks stored as events, no alert", (await db.locationEvent.count({ where: { shiftId: shift.id, eventType: "LOCATION_CHECK" } })) === 2 && (await db.notification.count({ where: { shiftId: shift.id, type: { startsWith: "LOCATION_" } } })) === 0);

    // ── 22:15 exit with internet (Test 2)
    console.log("22:15 exit (online)");
    const exitAt = new Date();
    const rExit = await post("/api/gateways/events", { events: [ev("LOCATION_EXIT", fix(435), exitAt)] }, gt);
    const exitRow = await db.locationEvent.findFirst({ where: { shiftId: shift.id, eventType: "LOCATION_EXIT" } });
    check("LOCATION_EXIT stored OUTSIDE, distance recomputed ≈435 m, LIVE", rExit.status === 200 && exitRow?.locationState === "OUTSIDE" && Math.abs((exitRow.distanceM ?? 0) - 435) < 3 && exitRow.syncStatus === "LIVE", `${exitRow?.distanceM} ${exitRow?.syncStatus}`);
    const exitAlert = await db.notification.findFirst({ where: { type: "LOCATION_EXIT", shiftId: shift.id } });
    check("immediate exit alert (warning, neutral wording)", exitAlert?.severity === "WARNING" && /outside/.test(exitAlert.title));
    check("exit on the shift timeline", Boolean(await db.shiftCheckIn.findFirst({ where: { shiftId: shift.id, type: "LOCATION_EXIT" } })));

    // ── 22:17 operations calls guard; guard phone reports incoming call with location (Test 10, correlation)
    console.log("22:17 operations calls the guard");
    const callAt = new Date();
    const opsCall = `e2e-ops-${randomUUID()}`, guardCall = `e2e-g-${randomUUID()}`;
    await post("/api/gateways/events", { events: [{ eventId: `${opsCall}-1`, eventType: "CALL_STARTED", callId: opsCall, phoneNumber: GUARD_PHONE, direction: "OUTGOING", timestamp: callAt.toISOString() }] }, ot);
    await post("/api/gateways/events", { events: [{ eventId: `${guardCall}-1`, eventType: "CALL_STARTED", callId: guardCall, phoneNumber: OPS_PHONE, direction: "INCOMING", timestamp: new Date(callAt.getTime() + 1000).toISOString(), location: { latitude: SITE.latitude + offset(440), longitude: SITE.longitude, locationState: "OUTSIDE" } }, ev("LOCATION_CALL", fix(440), new Date(callAt.getTime() + 2000))] }, gt);
    const gCall = await db.callLog.findUniqueOrThrow({ where: { gatewayDeviceId_callId: { gatewayDeviceId: guardDev.id, callId: guardCall } } });
    const oCall = await db.callLog.findUniqueOrThrow({ where: { gatewayDeviceId_callId: { gatewayDeviceId: opsDev.id, callId: opsCall } } });
    check("guard-phone call is attributed to John with location OUTSIDE", gCall.guardId === john.id && gCall.locationState === "OUTSIDE" && gCall.shiftId === shift.id);
    check("operations call is attributed to John too", oCall.guardId === john.id);
    check("the two calls are correlated both ways", gCall.correlatedCallId === oCall.id && oCall.correlatedCallId === gCall.id, `${gCall.correlatedCallId} ${oCall.correlatedCallId}`);
    check("call-time location stored as LOCATION_CALL", Boolean(await db.locationEvent.findFirst({ where: { shiftId: shift.id, eventType: "LOCATION_CALL" } })));
    // guard calls operations (Test 11)
    const gc2 = `e2e-g2-${randomUUID()}`, oc2 = `e2e-o2-${randomUUID()}`;
    await post("/api/gateways/events", { events: [{ eventId: `${gc2}-1`, eventType: "CALL_STARTED", callId: gc2, phoneNumber: OPS_PHONE, direction: "OUTGOING", timestamp: new Date().toISOString(), location: { latitude: SITE.latitude + offset(440), longitude: SITE.longitude, locationState: "OUTSIDE" } }] }, gt);
    await post("/api/gateways/events", { events: [{ eventId: `${oc2}-1`, eventType: "CALL_STARTED", callId: oc2, phoneNumber: GUARD_PHONE, direction: "INCOMING", timestamp: new Date().toISOString() }, { eventId: `${oc2}-2`, eventType: "CALL_ANSWERED", callId: oc2, timestamp: new Date().toISOString() }, { eventId: `${oc2}-3`, eventType: "CALL_ENDED", callId: oc2, timestamp: new Date(Date.now() + 60000).toISOString(), durationSeconds: 60, answered: true }] }, ot);
    const o2 = await db.callLog.findUniqueOrThrow({ where: { gatewayDeviceId_callId: { gatewayDeviceId: opsDev.id, callId: oc2 } } });
    check("guard calls operations: incoming call on the gateway answered and correlated (Test 11)", o2.status === "ENDED" && o2.correlatedCallId != null && o2.guardId === john.id);

    // ── 22:25 outside update, 23:05 return, uploaded late (Tests 4, 5, 6)
    console.log("22:25–23:40 offline: outside update and return synced late");
    const late = (m: number) => new Date(Date.now() - m * 60000);
    const rLate = await post("/api/gateways/events", { events: [ev("LOCATION_RETURNED", fix(38), late(35), { durationOutsideSeconds: 50 * 60 }), ev("LOCATION_OUTSIDE", fix(480), late(75))] }, gt);
    const outside = await db.locationEvent.findFirst({ where: { shiftId: shift.id, eventType: "LOCATION_OUTSIDE" } });
    const ret = await db.locationEvent.findFirst({ where: { shiftId: shift.id, eventType: "LOCATION_RETURNED" } });
    check("out-of-order late batch accepted", rLate.status === 200 && rLate.json.acks.every((a: any) => a.status === "ok"));
    check("LOCATION_OUTSIDE kept its original timestamp and is SYNCED_LATE", outside?.syncStatus === "SYNCED_LATE" && Math.abs(outside.occurredAt.getTime() - late(75).getTime()) < 5000);
    check("LOCATION_RETURNED synced late with 50 min outside", ret?.syncStatus === "SYNCED_LATE" && ret.durationOutsideSeconds === 3000 && ret.locationState === "INSIDE");
    check("return alert raised", Boolean(await db.notification.findFirst({ where: { type: "LOCATION_RETURNED", shiftId: shift.id } })));
    check("no duplicate when the batch is replayed", (await post("/api/gateways/events", { events: [{ ...ev("LOCATION_OUTSIDE", fix(480), late(75)), eventId: rLate.json.acks[1].eventId }] }, gt)).json.acks?.[0]?.status === "duplicate");

    // ── Test 7/8: GPS unavailable and permission revoked are UNKNOWN, never OUTSIDE
    console.log("Location unavailable");
    await post("/api/gateways/events", { events: [ev("LOCATION_UNAVAILABLE", { locationState: "UNKNOWN", reason: "no_fix" }, new Date()), ev("LOCATION_UNAVAILABLE", { locationState: "UNKNOWN", reason: "permission_revoked" }, new Date())] }, gt);
    const unav = await db.locationEvent.findMany({ where: { shiftId: shift.id, eventType: "LOCATION_UNAVAILABLE" } });
    check("unavailable events stored as UNKNOWN with reasons (Tests 7, 8)", unav.length === 2 && unav.every((u) => u.locationState === "UNKNOWN") && unav.some((u) => u.reason === "permission_revoked"));
    check("one unavailable alert per hour, not per event", (await db.notification.count({ where: { type: "LOCATION_UNAVAILABLE", shiftId: shift.id } })) === 1);
    // poor accuracy is UNKNOWN even when the centre is far away
    await post("/api/gateways/events", { events: [ev("LOCATION_CHECK", { ...fix(420, 250), locationState: "OUTSIDE" }, new Date())] }, gt);
    const poor = await db.locationEvent.findFirst({ where: { shiftId: shift.id, accuracyM: 250 } });
    check("server re-classifies a ±250 m fix as UNKNOWN (poor accuracy), ignoring the phone's verdict", poor?.locationState === "UNKNOWN" && poor.reason === "poor_accuracy");

    // ── Test 9: device powered off → DEVICE OFFLINE, not guard left site
    console.log("Device powered off");
    await db.gatewayDevice.update({ where: { id: guardDev.id }, data: { lastSeenAt: subMinutes(new Date(), 30) } });
    await gatewayMaintenance(new Date());
    check("silent guard phone → DEVICE_OFFLINE alert, wording says it is not an exit", Boolean(await db.notification.findFirst({ where: { type: "DEVICE_OFFLINE", guardId: john.id, body: { contains: "does not mean" } } })));
    check("no LOCATION_EXIT was created by the offline device", (await db.locationEvent.count({ where: { shiftId: shift.id, eventType: "LOCATION_EXIT" } })) === 1);
    // overdue: device online but silent on location
    await post("/api/gateways/heartbeat", { batteryLevel: 70 }, gt);
    await db.locationEvent.updateMany({ where: { shiftId: shift.id }, data: { occurredAt: subMinutes(new Date(), 45) } });
    const lm = await locationMaintenance(new Date());
    check("online phone with no checks for 2 intervals → LOCATION_VERIFICATION_OVERDUE once", lm.overdue === 1 && (await locationMaintenance(new Date())).overdue === 0);

    // ── Test 14: SMS yes + GPS outside → LOCATION EXCEPTION (second Android shift)
    console.log("SMS yes + GPS outside");
    await db.shift.update({ where: { id: shift.id }, data: { status: "COMPLETED", pendingPrompt: "NONE" } });
    const shift2 = await db.shift.create({ data: { guardId: john.id, locationId: site.id, supervisorId: admin.id, startAt: subMinutes(new Date(), 1), endAt: addHours(new Date(), 8), durationMinutes: 481, status: "AWAITING_ARRIVAL", pendingPrompt: "ARRIVAL", arrivalSmsSentAt: new Date(), attendance: { create: { status: "PENDING" } } } });
    await post("/api/gateways/events", { events: [{ ...ev("SHIFT_STARTED", fix(300), new Date()), shiftId: shift2.id }] }, gt);
    await processIncomingMessage({ from: GUARD_PHONE, body: "YES", provider: "simulated" });
    att = await db.attendance.findUniqueOrThrow({ where: { shiftId: shift2.id } });
    check("LOCATION EXCEPTION: SMS yes but GPS outside (Test 14), attendance still PRESENT", att.locationVerification === "EXCEPTION" && att.status === "PRESENT", att.locationVerification);
    check("exception alert uses neutral wording", Boolean(await db.notification.findFirst({ where: { type: "LOCATION_EXCEPTION", shiftId: shift2.id, title: { contains: "Location exception" } } })));

    // ── Test 12: feature-phone guard unaffected
    console.log("Feature-phone guard");
    await processIncomingMessage({ from: PETER_PHONE, body: "YES", provider: "simulated" });
    const pAtt = await db.attendance.findUniqueOrThrow({ where: { shiftId: peterShift.id } });
    check("Peter (feature phone): attendance PRESENT, location NOT_APPLICABLE, no location alerts (Test 12)", pAtt.status === "PRESENT" && pAtt.locationVerification === "NOT_APPLICABLE" && (await db.notification.count({ where: { guardId: peter.id, type: { startsWith: "LOCATION" } } })) === 0);

    // ── mock location → integrity warning, not fraud
    await post("/api/gateways/events", { events: [{ ...ev("LOCATION_CHECK", fix(10), new Date()), shiftId: shift2.id, mock: true }] }, gt);
    const mockNotif = Boolean(await db.notification.findFirst({ where: { type: "LOCATION_INTEGRITY", guardId: john.id } }));
    const mockSeen = (await db.gatewayDevice.findUniqueOrThrow({ where: { id: guardDev.id } })).mockLocationSeen;
    check("mock provider → LOCATION INTEGRITY WARNING on the device, no accusation", mockNotif && mockSeen, `notification=${mockNotif} mockLocationSeen=${mockSeen}`);

    // ── revocation
    await revokeGateway(guardDev.id, actor, "e2e");
    check("revoked guard device cannot post location events", [401, 403].includes((await post("/api/gateways/events", { events: [ev("LOCATION_CHECK", fix(10), new Date())] }, gt)).status));
    check("John returns to FEATURE_PHONE after revocation", (await db.guard.findUniqueOrThrow({ where: { id: john.id } })).deviceKind === "FEATURE_PHONE");

    // ── Test 15: SMS still works
    console.log("Existing SMS still works");
    await db.shift.update({ where: { id: peterShift.id }, data: { pendingPrompt: "WELFARE", welfareSmsSentAt: new Date() } });
    await db.welfareCheck.create({ data: { shiftId: peterShift.id, sentAt: new Date(), response: "PENDING" } });
    const w = await processIncomingMessage({ from: PETER_PHONE, body: "1", provider: "simulated" }); // the suite's own feature-phone guard, never a demo-seed number
    check("welfare reply processed by the existing pipeline (Test 15)", w.interpreted === "WELL");
    check("outbound SMS rows intact", (await db.smsMessage.count({ where: { direction: "OUTBOUND", status: "SENT", shiftId: { in: [shift.id, peterShift.id] } } })) >= 3);
  } finally {
    await cleanup();
    console.log(`\n${passed} passed, ${failed} failed · test data removed`);
    if (failed) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
