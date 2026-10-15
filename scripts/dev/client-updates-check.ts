/** Exercise client site-status updates end to end with the simulated provider, then remove everything it created. */
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
import { processIncomingMessage } from "../../src/lib/sms/pipeline";
import { shiftInclude } from "../../src/lib/services/shifts";

async function main() {
  await cleanup();
  const admin = await db.user.findFirstOrThrow({ where: { role: "SUPER_ADMIN" } });
  const client = await db.client.create({ data: { code: "QA-CU", name: "QA Client", contactPhone: "+263242000111" } });
  const loc = await db.location.create({ data: { code: "QA-CU-01", name: "QA Site", clientId: client.id, address: "Test", clientUpdates: true, clientUpdatePhone: "0771000222", supervisorId: admin.id } });
  const guard = await db.guard.create({ data: { guardNo: "G-QA01", firstName: "Qa", lastName: "Guard", phone: "+263779000333", nationalId: "QA-1", dateEmployed: new Date(), homeLocationId: loc.id } });
  const now = new Date();
  const shift = await db.shift.create({ data: { guardId: guard.id, locationId: loc.id, startAt: subMinutes(now, 5), endAt: addHours(now, 8), durationMinutes: 485, status: "AWAITING_ARRIVAL", pendingPrompt: "ARRIVAL", arrivalSmsSentAt: now, attendance: { create: { status: "PENDING" } } }, include: shiftInclude });
  try {
    const r1 = await processIncomingMessage({ from: guard.phone, body: "YES", provider: "simulated" });
    console.log("arrival:", r1.action);
    await db.shift.update({ where: { id: shift.id }, data: { pendingPrompt: "WELFARE", welfareSmsSentAt: now } });
    await db.welfareCheck.create({ data: { shiftId: shift.id, sentAt: now, response: "PENDING" } });
    const r2 = await processIncomingMessage({ from: guard.phone, body: "1", provider: "simulated" });
    console.log("welfare:", r2.action);
    await db.shift.update({ where: { id: shift.id }, data: { pendingPrompt: "COMPLETION", completionSmsSentAt: now } });
    const r3 = await processIncomingMessage({ from: guard.phone, body: "YES", provider: "simulated" });
    console.log("completion:", r3.action);
    const msgs = await db.smsMessage.findMany({ where: { type: "CLIENT_UPDATE", shiftId: shift.id }, orderBy: { createdAt: "asc" } });
    for (const m of msgs) console.log(`  → ${m.toNumber} [${m.status}] ${m.body}`);
    const events = await db.shiftCheckIn.count({ where: { shiftId: shift.id, type: "CLIENT_NOTIFIED" } });
    console.log(`client updates sent: ${msgs.length}, timeline events: ${events}, client phone normalised: ${msgs.every((m) => m.toNumber === "+263771000222")}`);
    if (msgs.length !== 3 || events !== 3) throw new Error("expected 3 client updates");
  } finally {
    await cleanup();
  }
}

/** Remove everything tagged with the QA codes, whether or not this run created it. */
async function cleanup() {
  const guards = await db.guard.findMany({ where: { guardNo: "G-QA01" }, select: { id: true } });
  const gIds = guards.map((g) => g.id);
  const shifts = await db.shift.findMany({ where: { guardId: { in: gIds } }, select: { id: true } });
  const sIds = shifts.map((s) => s.id);
  const clients = await db.client.findMany({ where: { code: "QA-CU" }, select: { id: true } });
  const cIds = clients.map((c) => c.id);
  await db.$transaction([
    db.notification.deleteMany({ where: { guardId: { in: gIds } } }), db.shiftCheckIn.deleteMany({ where: { shiftId: { in: sIds } } }), db.welfareCheck.deleteMany({ where: { shiftId: { in: sIds } } }),
    db.incident.deleteMany({ where: { guardId: { in: gIds } } }), db.smsMessage.deleteMany({ where: { OR: [{ guardId: { in: gIds } }, { clientId: { in: cIds } }] } }), db.attendance.deleteMany({ where: { shiftId: { in: sIds } } }),
    db.shift.deleteMany({ where: { id: { in: sIds } } }), db.guard.deleteMany({ where: { id: { in: gIds } } }), db.location.deleteMany({ where: { code: "QA-CU-01" } }), db.client.deleteMany({ where: { id: { in: cIds } } }),
    db.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [...gIds, ...sIds] } }, { action: { in: ["SMS_SENT", "SMS_FAILED"] }, details: { path: ["to"], equals: "+263771000222" } }] } }),
  ]);
  console.log("cleaned up");
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
