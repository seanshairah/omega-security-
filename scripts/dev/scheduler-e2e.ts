/**
 * The scheduler's lease and the arrival-text retry, against a real database.
 *
 * Why these two together: on 20 October 2026 the GitHub schedule ran the engine four times in a day,
 * and the arrival texts it did send were refused by the provider and never sent again. The lease is
 * what lets device heartbeats keep the engine on time; the retry is what stops one refused text from
 * silently becoming a guard who "did not reply".
 *
 *   npx tsx scripts/dev/scheduler-e2e.ts
 */
process.env.SMS_PROVIDER = "simulated";
import { config } from "dotenv"; config();
const dbUrl = process.env.DATABASE_URL ?? "";
if (!/localhost|127\.0\.0\.1/.test(dbUrl) && process.env.ALLOW_LIVE_DB !== "1") {
  console.error("Refusing to run against a non-local DATABASE_URL.");
  process.exit(2);
}
import { addHours, addMinutes } from "date-fns";
import { db } from "../../src/lib/db";
import { createShift } from "../../src/lib/services/shifts";
import { maybeTickFromHeartbeat, runScheduledTick, schedulerStatus } from "../../src/lib/automation/scheduler";
import { alertOnFailingSms, ARRIVAL_MAX_SENDS, retryFailedArrivals } from "../../src/lib/automation/engine";

