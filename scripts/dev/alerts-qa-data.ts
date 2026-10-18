/**
 * A few guard alerts for screenshots of the portal (local database only). Creates a tagged guard,
 * device and shift and posts alerts through the real intake; remove with --clean.
 *   npx tsx scripts/dev/alerts-qa-data.ts [--clean]
 */
process.env.SMS_PROVIDER = "simulated";
import { config } from "dotenv"; config();
const dbUrl = process.env.DATABASE_URL ?? "";
if (!/localhost|127\.0\.0\.1/.test(dbUrl) && process.env.ALLOW_LIVE_DB !== "1") { console.error("Refusing to run against a non-local DATABASE_URL."); process.exit(2); }
import { addHours, subMinutes } from "date-fns";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { createGateway, activateGateway } from "../../src/lib/gateway/service";
import { processGatewayEvents } from "../../src/lib/gateway/events";
import { acknowledgeAlert } from "../../src/lib/gateway/alerts";

async function clean() {
  const guards = await db.guard.findMany({ where: { guardNo: "G-QAAL1" }, select: { id: true } });
  const gIds = guards.map((g) => g.id);
  const shifts = await db.shift.findMany({ where: { guardId: { in: gIds } }, select: { id: true } });
  const sIds = shifts.map((s) => s.id);
  const gws = await db.gatewayDevice.findMany({ where: { deviceName: { startsWith: "QA-AL " } }, select: { id: true } });
  const gwIds = gws.map((g) => g.id);
  await db.$transaction([
    db.notification.deleteMany({ where: { OR: [{ guardId: { in: gIds } }, { shiftId: { in: sIds } }] } }),
    db.guardAlert.deleteMany({ where: { OR: [{ guardId: { in: gIds } }, { gatewayDeviceId: { in: gwIds } }] } }),
    db.incident.deleteMany({ where: { guardId: { in: gIds } } }),
    db.shiftCheckIn.deleteMany({ where: { shiftId: { in: sIds } } }), db.welfareCheck.deleteMany({ where: { shiftId: { in: sIds } } }),
    db.locationEvent.deleteMany({ where: { gatewayDeviceId: { in: gwIds } } }), db.gatewayEvent.deleteMany({ where: { gatewayDeviceId: { in: gwIds } } }), db.callLog.deleteMany({ where: { gatewayDeviceId: { in: gwIds } } }),
    db.attendance.deleteMany({ where: { shiftId: { in: sIds } } }), db.shift.deleteMany({ where: { id: { in: sIds } } }),
    db.gatewayDevice.deleteMany({ where: { id: { in: gwIds } } }),
    db.guard.deleteMany({ where: { id: { in: gIds } } }),
    db.auditLog.deleteMany({ where: { entityId: { in: [...gwIds, ...gIds, ...sIds] } } }),
  ]);
}

async function main() {
  await clean();
  if (process.argv.includes("--clean")) { console.log("cleaned"); return; }
  const admin = await db.user.findFirstOrThrow({ where: { role: "SUPER_ADMIN" } });
  const site = (await db.location.findFirst({ where: { latitude: { not: null } } })) ?? (await db.location.findFirstOrThrow());
  const guard = await db.guard.create({ data: { guardNo: "G-QAAL1", firstName: "Tapiwa", lastName: "Chikore", phone: "+263779900791", nationalId: "QA-AL-1", dateEmployed: new Date(), homeLocationId: site.id } });
  const dev = await createGateway({ deviceName: "QA-AL Tapiwa's phone", phoneNumber: "+263779900791", mode: "GUARD", guardId: guard.id, actor: { userId: admin.id, name: admin.name } });
  const { device } = await activateGateway(dev.activationCode!, { appVersion: "1.3.0", androidVersion: "14", locationPermission: "background", callPermission: "granted" }, null);
  const now = new Date();
  const shift = await db.shift.create({ data: { guardId: guard.id, locationId: site.id, supervisorId: admin.id, startAt: subMinutes(now, 90), endAt: addHours(now, 10), durationMinutes: 720, status: "ON_DUTY", attendance: { create: { status: "PRESENT", arrivalConfirmedAt: subMinutes(now, 85) } } } });
  const loc = site.latitude != null ? { latitude: site.latitude + 0.0002, longitude: site.longitude!, accuracyM: 11, state: "INSIDE", ageSeconds: 30 } : undefined;
  const ev = (eventType: string, message: string | undefined, minutesAgo: number) => ({ eventId: `qa-al-${randomUUID()}`, eventType, timestamp: subMinutes(now, minutesAgo).toISOString(), shiftId: shift.id, message, location: loc });
  await processGatewayEvents(device, [ev("SHIFT_OK", undefined, 70), ev("STATUS_UPDATE", "Patrol round 2 complete, all gates locked", 40), ev("RUNNING_LATE", undefined, 35), ev("SECURITY_ALERT", "Unknown vehicle parked at the back fence for 20 minutes", 12), ev("EMERGENCY", "Two men forcing the side gate", 3)], { ip: "127.0.0.1" });
  const late = await db.guardAlert.findFirstOrThrow({ where: { guardId: guard.id, type: "RUNNING_LATE" } });
  await acknowledgeAlert(late.id, { userId: admin.id, name: admin.name }, "Noted, relief informed");
  console.log(`seeded alerts for ${guard.firstName} ${guard.lastName} at ${site.name}; shift ${shift.id}; guard ${guard.id}`);
}
main().then(() => db.$disconnect()).catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
