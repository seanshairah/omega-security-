/** Create (or remove with --clean) a small tagged data set for screenshots of the gateway pages. */
process.env.SMS_PROVIDER = "simulated";
import { config } from "dotenv"; config();
// Guard rail: these scripts create and delete records by name pattern. Never run them against a production database.
const dbUrl = process.env.DATABASE_URL ?? "";
if (!/localhost|127\.0\.0\.1/.test(dbUrl) && process.env.ALLOW_LIVE_DB !== "1") {
  console.error("Refusing to run against a non-local DATABASE_URL. Set ALLOW_LIVE_DB=1 only for a database that holds no real data.");
  process.exit(2);
}
import { addHours, subMinutes } from "date-fns";
import { db } from "../../src/lib/db";
import { createGateway, activateGateway } from "../../src/lib/gateway/service";
import { processGatewayEvents } from "../../src/lib/gateway/events";
import { applyLocationEvent } from "../../src/lib/gateway/location-events";
import { processIncomingMessage } from "../../src/lib/sms/pipeline";
import { runAutomationTick } from "../../src/lib/automation/engine";

async function clean() {
  const guards = await db.guard.findMany({ where: { guardNo: { in: ["G-QA01", "G-QA02"] } }, select: { id: true } });
  const gIds = guards.map((g) => g.id);
  const shifts = await db.shift.findMany({ where: { guardId: { in: gIds } }, select: { id: true } });
  const sIds = shifts.map((s) => s.id);
  const gws = await db.gatewayDevice.findMany({ where: { deviceName: { startsWith: "QA " } }, select: { id: true } });
  const gwIds = gws.map((g) => g.id);
  await db.$transaction([
    db.notification.deleteMany({ where: { OR: [{ guardId: { in: gIds } }, { type: { in: ["GATEWAY_OFFLINE", "DEVICE_OFFLINE", "UNKNOWN_CALLER", "DEVICE_LOW_BATTERY", "LOCATION_INTEGRITY"] }, title: { contains: "QA " } }] } }),
    db.locationEvent.deleteMany({ where: { OR: [{ gatewayDeviceId: { in: gwIds } }, { shiftId: { in: sIds } }] } }),
    db.shiftCheckIn.deleteMany({ where: { shiftId: { in: sIds } } }), db.welfareCheck.deleteMany({ where: { shiftId: { in: sIds } } }),
    db.incident.deleteMany({ where: { guardId: { in: gIds } } }), db.smsMessage.deleteMany({ where: { guardId: { in: gIds } } }),
    db.callLog.deleteMany({ where: { gatewayDeviceId: { in: gwIds } } }), db.gatewayEvent.deleteMany({ where: { gatewayDeviceId: { in: gwIds } } }),
    db.attendance.deleteMany({ where: { shiftId: { in: sIds } } }), db.shift.deleteMany({ where: { id: { in: sIds } } }),
    db.gatewayDevice.deleteMany({ where: { id: { in: gwIds } } }),
    db.guard.deleteMany({ where: { id: { in: gIds } } }), db.location.deleteMany({ where: { code: { in: ["QA-01", "QA-02"] } } }), db.client.deleteMany({ where: { code: "QA" } }),
    db.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [...gwIds, ...gIds, ...sIds] } }, { action: { in: ["SMS_SENT", "SMS_FAILED"] }, details: { path: ["to"], equals: "+263771234567" } }] } }),
  ]);
}

