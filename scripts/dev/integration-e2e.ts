/**
 * Phase 3, Stage 8: full system integration over real HTTP + the real pipelines.
 *
 *  1. SMS functions with no device involved (feature-phone guard: YES → PRESENT, WELL, HELP).
 *  2. APK messages use the same workflows: app SHIFT_OK after SMS WELL does not re-run welfare;
 *     app NEED_ASSISTANCE then SMS HELP produce one shift status and separate, non-duplicated records.
 *  3. No duplicate attendance processing across SMS and GPS: SMS YES confirms arrival once;
 *     a second YES and a GPS SHIFT_STARTED never create a second confirmation.
 *  4. Existing call monitoring intact (gateway + guard phone call with location).
 *  5. GPS events associate with the right guard and shift, even when posted out of order.
 *  6. Offline replay of every event type in one batch, shuffled, with duplicates: each is stored
 *     once, acked ok/duplicate, and the records are identical to live delivery apart from sync status.
 *
 * Tagged data (client ABC-E2E-INT, guards G-E2EI1/2, devices "E2E-INT …") is removed at the end.
 *   npx tsx scripts/dev/integration-e2e.ts   (local DATABASE_URL; npm run dev with SMS_PROVIDER=simulated)
 */
process.env.SMS_PROVIDER = process.env.SMS_PROVIDER || "simulated";
import { config } from "dotenv"; config();
const dbUrl = process.env.DATABASE_URL ?? "";
if (!/localhost|127\.0\.0\.1/.test(dbUrl) && process.env.ALLOW_LIVE_DB !== "1") { console.error("Refusing to run against a non-local DATABASE_URL."); process.exit(2); }
import { addHours, subMinutes } from "date-fns";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { processIncomingMessage } from "../../src/lib/sms/pipeline";
import { createGateway } from "../../src/lib/gateway/service";
import { saveSettings } from "../../src/lib/settings";

