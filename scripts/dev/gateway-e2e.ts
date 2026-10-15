/**
 * End-to-end scenario for the call gateway against the configured database, through the real
 * HTTP routes of a running server (default http://localhost:3000). Creates tagged test data
 * (client ABC-E2E, guard G-E2E01, gateway "E2E Control Room 01") and removes it at the end.
 *
 *   npx tsx scripts/dev/gateway-e2e.ts            # needs: npm run dev (SMS_PROVIDER=simulated)
 *   APP_URL=https://host npx tsx scripts/dev/gateway-e2e.ts
 */
process.env.SMS_PROVIDER = process.env.SMS_PROVIDER || "simulated";
import { config } from "dotenv"; config();
// Guard rail: these scripts create and delete records by name pattern. Never run them against a production database.
const dbUrl = process.env.DATABASE_URL ?? "";
if (!/localhost|127\.0\.0\.1/.test(dbUrl) && process.env.ALLOW_LIVE_DB !== "1") {
  console.error("Refusing to run against a non-local DATABASE_URL. Set ALLOW_LIVE_DB=1 only for a database that holds no real data.");
  process.exit(2);
}
import { addHours, subMinutes } from "date-fns";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { processIncomingMessage } from "../../src/lib/sms/pipeline";
import { runAutomationTick } from "../../src/lib/automation/engine";
import { createGateway, revokeGateway, gatewayMaintenance } from "../../src/lib/gateway/service";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const GUARD_PHONE = "+263771234567";
let passed = 0, failed = 0;
const check = (name: string, ok: boolean, detail = "") => { if (ok) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name} ${detail}`); } };
const post = async (path: string, body: unknown, token?: string) => { const r = await fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }); return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, any> }; };

async function cleanup() {
  const guards = await db.guard.findMany({ where: { guardNo: "G-E2E01" }, select: { id: true } });
  const gIds = guards.map((g) => g.id);
  const shifts = await db.shift.findMany({ where: { guardId: { in: gIds } }, select: { id: true } });
  const sIds = shifts.map((s) => s.id);
  const gws = await db.gatewayDevice.findMany({ where: { deviceName: { startsWith: "E2E " } }, select: { id: true } });
  const gwIds = gws.map((g) => g.id);
  const clients = await db.client.findMany({ where: { code: "ABC-E2E" }, select: { id: true } });
  await db.$transaction([
    db.notification.deleteMany({ where: { OR: [{ guardId: { in: gIds } }, { type: "GATEWAY_OFFLINE", title: { contains: "E2E " } }, { type: "UNKNOWN_CALLER", title: { contains: "E2E " } }] } }),
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
  const health = await fetch(`${BASE}/api/health`).then((r) => r.status).catch(() => 0);
  if (health !== 200) throw new Error(`Server at ${BASE} not reachable (health ${health}). Start it with npm run dev.`);
  await cleanup();
  const admin = await db.user.findFirstOrThrow({ where: { role: "SUPER_ADMIN" } });
  console.log("Setup: client, location, guard, gateway");
  const client = await db.client.create({ data: { code: "ABC-E2E", name: "ABC Security Client (E2E)", contactPhone: "+263242000111" } });
  const loc = await db.location.create({ data: { code: "ABC-E2E-01", name: "ABC Warehouse (E2E)", clientId: client.id, address: "12 Plymouth Rd", supervisorId: admin.id } });
  const guard = await db.guard.create({ data: { guardNo: "G-E2E01", firstName: "John", lastName: "Moyo", phone: GUARD_PHONE, nationalId: "E2E-63-1", dateEmployed: new Date(), homeLocationId: loc.id } });
  const gw = await createGateway({ deviceName: "E2E Control Room 01", phoneNumber: "+263772100100", locationId: loc.id, actor: { userId: admin.id, name: admin.name } });
  const now = new Date();
  try {
    // 1–2 activation + online
    console.log("1. Activate gateway");
    const bad = await post("/api/gateways/activate", { activationCode: "NOPE00" });
    check("wrong activation code rejected", bad.status === 400);
    const act = await post("/api/gateways/activate", { activationCode: gw.activationCode, appVersion: "1.0.0", androidVersion: "13", deviceModel: "Samsung A10", batteryLevel: 78, networkType: "mobile" });
    check("activation returns a token", act.status === 200 && typeof act.json.deviceToken === "string", JSON.stringify(act.json));
    const token = act.json.deviceToken as string;
    const twice = await post("/api/gateways/activate", { activationCode: gw.activationCode });
    check("activation code is single-use", twice.status === 400);
    const hb = await post("/api/gateways/heartbeat", { batteryLevel: 77, networkType: "mobile", appVersion: "1.0.0" }, token);
    check("heartbeat accepted with config", hb.status === 200 && hb.json.config?.heartbeatSeconds > 0, JSON.stringify(hb.json));
    const dev1 = await db.gatewayDevice.findUniqueOrThrow({ where: { id: gw.id } });
    check("2. gateway is ONLINE", dev1.status === "ONLINE" && dev1.batteryLevel === 77);
    const noTok = await post("/api/gateways/heartbeat", {});
    check("heartbeat without token → 401", noTok.status === 401);

    // 3–6 shift + existing SMS flow
    console.log("3–6. Shift and existing SMS arrival flow");
    const shift = await db.shift.create({ data: { guardId: guard.id, locationId: loc.id, supervisorId: admin.id, startAt: subMinutes(now, 2), endAt: addHours(now, 12), durationMinutes: 722, status: "SCHEDULED", attendance: { create: { status: "PENDING" } } } });
    const tick = await runAutomationTick(new Date());
    const arrivalSms = await db.smsMessage.findFirst({ where: { shiftId: shift.id, type: "ARRIVAL", direction: "OUTBOUND" } });
    check("4. existing engine sent the arrival SMS", Boolean(arrivalSms), JSON.stringify(tick.errors));
    const reply = await processIncomingMessage({ from: "0771234567", body: "YES", provider: "simulated" });
    check("5. YES reply understood by the existing pipeline", reply.interpreted === "YES", reply.action);
    const att = await db.attendance.findUniqueOrThrow({ where: { shiftId: shift.id } });
    check("6. attendance recorded by the existing SMS system", att.status === "PRESENT" || att.status === "LATE", att.status);

    // 7–16 call flow
    console.log("7–16. Guard calls the gateway");
    const callId = `e2e-${randomUUID()}`;
    const t0 = new Date();
    const e1 = await post("/api/gateways/events", { events: [{ eventId: `${callId}-1`, eventType: "CALL_STARTED", callId, phoneNumber: "0771234567", direction: "INCOMING", timestamp: t0.toISOString() }] }, token);
    check("9. backend accepted CALL_STARTED", e1.status === 200 && e1.json.acks?.[0]?.status === "ok", JSON.stringify(e1.json));
    let call = await db.callLog.findUniqueOrThrow({ where: { gatewayDeviceId_callId: { gatewayDeviceId: gw.id, callId } } });
    check("10. system identified John Moyo from 0771234567", call.guardId === guard.id && call.normalizedPhoneNumber === GUARD_PHONE);
    check("11. call is RINGING on the dashboard feed", call.status === "RINGING");
    check("12. call associated with the active shift and location", call.shiftId === shift.id && call.locationId === loc.id && call.clientId === client.id);
    const e2 = await post("/api/gateways/events", { events: [{ eventId: `${callId}-2`, eventType: "CALL_ANSWERED", callId, timestamp: new Date(t0.getTime() + 6000).toISOString() }] }, token);
    call = await db.callLog.findUniqueOrThrow({ where: { id: call.id } });
    check("13. answered", e2.status === 200 && call.status === "ANSWERED");
    const e3 = await post("/api/gateways/events", { events: [{ eventId: `${callId}-3`, eventType: "CALL_ENDED", callId, timestamp: new Date(t0.getTime() + 228000).toISOString() }] }, token);
    call = await db.callLog.findUniqueOrThrow({ where: { id: call.id } });
    check("14. ended", e3.status === 200 && call.status === "ENDED");
    check("15. duration 03:42", call.durationSeconds === 222, String(call.durationSeconds));
    const dup = await post("/api/gateways/events", { events: [{ eventId: `${callId}-3`, eventType: "CALL_ENDED", callId, timestamp: new Date().toISOString() }] }, token);
    check("retry of the same event is acknowledged as duplicate", dup.json.acks?.[0]?.status === "duplicate");
    check("no duplicate call rows", (await db.callLog.count({ where: { gatewayDeviceId: gw.id, callId } })) === 1);
    const tl = await db.shiftCheckIn.findMany({ where: { shiftId: shift.id, type: { in: ["CALL_INCOMING", "CALL_ANSWERED", "CALL_ENDED"] } } });
    check("16. timeline has incoming, answered and ended entries", tl.length === 3, String(tl.length));

    // 17–18 missed call
    console.log("17–18. Missed call from the on-duty guard");
    const missedId = `e2e-${randomUUID()}`;
    await post("/api/gateways/events", { events: [{ eventId: `${missedId}-1`, eventType: "CALL_STARTED", callId: missedId, phoneNumber: GUARD_PHONE, timestamp: new Date().toISOString() }, { eventId: `${missedId}-2`, eventType: "CALL_MISSED", callId: missedId, timestamp: new Date(Date.now() + 20000).toISOString() }] }, token);
    const missed = await db.callLog.findUniqueOrThrow({ where: { gatewayDeviceId_callId: { gatewayDeviceId: gw.id, callId: missedId } } });
    check("17. call recorded as MISSED", missed.status === "MISSED");
    const alert = await db.notification.findFirst({ where: { type: "MISSED_CALL", guardId: guard.id }, orderBy: { createdAt: "desc" } });
    check("18. ACTIVE GUARD MISSED CALL alert raised as critical", alert?.severity === "CRITICAL" && /ACTIVE GUARD MISSED CALL/.test(alert.title), alert?.title);

    // 19–20 unknown caller
    console.log("19–20. Unknown caller");
    const unkId = `e2e-${randomUUID()}`;
    await post("/api/gateways/events", { events: [{ eventId: `${unkId}-1`, eventType: "CALL_STARTED", callId: unkId, phoneNumber: "+263719000000", timestamp: new Date().toISOString() }] }, token);
    const unk = await db.callLog.findUniqueOrThrow({ where: { gatewayDeviceId_callId: { gatewayDeviceId: gw.id, callId: unkId } } });
    check("20. unknown caller stored without a guard", unk.unknownCaller && unk.guardId === null && unk.locationId === loc.id);

    // 21–25 offline queue replay (events arrive late, out of order, with device verdict)
    console.log("21–25. Offline queue replay");
    const qId = `e2e-${randomUUID()}`;
    const q0 = new Date(Date.now() - 10 * 60000);
    const replay = await post("/api/gateways/events", { events: [
      { eventId: `${qId}-3`, eventType: "CALL_ENDED", callId: qId, phoneNumber: GUARD_PHONE, timestamp: new Date(q0.getTime() + 95000).toISOString(), answered: true, durationSeconds: 90 },
      { eventId: `${qId}-1`, eventType: "CALL_STARTED", callId: qId, phoneNumber: GUARD_PHONE, timestamp: q0.toISOString() },
      { eventId: `${qId}-2`, eventType: "CALL_ANSWERED", callId: qId, timestamp: new Date(q0.getTime() + 5000).toISOString() },
    ] }, token);
    const q = await db.callLog.findUniqueOrThrow({ where: { gatewayDeviceId_callId: { gatewayDeviceId: gw.id, callId: qId } } });
    check("25. queued batch synchronised into one completed call", replay.status === 200 && q.status === "ENDED" && q.durationSeconds === 90 && q.guardId === guard.id, `${q.status} ${q.durationSeconds}`);

    // 26–29 restart: heartbeat resumes; offline detection
    console.log("26–29. Offline detection and reconnect");
    await db.gatewayDevice.update({ where: { id: gw.id }, data: { lastSeenAt: subMinutes(new Date(), 30) } });
    const m = await gatewayMaintenance(new Date());
    const off = await db.gatewayDevice.findUniqueOrThrow({ where: { id: gw.id } });
    check("engine marks a silent gateway OFFLINE and alerts", m.offline >= 1 && off.status === "OFFLINE" && Boolean(await db.notification.findFirst({ where: { type: "GATEWAY_OFFLINE", title: { contains: "E2E" } } })));
    const hb2 = await post("/api/gateways/heartbeat", { batteryLevel: 60, networkType: "wifi" }, token);
    const back = await db.gatewayDevice.findUniqueOrThrow({ where: { id: gw.id } });
    check("28. heartbeat after restart brings it back ONLINE", hb2.status === 200 && back.status === "ONLINE");

    // 30–31 revocation
    console.log("30–31. Revocation");
    await revokeGateway(gw.id, { userId: admin.id, name: admin.name }, "e2e");
    const after = await post("/api/gateways/events", { events: [{ eventId: `rev-${randomUUID()}`, eventType: "CALL_STARTED", callId: `rev-${randomUUID()}`, phoneNumber: GUARD_PHONE, timestamp: new Date().toISOString() }] }, token);
    check("31. revoked gateway cannot send events", after.status === 401 || after.status === 403, String(after.status));
    const hb3 = await post("/api/gateways/heartbeat", {}, token);
    check("revoked gateway cannot heartbeat", hb3.status === 401 || hb3.status === 403);

    // 32–33 SMS still works
    console.log("32–33. Existing SMS still works");
    await db.shift.update({ where: { id: shift.id }, data: { pendingPrompt: "WELFARE", welfareSmsSentAt: new Date() } });
    await db.welfareCheck.create({ data: { shiftId: shift.id, sentAt: new Date(), response: "PENDING" } });
    const w = await processIncomingMessage({ from: GUARD_PHONE, body: "1", provider: "simulated" });
    check("welfare reply processed by the existing pipeline", w.interpreted === "WELL", w.action);
    const outbound = await db.smsMessage.count({ where: { guardId: guard.id, direction: "OUTBOUND", status: "SENT" } });
    check("outbound SMS still logged as sent", outbound >= 2, String(outbound));
  } finally {
    await cleanup();
    console.log(`\n${passed} passed, ${failed} failed · test data removed`);
    if (failed) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
