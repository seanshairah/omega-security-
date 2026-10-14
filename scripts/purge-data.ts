/**
 * Purge all operational and test data, keeping only settings, message templates and the super admin.
 * Deletes every other user. Run: npx tsx scripts/purge-data.ts --yes
 */
import { config as loadEnv } from "dotenv";
loadEnv();
import { db } from "../src/lib/db";
import { ensureBaseline, SUPER_ADMIN } from "../prisma/seed";

async function main() {
  if (!process.argv.includes("--yes")) { console.error("Refusing to purge without --yes"); process.exit(2); }
  console.log("Purging operational data…");
  await db.$transaction([
    db.notification.deleteMany(), db.shiftCheckIn.deleteMany(), db.welfareCheck.deleteMany(), db.incident.deleteMany(),
    db.smsMessage.deleteMany(), db.attendance.deleteMany(), db.shift.deleteMany(), db.shiftRecurrence.deleteMany(),
    db.guard.deleteMany(), db.location.deleteMany(), db.client.deleteMany(), db.pushSubscription.deleteMany(), db.auditLog.deleteMany(),
  ]);
  const removed = await db.user.deleteMany({ where: { email: { not: SUPER_ADMIN.email } } });
  console.log(`Removed ${removed.count} other user(s).`);
  await ensureBaseline();
  const users = await db.user.findMany({ select: { name: true, email: true, role: true } });
  console.log("Remaining users:", users);
  await db.auditLog.create({ data: { actor: "system", action: "DATA_PURGED", entity: "System", details: { removedUsers: removed.count } } });
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