let passed = 0, failed = 0;
const check = (name: string, ok: boolean, detail = "") => { if (ok) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name} ${detail}`); } };
const TAG = "SCHED-E2E";

async function clean() {
  const guards = await db.guard.findMany({ where: { nationalId: { startsWith: TAG } }, select: { id: true } });
  const gIds = guards.map((g) => g.id);
  const sIds = (await db.shift.findMany({ where: { guardId: { in: gIds } }, select: { id: true } })).map((s) => s.id);
  await db.attendanceCheckIn.deleteMany({ where: { shiftId: { in: sIds } } });
  await db.notification.deleteMany({ where: { OR: [{ shiftId: { in: sIds } }, { type: "SMS_FAILING" }] } });
  await db.shiftCheckIn.deleteMany({ where: { shiftId: { in: sIds } } });
  await db.smsMessage.deleteMany({ where: { OR: [{ shiftId: { in: sIds } }, { guardId: { in: gIds } }] } });
  await db.attendance.deleteMany({ where: { shiftId: { in: sIds } } });
  await db.shift.deleteMany({ where: { id: { in: sIds } } });
  await db.guard.deleteMany({ where: { id: { in: gIds } } });
  await db.location.deleteMany({ where: { code: { startsWith: TAG } } });
  await db.client.deleteMany({ where: { code: { startsWith: TAG } } });
}

async function main() {
  await clean();
  await db.schedulerLease.deleteMany({ where: { name: "automation" } });

  console.log("lease");
  const now = new Date();
  const results = await Promise.all([1, 2, 3, 4, 5].map(() => runScheduledTick("cron", now)));
  const ran = results.filter((r) => r.ran).length;
  check("five simultaneous ticks run the engine exactly once", ran === 1, `ran ${ran}`);
  check("the others say why they did not run", results.filter((r) => !r.ran).every((r) => !r.ran && (r.reason === "busy" || r.reason === "recent")));

  const again = await runScheduledTick("heartbeat", addMinutes(now, 0.5));
  check("a heartbeat 30 s after a run does not run it again", !again.ran);
  const later = await runScheduledTick("heartbeat", addMinutes(now, 1));
  check("a heartbeat a minute later does", later.ran);
  const manual = await runScheduledTick("manual", addMinutes(now, 1.1));
  check("an admin's run-now is not held back by the one-minute spacing", manual.ran);

  // A run whose instance died leaves its lease behind; it must not block the engine for ever.
  await db.schedulerLease.update({ where: { name: "automation" }, data: { holder: "dead", leaseUntil: addMinutes(now, 1.5) } });
  const blocked = await runScheduledTick("manual", addMinutes(now, 1.2));
  check("a live lease blocks a second run", !blocked.ran && blocked.reason === "busy");
  const recovered = await runScheduledTick("manual", addMinutes(now, 2));
  check("an expired lease is taken over", recovered.ran);

  const st = await schedulerStatus(addMinutes(now, 2.5));
  check("status reports the last run and its source", st.lastRunAt !== null && st.lastSource === "manual" && st.behind === false, JSON.stringify(st));
  const stale = await schedulerStatus(addMinutes(now, 10));
  check("status says behind after five minutes without a run", stale.behind === true);

  await db.schedulerLease.update({ where: { name: "automation" }, data: { lastRunAt: addMinutes(new Date(), -5) } });
  await maybeTickFromHeartbeat();
  const after = await db.schedulerLease.findUniqueOrThrow({ where: { name: "automation" } });
  check("a heartbeat runs the engine when it has fallen behind", after.lastSource === "heartbeat" && after.lastRunAt! > addMinutes(new Date(), -1));
  const before = after.lastRunAt!.getTime();
  await maybeTickFromHeartbeat();
  const unchanged = await db.schedulerLease.findUniqueOrThrow({ where: { name: "automation" } });
  check("and leaves it alone when it ran a moment ago", unchanged.lastRunAt!.getTime() === before);

  console.log("arrival retry");
  const admin = await db.user.findFirstOrThrow({ where: { role: "SUPER_ADMIN" } });
  const client = await db.client.create({ data: { code: `${TAG}-C`, name: "Scheduler Client" } });
  const site = await db.location.create({ data: { code: `${TAG}-S`, name: "Scheduler site", clientId: client.id, address: "x", supervisorId: admin.id } });
  const guard = await db.guard.create({ data: { guardNo: `${TAG}-1`, firstName: "Retry", lastName: "Guard", phone: "+263778809901", nationalId: `${TAG}-1`, dateEmployed: new Date(), homeLocationId: site.id } });
  const start = addMinutes(new Date(), -20);
  const shift = await createShift({ guardId: guard.id, locationId: site.id, supervisorId: admin.id, startAt: start, endAt: addHours(start, 8), actorUserId: admin.id, actorName: admin.name });
  await db.shift.update({ where: { id: shift.id }, data: { status: "AWAITING_ARRIVAL", pendingPrompt: "ARRIVAL", arrivalSmsSentAt: start } });
  // What production recorded at 16:50 on 20 October: the text was "sent", and the provider refused it.
  await db.smsMessage.create({ data: { direction: "OUTBOUND", fromNumber: "OMEGASEC", toNumber: guard.phone, body: "Have you arrived?", type: "ARRIVAL", status: "FAILED", provider: "sendai", error: "Sendai 402: insufficient funds", guardId: guard.id, shiftId: shift.id, createdAt: addMinutes(new Date(), -10) } });

  const r1 = await retryFailedArrivals(new Date());
  const sends1 = await db.smsMessage.findMany({ where: { shiftId: shift.id, type: "ARRIVAL" }, orderBy: { createdAt: "desc" } });
  check("a refused arrival text is sent again", r1 >= 1 && sends1.length === 2 && sends1[0].status === "SENT", `resent ${r1}, rows ${sends1.length}`);
  const line = await db.shiftCheckIn.findFirst({ where: { shiftId: shift.id, type: "ARRIVAL_SMS_SENT" }, orderBy: { at: "desc" } });
  check("the timeline says it was a re-send and why", Boolean(line?.note?.includes("sent again") && line.note.includes("insufficient funds")), line?.note ?? "");
  const r2 = await retryFailedArrivals(new Date());
  check("a delivered retry is not sent a third time", r2 === 0 || (await db.smsMessage.count({ where: { shiftId: shift.id, type: "ARRIVAL" } })) === 2);

  // Keep failing: the cap holds even when every attempt is refused.
  await db.smsMessage.updateMany({ where: { shiftId: shift.id, type: "ARRIVAL" }, data: { status: "FAILED", error: "Sendai 402: insufficient funds", createdAt: addMinutes(new Date(), -10) } });
  await retryFailedArrivals(new Date());
  await db.smsMessage.updateMany({ where: { shiftId: shift.id, type: "ARRIVAL" }, data: { status: "FAILED", createdAt: addMinutes(new Date(), -10) } });
  await retryFailedArrivals(new Date());
  const capped = await db.smsMessage.count({ where: { shiftId: shift.id, type: "ARRIVAL" } });
  check(`never more than ${ARRIVAL_MAX_SENDS} arrival texts for one shift`, capped === ARRIVAL_MAX_SENDS, `count ${capped}`);

  console.log("failing provider alert");
  await db.notification.deleteMany({ where: { type: "SMS_FAILING" } });
  await db.smsMessage.updateMany({ where: { shiftId: shift.id }, data: { createdAt: new Date() } });
  const a1 = await alertOnFailingSms(new Date());
  const a2 = await alertOnFailingSms(new Date());
  const alert = await db.notification.findFirst({ where: { type: "SMS_FAILING" } });
  check("failing texts raise one critical alert", a1 && !a2 && alert?.severity === "CRITICAL", JSON.stringify({ a1, a2 }));
  check("the alert names the provider's reason", Boolean(alert?.body.includes("insufficient funds")));

  await clean();
  console.log(`\n${passed} passed, ${failed} failed`);
  await db.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
