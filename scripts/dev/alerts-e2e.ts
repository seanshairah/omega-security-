/**
 * Guard alerts from the app (Phase 2, Stage 5) over real HTTP: emergency with and without a fix,
 * assistance, status messages, late sync, duplicate replay, acknowledgement travelling back on the
 * heartbeat, and the SMS EMERGENCY keyword still working for a feature-phone guard.
 * Tagged data (client ABC-E2E-AL, guards G-E2EA1/G-E2EA2, devices "E2E-AL …") is removed at the end.
 *
 *   npx tsx scripts/dev/alerts-e2e.ts      (local DATABASE_URL; needs npm run dev with SMS_PROVIDER=simulated)
 */
process.env.SMS_PROVIDER = process.env.SMS_PROVIDER || "simulated";
import { config } from "dotenv"; config();
const dbUrl = process.env.DATABASE_URL ?? "";
if (!/localhost|127\.0\.0\.1/.test(dbUrl) && process.env.ALLOW_LIVE_DB !== "1") { console.error("Refusing to run against a non-local DATABASE_URL."); process.exit(2); }
import { addHours, subMinutes } from "date-fns";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { processIncomingMessage } from "../../src/lib/sms/pipeline";
import { createGateway, revokeGateway } from "../../src/lib/gateway/service";
import { acknowledgeAlert, resolveAlert } from "../../src/lib/gateway/alerts";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const SITE = { latitude: -17.8292, longitude: 31.0522, radius: 150 };
const JOHN = "+263779900781", PETER = "+263779900782";
let passed = 0, failed = 0;
const check = (name: string, ok: boolean, detail = "") => { if (ok) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name} ${detail}`); } };
const post = async (path: string, body: unknown, token?: string) => { const r = await fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }); return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, any> }; }; // eslint-disable-line @typescript-eslint/no-explicit-any

async function cleanup() {
  const guards = await db.guard.findMany({ where: { guardNo: { in: ["G-E2EA1", "G-E2EA2"] } }, select: { id: true } });
  const gIds = guards.map((g) => g.id);
  const shifts = await db.shift.findMany({ where: { guardId: { in: gIds } }, select: { id: true } });
  const sIds = shifts.map((s) => s.id);
  const gws = await db.gatewayDevice.findMany({ where: { deviceName: { startsWith: "E2E-AL " } }, select: { id: true } });
  const gwIds = gws.map((g) => g.id);
  await db.$transaction([
    db.notification.deleteMany({ where: { OR: [{ guardId: { in: gIds } }, { shiftId: { in: sIds } }] } }),
    db.guardAlert.deleteMany({ where: { OR: [{ guardId: { in: gIds } }, { gatewayDeviceId: { in: gwIds } }] } }),
    db.incident.deleteMany({ where: { guardId: { in: gIds } } }),
    db.shiftCheckIn.deleteMany({ where: { shiftId: { in: sIds } } }), db.welfareCheck.deleteMany({ where: { shiftId: { in: sIds } } }),
    db.smsMessage.deleteMany({ where: { guardId: { in: gIds } } }),
    db.locationEvent.deleteMany({ where: { gatewayDeviceId: { in: gwIds } } }), db.callLog.deleteMany({ where: { gatewayDeviceId: { in: gwIds } } }), db.gatewayEvent.deleteMany({ where: { gatewayDeviceId: { in: gwIds } } }),
    db.attendance.deleteMany({ where: { shiftId: { in: sIds } } }), db.shift.deleteMany({ where: { id: { in: sIds } } }),
    db.gatewayDevice.deleteMany({ where: { id: { in: gwIds } } }),
    db.guard.deleteMany({ where: { id: { in: gIds } } }), db.location.deleteMany({ where: { code: "ABC-E2EAL-01" } }), db.client.deleteMany({ where: { code: "ABC-E2E-AL" } }),
    db.auditLog.deleteMany({ where: { entityId: { in: [...gwIds, ...gIds, ...sIds] } } }),
  ]);
}

async function main() {
  if ((await fetch(`${BASE}/api/health`).then((r) => r.status).catch(() => 0)) !== 200) throw new Error(`Server at ${BASE} not reachable.`);
  await cleanup();
  const admin = await db.user.findFirstOrThrow({ where: { role: "SUPER_ADMIN" } });
  const actor = { userId: admin.id, name: admin.name };
  const client = await db.client.create({ data: { code: "ABC-E2E-AL", name: "ABC Alerts Client (E2E)", contactPhone: "+263242000112" } });
  const site = await db.location.create({ data: { code: "ABC-E2EAL-01", name: "Silverpeak Depot (E2E)", clientId: client.id, address: "Silverpeak", supervisorId: admin.id, latitude: SITE.latitude, longitude: SITE.longitude, geofenceRadiusM: SITE.radius } });
  const john = await db.guard.create({ data: { guardNo: "G-E2EA1", firstName: "John", lastName: "Alerts", phone: JOHN, nationalId: "E2EA-1", dateEmployed: new Date(), homeLocationId: site.id } });
  const peter = await db.guard.create({ data: { guardNo: "G-E2EA2", firstName: "Peter", lastName: "Alerts", phone: PETER, nationalId: "E2EA-2", dateEmployed: new Date(), homeLocationId: site.id } });
  const dev = await createGateway({ deviceName: "E2E-AL John's phone", phoneNumber: JOHN, mode: "GUARD", guardId: john.id, actor });
  const opsDev = await createGateway({ deviceName: "E2E-AL Control Room", phoneNumber: "+263772100100", locationId: site.id, actor });
  try {
    const a1 = await post("/api/gateways/activate", { activationCode: dev.activationCode, appVersion: "1.3.0", androidVersion: "14", locationPermission: "background", callPermission: "granted" });
    const gt = a1.json.deviceToken as string;
    check("guard device activated; config carries the operations phone for offline fallback", a1.status === 200 && typeof a1.json.config?.opsPhone === "string" && a1.json.config.opsPhone.length > 5, JSON.stringify(a1.json.config));
    const a2 = await post("/api/gateways/activate", { activationCode: opsDev.activationCode });
    const ot = a2.json.deviceToken as string;

    const now = new Date();
    const shift = await db.shift.create({ data: { guardId: john.id, locationId: site.id, supervisorId: admin.id, startAt: subMinutes(now, 60), endAt: addHours(now, 11), durationMinutes: 720, status: "ON_DUTY", attendance: { create: { status: "PRESENT", arrivalConfirmedAt: subMinutes(now, 55) } } } });
    const pshift = await db.shift.create({ data: { guardId: peter.id, locationId: site.id, supervisorId: admin.id, startAt: subMinutes(now, 60), endAt: addHours(now, 11), durationMinutes: 720, status: "ON_DUTY", attendance: { create: { status: "PRESENT", arrivalConfirmedAt: subMinutes(now, 55) } } } });
    const ev = (eventType: string, extra: Record<string, unknown> = {}, at = new Date()) => ({ eventId: `e2e-al-${randomUUID()}`, eventType, timestamp: at.toISOString(), shiftId: shift.id, ...extra });

    console.log("Emergency with a fresh fix");
    const e1 = ev("EMERGENCY", { message: "Armed men at the gate", location: { latitude: SITE.latitude + 0.0002, longitude: SITE.longitude, accuracyM: 9, state: "INSIDE", ageSeconds: 20 } });
    const r1 = await post("/api/gateways/events", { events: [e1] }, gt);
    check("emergency acknowledged by the server (ack ok)", r1.status === 200 && r1.json.acks?.[0]?.status === "ok", JSON.stringify(r1.json));
    const al1 = await db.guardAlert.findUnique({ where: { eventId: e1.eventId }, include: { incident: true } });
    check("alert stored OPEN with message, position and a CRITICAL incident", al1?.status === "OPEN" && al1.message === "Armed men at the gate" && al1.locationState === "INSIDE" && al1.incident?.category === "EMERGENCY" && al1.incident.severity === "CRITICAL" && al1.incident.source === "APP", JSON.stringify(al1));
    check("shift raised to CRITICAL with emergencyAt", (await db.shift.findUniqueOrThrow({ where: { id: shift.id } })).status === "CRITICAL");
    check("CRITICAL notification with the guard's phone and site", Boolean(await db.notification.findFirst({ where: { type: "EMERGENCY", guardId: john.id, severity: "CRITICAL", title: { contains: "SILVERPEAK DEPOT" } } })));
    check("timeline line on the shift", Boolean(await db.shiftCheckIn.findFirst({ where: { shiftId: shift.id, type: "EMERGENCY", source: "APP" } })));

    console.log("Emergency without any fix (never delayed waiting for GPS)");
    const e2 = ev("EMERGENCY", {});
    const r2 = await post("/api/gateways/events", { events: [e2] }, gt);
    const al2 = await db.guardAlert.findUnique({ where: { eventId: e2.eventId } });
    check("emergency without position is accepted and says so", r2.json.acks?.[0]?.status === "ok" && al2?.latitude == null && Boolean(await db.notification.findFirst({ where: { guardId: john.id, body: { contains: "No position available" } } })));

    console.log("Duplicate replay");
    const r3 = await post("/api/gateways/events", { events: [e1] }, gt);
    check("replayed emergency is a duplicate, not a second alert", r3.json.acks?.[0]?.status === "duplicate" && (await db.guardAlert.count({ where: { guardId: john.id, type: "EMERGENCY" } })) === 2);

    console.log("Assistance, incident, security, late, status, ok, handover");
    const batch = [ev("NEED_ASSISTANCE", { message: "Need a second guard" }), ev("INCIDENT_REPORT", { message: "Fence cut on the east side" }), ev("SECURITY_ALERT", { message: "Unknown vehicle circling" }), ev("RUNNING_LATE", { message: "Transport broke down" }), ev("STATUS_UPDATE", { message: "Patrol round 3 done" }), ev("SHIFT_OK", {}), ev("HANDOVER", { message: "Keys handed to Tendai" })];
    const r4 = await post("/api/gateways/events", { events: batch }, gt);
    check("all seven status types accepted", r4.json.acks?.length === 7 && r4.json.acks.every((a: { status: string }) => a.status === "ok"), JSON.stringify(r4.json.acks));
    const rows = await db.guardAlert.findMany({ where: { guardId: john.id } });
    const byType = Object.fromEntries(rows.map((r) => [r.type, r]));
    check("informational messages are resolved on arrival; serious ones stay open", byType.STATUS_UPDATE.status === "RESOLVED" && byType.SHIFT_OK.status === "RESOLVED" && byType.HANDOVER.status === "RESOLVED" && byType.NEED_ASSISTANCE.status === "OPEN" && byType.RUNNING_LATE.status === "OPEN");
    check("incident report and security alert open HIGH incidents", (await db.incident.count({ where: { guardId: john.id, severity: "HIGH", source: "APP" } })) === 2);
    check("shift status never downgraded from CRITICAL by an assistance request", (await db.shift.findUniqueOrThrow({ where: { id: shift.id } })).status === "CRITICAL");

    console.log("Late sync keeps the original time");
    const lateAt = subMinutes(new Date(), 45);
    const e5 = ev("NEED_ASSISTANCE", { message: "sent offline" }, lateAt);
    await post("/api/gateways/events", { events: [e5] }, gt);
    const al5 = await db.guardAlert.findUniqueOrThrow({ where: { eventId: e5.eventId } });
    check("offline alert stored SYNCED_LATE with the time it was pressed", al5.syncStatus === "SYNCED_LATE" && Math.abs(al5.occurredAt.getTime() - lateAt.getTime()) < 1000);

    console.log("Acknowledgement travels back on the heartbeat");
    await acknowledgeAlert(al1!.id, actor, "Dispatching response unit");
    const hb = await post("/api/gateways/heartbeat", { batteryLevel: 50 }, gt);
    const ackRow = (hb.json.alerts as { eventId: string; status: string; acknowledgedBy: string | null; acknowledgementNote: string | null }[] | undefined)?.find((a) => a.eventId === e1.eventId);
    check("heartbeat lists the alert as ACKNOWLEDGED with name and note", ackRow?.status === "ACKNOWLEDGED" && ackRow.acknowledgedBy === admin.name && ackRow.acknowledgementNote === "Dispatching response unit", JSON.stringify(ackRow));
    check("linked incident acknowledged too", (await db.incident.findUniqueOrThrow({ where: { id: al1!.incidentId! } })).status === "ACKNOWLEDGED");
    check("acknowledgement is on the shift timeline", Boolean(await db.shiftCheckIn.findFirst({ where: { shiftId: shift.id, type: "ALERT_ACKNOWLEDGED" } })));
    await resolveAlert(al1!.id, actor, "Police attended");
    check("resolve closes the alert", (await db.guardAlert.findUniqueOrThrow({ where: { id: al1!.id } })).status === "RESOLVED");

    console.log("Operations gateway cannot raise guard alerts; revoked device cannot post");
    const r6 = await post("/api/gateways/events", { events: [ev("EMERGENCY", {})] }, ot);
    check("ops gateway alert is stored as ignored, not as a guard alert", r6.status === 200 && (await db.guardAlert.count({ where: { gatewayDeviceId: opsDev.id } })) === 0);
    await revokeGateway(dev.id, actor, "e2e");
    check("revoked guard device cannot post alerts", [401, 403].includes((await post("/api/gateways/events", { events: [ev("EMERGENCY", {})] }, gt)).status));

    console.log("SMS EMERGENCY keyword still works for the feature-phone guard");
    const sms = await processIncomingMessage({ from: PETER, body: "EMERGENCY", provider: "simulated" });
    check("SMS emergency: incident created, shift CRITICAL, no guard-app alert row", sms.interpreted === "EMERGENCY" && (await db.shift.findUniqueOrThrow({ where: { id: pshift.id } })).status === "CRITICAL" && (await db.guardAlert.count({ where: { guardId: peter.id } })) === 0, JSON.stringify(sms));
  } finally {
    await cleanup();
  }
  console.log(`\n${passed} passed, ${failed} failed · test data removed`);
  await db.$disconnect();
  process.exit(failed ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await cleanup().catch(() => undefined); process.exit(1); });