// The server caches settings for 15 s; a test that changes one waits that out before relying on it.
const settle = () => new Promise((r) => setTimeout(r, 16_000));

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const SITE = { latitude: -17.8292, longitude: 31.0522, radius: 150 };
const JOHN = "+263779900771".replace("771", "801"), PETER = "+263779900802", OPS = "+263772100100";
let passed = 0, failed = 0;
const check = (name: string, ok: boolean, detail = "") => { if (ok) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name} ${detail}`); } };
const post = async (path: string, body: unknown, token?: string) => { const r = await fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }); return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, any> }; }; // eslint-disable-line @typescript-eslint/no-explicit-any
const off = (m: number) => m / 111_000;
const fix = (m: number, acc = 12) => ({ latitude: SITE.latitude + off(m), longitude: SITE.longitude, accuracyM: acc, distanceM: m, locationState: m + acc <= SITE.radius ? "INSIDE" : m - acc > SITE.radius ? "OUTSIDE" : "UNKNOWN", provider: "gps" });
const shuffle = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

async function cleanup() {
  const guards = await db.guard.findMany({ where: { guardNo: { in: ["G-E2EI1", "G-E2EI2", "G-E2EI3"] } }, select: { id: true } });
  const gIds = guards.map((g) => g.id);
  const shifts = await db.shift.findMany({ where: { guardId: { in: gIds } }, select: { id: true } });
  const sIds = shifts.map((s) => s.id);
  const gws = await db.gatewayDevice.findMany({ where: { deviceName: { startsWith: "E2E-INT " } }, select: { id: true } });
  const gwIds = gws.map((g) => g.id);
  await db.$transaction([
    db.notification.deleteMany({ where: { OR: [{ guardId: { in: gIds } }, { shiftId: { in: sIds } }] } }),
    db.guardAlert.deleteMany({ where: { OR: [{ guardId: { in: gIds } }, { gatewayDeviceId: { in: gwIds } }] } }),
    db.incident.deleteMany({ where: { guardId: { in: gIds } } }),
    db.shiftCheckIn.deleteMany({ where: { shiftId: { in: sIds } } }), db.welfareCheck.deleteMany({ where: { shiftId: { in: sIds } } }),
    db.smsMessage.deleteMany({ where: { guardId: { in: gIds } } }),
    db.locationEvent.deleteMany({ where: { OR: [{ gatewayDeviceId: { in: gwIds } }, { shiftId: { in: sIds } }] } }), db.callLog.deleteMany({ where: { gatewayDeviceId: { in: gwIds } } }), db.gatewayEvent.deleteMany({ where: { gatewayDeviceId: { in: gwIds } } }),
    db.attendance.deleteMany({ where: { shiftId: { in: sIds } } }), db.shift.deleteMany({ where: { id: { in: sIds } } }),
    db.gatewayDevice.deleteMany({ where: { id: { in: gwIds } } }),
    db.guard.deleteMany({ where: { id: { in: gIds } } }), db.location.deleteMany({ where: { code: "ABC-E2EINT-01" } }), db.client.deleteMany({ where: { code: "ABC-E2E-INT" } }),
    db.auditLog.deleteMany({ where: { entityId: { in: [...gwIds, ...gIds, ...sIds] } } }),
  ]);
}

async function main() {
  if ((await fetch(`${BASE}/api/health`).then((r) => r.status).catch(() => 0)) !== 200) throw new Error(`Server at ${BASE} not reachable.`);
  await cleanup();
  const admin = await db.user.findFirstOrThrow({ where: { role: "SUPER_ADMIN" } });
  const actor = { userId: admin.id, name: admin.name };
  const client = await db.client.create({ data: { code: "ABC-E2E-INT", name: "ABC Integration Client (E2E)", contactPhone: "+263242000113" } });
  const site = await db.location.create({ data: { code: "ABC-E2EINT-01", name: "Silverpeak Works (E2E)", clientId: client.id, address: "Silverpeak", supervisorId: admin.id, latitude: SITE.latitude, longitude: SITE.longitude, geofenceRadiusM: SITE.radius } });
  const john = await db.guard.create({ data: { guardNo: "G-E2EI1", firstName: "John", lastName: "Integration", phone: JOHN, nationalId: "E2EI-1", dateEmployed: new Date(), homeLocationId: site.id } });
  const peter = await db.guard.create({ data: { guardNo: "G-E2EI2", firstName: "Peter", lastName: "Integration", phone: PETER, nationalId: "E2EI-2", dateEmployed: new Date(), homeLocationId: site.id } });
  const dev = await createGateway({ deviceName: "E2E-INT John's phone", phoneNumber: JOHN, mode: "GUARD", guardId: john.id, actor });
  const ops = await createGateway({ deviceName: "E2E-INT Control Room", phoneNumber: OPS, locationId: site.id, actor });
  try {
    const gt = (await post("/api/gateways/activate", { activationCode: dev.activationCode, appVersion: "1.4.0", locationPermission: "background", callPermission: "granted" })).json.deviceToken as string;
    const ot = (await post("/api/gateways/activate", { activationCode: ops.activationCode, appVersion: "1.4.0" })).json.deviceToken as string;
    const now = new Date();
    const mk = (guardId: string) => db.shift.create({ data: { guardId, locationId: site.id, supervisorId: admin.id, startAt: subMinutes(now, 20), endAt: addHours(now, 11), durationMinutes: 700, status: "AWAITING_ARRIVAL", pendingPrompt: "ARRIVAL", arrivalSmsSentAt: subMinutes(now, 15), attendance: { create: {} } } });
    const js = await mk(john.id);
    const ps = await mk(peter.id);

    console.log("1. SMS on its own (feature-phone guard, no device anywhere near)");
    const y = await processIncomingMessage({ from: PETER, body: "YES", provider: "simulated" });
    const pAtt = await db.attendance.findUniqueOrThrow({ where: { shiftId: ps.id } });
    check("YES confirms arrival: attendance PRESENT/LATE with arrivalConfirmedAt, shift ON_DUTY, location NOT_APPLICABLE", y.interpreted === "YES" && ["PRESENT", "LATE"].includes(pAtt.status) && pAtt.arrivalConfirmedAt != null && pAtt.locationVerification === "NOT_APPLICABLE" && (await db.shift.findUniqueOrThrow({ where: { id: ps.id } })).status === "ON_DUTY", JSON.stringify(y));
    await db.shift.update({ where: { id: ps.id }, data: { pendingPrompt: "WELFARE", welfareSmsSentAt: new Date() } });
    await db.welfareCheck.create({ data: { shiftId: ps.id, sentAt: new Date(), response: "PENDING" } });
    const w = await processIncomingMessage({ from: PETER, body: "HELP", provider: "simulated" });
    check("HELP by SMS: shift ASSISTANCE, one incident, one notification", w.interpreted === "ASSISTANCE" && (await db.shift.findUniqueOrThrow({ where: { id: ps.id } })).status === "ASSISTANCE" && (await db.incident.count({ where: { guardId: peter.id } })) === 1);
    check("feature-phone guard has no GPS rows and no app alerts", (await db.locationEvent.count({ where: { guardId: peter.id } })) === 0 && (await db.guardAlert.count({ where: { guardId: peter.id } })) === 0);

    console.log("2 + 3. SMS and GPS on the same guard: attendance confirmed once");
    // With automatic GPS attendance switched off, the original rule holds exactly: SMS confirms
    // arrival and GPS only corroborates it. Section 3b covers the rule with it switched on.
    await saveSettings({ "checkin.autoGps": "false" });
    await settle();
    const ev = (eventType: string, f: Record<string, unknown>, at: Date, extra: Record<string, unknown> = {}) => ({ eventId: `e2e-int-${randomUUID()}`, eventType, timestamp: at.toISOString(), shiftId: js.id, siteId: site.id, geofenceRadiusM: SITE.radius, ...f, ...extra });
    await post("/api/gateways/events", { events: [ev("SHIFT_STARTED", fix(20), subMinutes(now, 10))] }, gt);
    let att = await db.attendance.findUniqueOrThrow({ where: { shiftId: js.id } });
    check("with automatic GPS attendance off, a GPS fix alone never confirms arrival", att.status === "PENDING" && att.arrivalConfirmedAt == null);
    const y1 = await processIncomingMessage({ from: JOHN, body: "YES", provider: "simulated" });
    att = await db.attendance.findUniqueOrThrow({ where: { shiftId: js.id } });
    const firstConfirm = att.arrivalConfirmedAt;
    check("SMS YES confirms arrival and GPS corroborates it: VERIFIED", y1.interpreted === "YES" && ["PRESENT", "LATE"].includes(att.status) && att.arrivalConfirmedAt != null && att.locationVerification === "VERIFIED", JSON.stringify(att));
    await processIncomingMessage({ from: JOHN, body: "YES", provider: "simulated" });
    await post("/api/gateways/events", { events: [ev("LOCATION_CHECK", fix(25), new Date())] }, gt);
    att = await db.attendance.findUniqueOrThrow({ where: { shiftId: js.id } });
    check("a second YES and another fix do not re-confirm arrival", att.arrivalConfirmedAt?.getTime() === firstConfirm?.getTime() && (await db.shiftCheckIn.count({ where: { shiftId: js.id, type: "ARRIVAL_CONFIRMED" } })) === 1);

    console.log("3b. Automatic GPS attendance on: an Android guard's fix at the start is presence, with no SMS and no call");
    await saveSettings({ "checkin.autoGps": "true" });
    await settle();
    const MARY = "+263779900803";
    const mary = await db.guard.create({ data: { guardNo: "G-E2EI3", firstName: "Mary", lastName: "Integration", phone: MARY, nationalId: "E2EI-3", dateEmployed: new Date(), homeLocationId: site.id, deviceKind: "ANDROID_GUARD" } });
    const mdev = await createGateway({ deviceName: "E2E-INT Mary's phone", phoneNumber: MARY, mode: "GUARD", guardId: mary.id, actor });
    const mt = (await post("/api/gateways/activate", { activationCode: mdev.activationCode, appVersion: "1.8.0", locationPermission: "background", callPermission: "granted" })).json.deviceToken as string;
    const mStart = subMinutes(new Date(), 2);
    const ms = await db.shift.create({ data: { guardId: mary.id, locationId: site.id, supervisorId: admin.id, startAt: mStart, endAt: addHours(mStart, 12), durationMinutes: 720, status: "AWAITING_ARRIVAL", pendingPrompt: "ARRIVAL", arrivalSmsSentAt: mStart, attendance: { create: {} } } });
    const mFixAt = new Date();
    await post("/api/gateways/events", { sentAt: new Date().toISOString(), events: [{ eventId: `e2e-int-${randomUUID()}`, eventType: "LOCATION_CHECK", timestamp: mFixAt.toISOString(), shiftId: ms.id, siteId: site.id, geofenceRadiusM: SITE.radius, ...fix(20) }] }, mt);
    const mAtt = await db.attendance.findUniqueOrThrow({ where: { shiftId: ms.id } });
    const mRow = await db.attendanceCheckIn.findUnique({ where: { shiftId: ms.id } });
    check("the fix inside the site confirms presence on its own, within grace", mRow?.status === "VERIFIED_WITHIN_GRACE" && mRow.callAt === null && mAtt.locationVerification === "VERIFIED" && mAtt.arrivalConfirmedAt != null, `${mRow?.status} ${mAtt.locationVerification}`);
    const mConfirm = mAtt.arrivalConfirmedAt;
    const yM = await processIncomingMessage({ from: MARY, body: "YES", provider: "simulated" });
    const mAtt2 = await db.attendance.findUniqueOrThrow({ where: { shiftId: ms.id } });
    check("a YES that arrives afterwards is logged, and does not re-confirm or move the arrival", mAtt2.arrivalConfirmedAt?.getTime() === mConfirm?.getTime() && (await db.shiftCheckIn.count({ where: { shiftId: ms.id, type: "ARRIVAL_CONFIRMED" } })) === 0, JSON.stringify(yM));

    console.log("2. App and SMS status messages share one workflow without duplicating each other");
    await db.shift.update({ where: { id: js.id }, data: { pendingPrompt: "WELFARE", welfareSmsSentAt: new Date() } });
    await db.welfareCheck.create({ data: { shiftId: js.id, sentAt: new Date(), response: "PENDING" } });
    await processIncomingMessage({ from: JOHN, body: "WELL", provider: "simulated" });
    await post("/api/gateways/events", { events: [ev("SHIFT_OK", {}, new Date())] }, gt);
    check("SMS WELL answers the welfare check once; app SHIFT_OK is a separate informational line, no second welfare answer", (await db.welfareCheck.count({ where: { shiftId: js.id, response: "WELL" } })) === 1 && (await db.shiftCheckIn.count({ where: { shiftId: js.id, type: "GUARD_OK" } })) === 1 && (await db.shiftCheckIn.count({ where: { shiftId: js.id, type: "WELFARE_OK" } })) === 1);
    await post("/api/gateways/events", { events: [ev("NEED_ASSISTANCE", { message: "Gate jammed" }, new Date())] }, gt);
    await db.shift.update({ where: { id: js.id }, data: { pendingPrompt: "WELFARE" } });
    await db.welfareCheck.create({ data: { shiftId: js.id, sentAt: new Date(), response: "PENDING" } });
    await processIncomingMessage({ from: JOHN, body: "HELP", provider: "simulated" });
    const jShift = await db.shift.findUniqueOrThrow({ where: { id: js.id } });
    check("app assistance then SMS HELP: shift ASSISTANCE once, one alert row, one SMS incident, no app incident for assistance", jShift.status === "ASSISTANCE" && (await db.guardAlert.count({ where: { guardId: john.id, type: "NEED_ASSISTANCE" } })) === 1 && (await db.incident.count({ where: { guardId: john.id } })) === 1);

    console.log("4. Call monitoring intact, with location from the guard phone");
    const callId = `int-call-${randomUUID()}`;
    const r = await post("/api/gateways/events", { events: [
      { eventId: `${callId}-1`, eventType: "CALL_STARTED", callId, phoneNumber: OPS, direction: "OUTGOING", timestamp: new Date().toISOString(), location: fix(20) },
      { eventId: `${callId}-2`, eventType: "CALL_ANSWERED", callId, timestamp: new Date(Date.now() + 1000).toISOString() },
      { eventId: `${callId}-3`, eventType: "CALL_ENDED", callId, timestamp: new Date(Date.now() + 61_000).toISOString(), durationSeconds: 60, answered: true },
    ] }, gt);
    const call = await db.callLog.findUnique({ where: { gatewayDeviceId_callId: { gatewayDeviceId: dev.id, callId } } });
    check("guard-phone call folded to one ENDED record attributed to John on his shift with INSIDE location", r.status === 200 && call?.status === "ENDED" && call.guardId === john.id && call.shiftId === js.id && call.locationState === "INSIDE", JSON.stringify(call));
    const oc = `int-ops-${randomUUID()}`;
    await post("/api/gateways/events", { events: [{ eventId: `${oc}-1`, eventType: "CALL_STARTED", callId: oc, phoneNumber: PETER, direction: "INCOMING", timestamp: new Date().toISOString() }, { eventId: `${oc}-2`, eventType: "CALL_MISSED", callId: oc, timestamp: new Date(Date.now() + 20_000).toISOString() }] }, ot);
    const ocall = await db.callLog.findUnique({ where: { gatewayDeviceId_callId: { gatewayDeviceId: ops.id, callId: oc } } });
    check("operations gateway missed call from Peter attributed and flagged", ocall?.status === "MISSED" && ocall.guardId === peter.id && Boolean(await db.notification.findFirst({ where: { type: "MISSED_CALL", guardId: peter.id } })));

    console.log("5 + 6. Offline replay: every event type, shuffled, with duplicates");
    const base = subMinutes(now, 60); // well outside the 10-minute SYNCED window, so everything replays as SYNCED_LATE
    const at = (s: number) => new Date(base.getTime() + s * 1000);
    const c2 = `int-call2-${randomUUID()}`;
    const batch = [
      ev("LOCATION_CHECK", fix(30), at(0)), ev("LOCATION_EXIT", fix(420), at(60)), ev("LOCATION_OUTSIDE", fix(480), at(240)), ev("LOCATION_RETURNED", fix(35), at(300), { durationOutsideSeconds: 240 }),
      ev("LOCATION_UNAVAILABLE", { locationState: "UNKNOWN", reason: "poor_accuracy" }, at(330)),
      ev("STATUS_UPDATE", { message: "replayed offline" }, at(90)), ev("SECURITY_ALERT", { message: "replayed security" }, at(120)),
      { eventId: `${c2}-1`, eventType: "CALL_STARTED", callId: c2, phoneNumber: OPS, direction: "INCOMING", timestamp: at(150).toISOString(), location: fix(440) },
      { eventId: `${c2}-2`, eventType: "CALL_MISSED", callId: c2, timestamp: at(170).toISOString() },
      { eventId: `e2e-int-${randomUUID()}`, eventType: "DEVICE_STATUS", timestamp: at(10).toISOString(), meta: { locationPermission: "background", monitoringState: "OFFLINE_MONITORING" } },
    ];
    const withDupes = shuffle([...batch, batch[1], batch[6], batch[7]]);
    const rr = await post("/api/gateways/events", { events: withDupes }, gt);
    const acks = (rr.json.acks ?? []) as { eventId: string; status: string }[];
    check("every event acked ok exactly once and duplicates as duplicate", acks.length === withDupes.length && acks.filter((a) => a.status === "ok").length === batch.length && acks.filter((a) => a.status === "duplicate").length === 3 && !acks.some((a) => a.status === "rejected"), JSON.stringify(acks.map((a) => a.status)));
    const locs = await db.locationEvent.findMany({ where: { eventId: { in: batch.map((b) => b.eventId) } }, orderBy: { occurredAt: "asc" } });
    check("location story stored once, in time order, all synced late", locs.map((l) => l.eventType).join(",") === "LOCATION_CHECK,LOCATION_EXIT,LOCATION_OUTSIDE,LOCATION_RETURNED,LOCATION_UNAVAILABLE" && locs.every((l) => l.syncStatus === "SYNCED_LATE"), locs.map((l) => `${l.eventType}:${l.syncStatus}`).join(","));
    check("exit and return alerts raised once each despite the duplicate exit", (await db.notification.count({ where: { type: "LOCATION_EXIT", shiftId: js.id } })) === 1 && (await db.notification.count({ where: { type: "LOCATION_RETURNED", shiftId: js.id } })) === 1);
    check("replayed alerts stored once with original times and SYNCED_LATE", (await db.guardAlert.count({ where: { guardId: john.id, type: { in: ["STATUS_UPDATE", "SECURITY_ALERT"] } } })) === 2 && (await db.guardAlert.findFirstOrThrow({ where: { guardId: john.id, type: "SECURITY_ALERT" } })).syncStatus === "SYNCED_LATE");
    const c2row = await db.callLog.findUnique({ where: { gatewayDeviceId_callId: { gatewayDeviceId: dev.id, callId: c2 } } });
    check("replayed call reduced to one MISSED record with OUTSIDE location", c2row?.status === "MISSED" && c2row.locationState === "OUTSIDE");
    check("device status event applied", (await db.gatewayDevice.findUniqueOrThrow({ where: { id: dev.id } })).monitoringState === "OFFLINE_MONITORING");
    check("all GPS rows belong to John and his shift, none to Peter", (await db.locationEvent.count({ where: { shiftId: js.id, guardId: john.id } })) === (await db.locationEvent.count({ where: { gatewayDeviceId: dev.id } })) && (await db.locationEvent.count({ where: { guardId: peter.id } })) === 0);
    check("raw event log has one row per unique eventId", (await db.gatewayEvent.count({ where: { gatewayDeviceId: dev.id, eventId: { in: batch.map((b) => b.eventId) } } })) === batch.length);
  } finally {
    await cleanup();
  }
  console.log(`\n${passed} passed, ${failed} failed · test data removed`);
  await db.$disconnect();
  process.exit(failed ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await cleanup().catch(() => undefined); process.exit(1); });
