/**
 * One-time correction for rows written while the server interpreted wall-clock times as UTC.
 *
 * Before the timezone fix, an administrator typing 18:00 produced the instant 18:00Z. The intent
 * was 18:00 in the company's timezone, which is 16:00Z at UTC+2. This script moves the affected
 * columns by that offset so the stored instant matches what was typed.
 *
 * It is a dry run unless you pass --apply. Always run it once without --apply and read the sample.
 *
 *   npx tsx scripts/retime-wallclock.ts                 # show what would change
 *   npx tsx scripts/retime-wallclock.ts --apply         # do it
 *   npx tsx scripts/retime-wallclock.ts --apply --undo  # move them back
 *
 * Only columns that hold a time somebody typed are moved. Columns that record when something
 * actually happened — a call, a GPS fix, an SMS, a heartbeat — are already correct instants and are
 * left alone; shifting those would corrupt real measurements.
 */
import { PrismaClient } from "@prisma/client";
import { TZ, instantToZonedParts } from "../src/lib/time";

const db = new PrismaClient();

/** The columns holding a time somebody typed. Everything else is a measured instant. */
const TARGETS: [string, string][] = [
  ["Shift", "startAt"],
  ["Shift", "endAt"],
  ["AttendanceCheckIn", "scheduledStartAt"],
];
const APPLY = process.argv.includes("--apply");
const UNDO = process.argv.includes("--undo");

/** Hours the company timezone is ahead of UTC right now. */
function offsetHours(): number {
  const now = new Date();
  const z = instantToZonedParts(now, TZ);
  const asUtc = Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute);
  return Math.round((asUtc - now.getTime()) / 3_600_000);
}

async function main() {
  const hours = offsetHours();
  if (hours === 0) {
    console.log(`${TZ} is UTC+0; there is nothing to correct.`);
    return;
  }
  const shiftBy = (UNDO ? hours : -hours) * 3_600_000;
  const sign = shiftBy < 0 ? "-" : "+";
  const interval = `${sign}${Math.abs(shiftBy) / 3_600_000} hours`;

  console.log(`Timezone      : ${TZ} (UTC${hours >= 0 ? "+" : ""}${hours})`);
  console.log(`Direction     : ${UNDO ? "undo (back to wall-clock-as-UTC)" : "correct (wall-clock -> true instant)"}`);
  console.log(`Shift applied : ${interval}`);
  console.log(`Mode          : ${APPLY ? "APPLY — rows will be written" : "dry run — nothing is written"}\n`);

  const before = await db.shift.findMany({
    select: { id: true, startAt: true, endAt: true },
    orderBy: { startAt: "asc" }, take: 5,
  });
  console.log("Sample of Shift.startAt before:");
  for (const s of before) console.log(`  ${s.startAt.toISOString()}  -> would become ${new Date(s.startAt.getTime() + shiftBy).toISOString()}`);

  console.log(`\nRows in scope: ${await db.shift.count()} shifts, ${await db.attendanceCheckIn.count()} check-in expectations.`);
  console.log("Left alone (already true instants): CallLog, LocationEvent, SmsMessage, WelfareCheck.sentAt,");
  console.log("WelfareCheck.respondedAt, GatewayDevice heartbeats, Attendance.arrivalConfirmedAt.");

  // Verify every column exists before offering to write. A dry run that cannot fail the way the
  // real run fails is not a dry run: the first version of this script named a WelfareCheck column
  // that does not exist, and only found out half way through writing.
  const missing: string[] = [];
  for (const [table, col] of TARGETS) {
    const found = await db.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`, table, col);
    if (Number(found[0].n) === 0) missing.push(`${table}.${col}`);
  }
  if (missing.length) {
    console.error(`\nThese columns do not exist: ${missing.join(", ")}. Nothing was written.`);
    process.exit(1);
  }
  console.log(`Columns verified: ${TARGETS.map(([t, c]) => `${t}.${c}`).join(", ")}`);

  if (!APPLY) {
    console.log("\nDry run only. Re-run with --apply to write these changes.");
    return;
  }

  // One transaction. An earlier version ran the updates separately, and when the second failed it
  // left the database with shifts moved and everything else not — the worst possible state.
  const iv = `${interval}`;
  const [r1, r2] = await db.$transaction([
    db.$executeRawUnsafe(`UPDATE "Shift" SET "startAt" = "startAt" + $1::interval, "endAt" = "endAt" + $1::interval`, iv),
    db.$executeRawUnsafe(`UPDATE "AttendanceCheckIn" SET "scheduledStartAt" = "scheduledStartAt" + $1::interval`, iv),
  ]);
  console.log(`\nUpdated in one transaction: ${r1} shifts, ${r2} check-in expectations.`);

  const after = await db.shift.findMany({ select: { startAt: true }, orderBy: { startAt: "asc" }, take: 5 });
  console.log("Sample of Shift.startAt after:");
  for (const s of after) console.log(`  ${s.startAt.toISOString()}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
