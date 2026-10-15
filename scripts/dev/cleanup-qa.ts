// Remove records created by scripts/dev/e2e.mjs (names prefixed Test / QA).
import { config } from "dotenv"; config();
// Guard rail: these scripts create and delete records by name pattern. Never run them against a production database.
const dbUrl = process.env.DATABASE_URL ?? "";
if (!/localhost|127\.0\.0\.1/.test(dbUrl) && process.env.ALLOW_LIVE_DB !== "1") {
  console.error("Refusing to run against a non-local DATABASE_URL. Set ALLOW_LIVE_DB=1 only for a database that holds no real data.");
  process.exit(2);
}
import { db } from "../../src/lib/db";
async function main() {
  const guards = await db.guard.findMany({ where: { OR: [{ lastName: { startsWith: "Guard" }, firstName: "Test" }, { firstName: "Dup" }] }, select: { id: true } });
  const gids = guards.map((g) => g.id);
  const shifts = await db.shift.findMany({ where: { guardId: { in: gids } }, select: { id: true } });
  const sids = shifts.map((s) => s.id);
  const incidents = await db.incident.findMany({ where: { OR: [{ guardId: { in: gids } }, { shiftId: { in: sids } }] }, select: { id: true } });
  const iids = incidents.map((i) => i.id);
  await db.notification.deleteMany({ where: { OR: [{ guardId: { in: gids } }, { shiftId: { in: sids } }, { incidentId: { in: iids } }] } });
  await db.shiftCheckIn.deleteMany({ where: { OR: [{ guardId: { in: gids } }, { shiftId: { in: sids } }] } });
  await db.welfareCheck.deleteMany({ where: { shiftId: { in: sids } } });
  await db.incident.deleteMany({ where: { id: { in: iids } } });
  await db.smsMessage.deleteMany({ where: { OR: [{ guardId: { in: gids } }, { shiftId: { in: sids } }, { body: { contains: "Compose test" } }, { body: { startsWith: "Test " } }] } });
  await db.attendance.deleteMany({ where: { shiftId: { in: sids } } });
  await db.shift.deleteMany({ where: { id: { in: sids } } });
  await db.shiftRecurrence.deleteMany({ where: { guardId: { in: gids } } });
  await db.guard.deleteMany({ where: { id: { in: gids } } });
  const locs = await db.location.findMany({ where: { name: { startsWith: "Test Site" } }, select: { id: true } });
  await db.shift.deleteMany({ where: { locationId: { in: locs.map((l) => l.id) } } });
  await db.location.deleteMany({ where: { id: { in: locs.map((l) => l.id) } } });
  await db.client.deleteMany({ where: { name: { startsWith: "Test Client" } } });
  const users = await db.user.findMany({ where: { name: { startsWith: "QA User" } }, select: { id: true } });
  await db.auditLog.updateMany({ where: { userId: { in: users.map((u) => u.id) } }, data: { userId: null } });
  await db.pushSubscription.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
  await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
  await db.guard.updateMany({ where: { watched: true, watchNote: { startsWith: "New recruit" } }, data: { watched: false, watchedAt: null, watchNote: null } });
  console.log(`removed ${gids.length} guards, ${sids.length} shifts, ${iids.length} incidents, ${locs.length} sites, ${users.length} users`);
}
main().finally(() => db.$disconnect());