async function main() {
  await clean();
  if (process.argv.includes("--clean")) { console.log("cleaned"); return; }
  const admin = await db.user.findFirstOrThrow({ where: { role: "SUPER_ADMIN" } });
  const client = await db.client.create({ data: { code: "QA", name: "ABC Logistics", contactPhone: "+263242300200" } });
  const wh = await db.location.create({ data: { code: "QA-01", name: "ABC Warehouse", clientId: client.id, address: "12 Plymouth Rd, Graniteside", supervisorId: admin.id, latitude: -17.8292, longitude: 31.0522, geofenceRadiusM: 150 } });
  const mall = await db.location.create({ data: { code: "QA-02", name: "City Mall", clientId: client.id, address: "Harare CBD", supervisorId: admin.id } });
  // Guard.phone is unique, and seed-demo already gives +263772345002 to its own Peter Ncube.
  // Creating outright made this fixture fail with P2002 on any database that had been demo-seeded,
  // which is every database the map and layout suites run against. Upsert by phone instead, so the
  // two seeders compose: an existing guard is reused and updated, a missing one is created.
  const john = await db.guard.upsert({
    where: { phone: "+263771234567" },
    update: { homeLocationId: wh.id },
    create: { guardNo: "G-QA01", firstName: "John", lastName: "Moyo", phone: "+263771234567", nationalId: "QA-63-1", dateEmployed: new Date(), homeLocationId: wh.id, photoUrl: "/avatars/guard-1.svg" },
  });
  await db.guard.upsert({
    where: { phone: "+263772345002" },
    update: { homeLocationId: mall.id },
    create: { guardNo: "G-QA02", firstName: "Peter", lastName: "Ncube", phone: "+263772345002", nationalId: "QA-63-2", dateEmployed: new Date(), homeLocationId: mall.id, photoUrl: "/avatars/guard-2.svg" },
  });
  const actor = { userId: admin.id, name: admin.name };
  const g1 = await createGateway({ deviceName: "QA Control Room 01", phoneNumber: "+263772100100", locationId: wh.id, actor });
  const g2 = await createGateway({ deviceName: "QA City Mall Office", phoneNumber: "+263772100101", locationId: mall.id, actor });
  await createGateway({ deviceName: "QA Head Office (pending)", phoneNumber: "+263772100102", actor });
  const a1 = await activateGateway(g1.activationCode!, { appVersion: "1.0.0", androidVersion: "13", deviceModel: "Samsung Galaxy A10", batteryLevel: 78, networkType: "mobile" }, "41.0.0.1");
  await activateGateway(g2.activationCode!, { appVersion: "1.0.0", androidVersion: "11", deviceModel: "Huawei Y6", batteryLevel: 15, networkType: "wifi" }, "41.0.0.2");
  await db.gatewayDevice.update({ where: { id: g2.id }, data: { lastSeenAt: subMinutes(new Date(), 40), status: "OFFLINE" } });
  const now = new Date();
  const shift = await db.shift.create({ data: { guardId: john.id, locationId: wh.id, supervisorId: admin.id, startAt: subMinutes(now, 250), endAt: addHours(now, 8), durationMinutes: 730, status: "SCHEDULED", attendance: { create: { status: "PENDING" } } } });
  await runAutomationTick(subMinutes(now, 248));
  await processIncomingMessage({ from: "0771234567", body: "YES", provider: "simulated", receivedAt: subMinutes(now, 246) });
  const dev = a1.device;
  const t = (m: number) => subMinutes(now, m).toISOString();
  await processGatewayEvents(dev, [
    { eventId: "qa-1-1", eventType: "CALL_STARTED", callId: "qa-1", phoneNumber: "0771234567", timestamp: t(130) },
    { eventId: "qa-1-2", eventType: "CALL_ANSWERED", callId: "qa-1", timestamp: t(129.9) },
    { eventId: "qa-1-3", eventType: "CALL_ENDED", callId: "qa-1", timestamp: t(126.2) },
    { eventId: "qa-2-1", eventType: "CALL_STARTED", callId: "qa-2", phoneNumber: "+263719000000", timestamp: t(60) },
    { eventId: "qa-2-2", eventType: "CALL_MISSED", callId: "qa-2", timestamp: t(59.5) },
    { eventId: "qa-3-1", eventType: "CALL_STARTED", callId: "qa-3", phoneNumber: "+263771234567", timestamp: t(12) },
    { eventId: "qa-3-2", eventType: "CALL_MISSED", callId: "qa-3", timestamp: t(11.6) },
    { eventId: "qa-4-1", eventType: "CALL_STARTED", callId: "qa-4", phoneNumber: "+263772345002", timestamp: t(0.5) },
    { eventId: "qa-4-2", eventType: "CALL_ANSWERED", callId: "qa-4", timestamp: t(0.3) },
  ]);
  // Guard device for John with a shift-long location story: inside, exit, outside, return (synced late)
  const gd = await createGateway({ deviceName: "QA John's phone", phoneNumber: "+263771234567", mode: "GUARD", guardId: john.id, actor });
  const ga = await activateGateway(gd.activationCode!, { appVersion: "1.1.0", androidVersion: "13 (API 33)", deviceModel: "Samsung Galaxy A12", batteryLevel: 64, networkType: "mobile", locationPermission: "background", callPermission: "granted" }, "41.0.0.3");
  const off = (m: number) => m / 111_000;
  const fx = (m: number, acc = 12) => ({ latitude: -17.8292 + off(m), longitude: 31.0522, accuracyM: acc, distanceM: m, geofenceRadiusM: 150, shiftId: shift.id, provider: "gps" });
  const L = async (type: string, m: number | null, minsAgo: number, extra: Record<string, unknown> = {}) => applyLocationEvent(ga.device, { eventId: `qa-loc-${type}-${minsAgo}`, eventType: type as never, timestamp: subMinutes(now, minsAgo), locationState: m == null ? "UNKNOWN" : m <= 150 ? "INSIDE" : "OUTSIDE", ...(m == null ? { shiftId: shift.id } : fx(m)), ...extra }, { simulated: true });
  await L("SHIFT_STARTED", 20, 245); await L("LOCATION_CHECK", 25, 180); await L("LOCATION_CHECK", 18, 120);
  await L("LOCATION_EXIT", 420, 95); await L("LOCATION_OUTSIDE", 480, 85);
  await db.locationEvent.updateMany({ where: { gatewayDeviceId: gd.id, eventType: { in: ["LOCATION_EXIT", "LOCATION_OUTSIDE"] } }, data: { syncStatus: "SYNCED_LATE" } });
  await L("LOCATION_RETURNED", 38, 45, { durationOutsideSeconds: 50 * 60 }); await L("LOCATION_CHECK", 22, 8);
  await db.gatewayDevice.update({ where: { id: gd.id }, data: { monitoringState: "MONITORING" } });
  console.log(JSON.stringify({ guardDevice: gd.id, gateway: g1.id, guard: john.id, shift: shift.id, call: (await db.callLog.findFirst({ where: { callId: "qa-3" } }))!.id, unknown: (await db.callLog.findFirst({ where: { callId: "qa-2" } }))!.id }));
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
