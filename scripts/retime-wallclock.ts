/**
 * One-time correction for rows written while the server interpreted wall-clock times as UTC.
 *
 * Before the timezone fix, an administrator typing 18:00 produced the instant 18:00Z. The intent
 * was 18:00 in the company's timezone, which is 16:00Z at UTC+2. This script moves the affected
 * columns by that offset so the stored instant matches what was typed.
 *
 * It is a dry run unless you pass --apply. Always run it once without --apply and read the sample.
 *
 *   npm run db:retime                    # show what would change
 *   npm run db:retime -- --apply         # do it
 *   npm run db:retime -- --apply --undo  # move them back
 *
 * Only columns that hold a time somebody typed are moved. Columns that record when something
 * actually happened — a call, a GPS fix, an SMS, a heartbeat — are already correct instants and are
 * left alone; shifting those would make past attendance disagree with the evidence that produced it.
 *
 * Works over the Neon HTTPS driver as well as plain TCP. An earlier version used PrismaClient only,
 * which cannot reach Neon from an environment where port 5432 is closed — exactly the environment
 * this has to be run from. The HTTPS path mirrors scripts/neon-migrate.ts.
 */
import { neon } from "@neondatabase/serverless";
import { PrismaClient } from "@prisma/client";
import { TZ, instantToZonedParts } from "../src/lib/time";

const APPLY = process.argv.includes("--apply");
const UNDO = process.argv.includes("--undo");
const URL = process.env.DATABASE_URL ?? "";
const OVER_HTTPS = /neon\.tech/.test(URL);

/** The columns holding a time somebody typed. Everything else is a measured instant. */
const TARGETS: [string, string][] = [
  ["Shift", "startAt"],
  ["Shift", "endAt"],
  ["AttendanceCheckIn", "scheduledStartAt"],
];

type Row = Record<string, unknown>;
type Db = { query: (sql: string, params?: unknown[]) => Promise<Row[]>; tx: (stmts: [string, unknown[]][]) => Promise<number[]>; close: () => Promise<void> };

function connect(): Db {
  if (OVER_HTTPS) {
    const sql = neon(URL);
    return {
      query: async (q, p = []) => (await sql.query(q, p)) as Row[],
      // The Neon HTTP driver sends an array of statements as one transaction, so the updates
      // still apply all-or-nothing.
      tx: async (stmts) => {
        const res = await sql.transaction(stmts.map(([q, p]) => sql.query(q, p)));
        return res.map((r) => (Array.isArray(r) ? r.length : 0));
      },
      close: async () => {},
    };
  }
  const db = new PrismaClient();
  return {
    query: async (q, p = []) => (await db.$queryRawUnsafe(q, ...p)) as Row[],
    tx: async (stmts) => db.$transaction(stmts.map(([q, p]) => db.$executeRawUnsafe(q, ...p))),
    close: () => db.$disconnect(),
  };
}

/** Hours the company timezone is ahead of UTC right now. */
function offsetHours(): number {
  const now = new Date();
  const z = instantToZonedParts(now, TZ);
  const asUtc = Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute);
  return Math.round((asUtc - now.getTime()) / 3_600_000);
}

async function main() {
  const db = connect();
  const hours = offsetHours();
  if (hours === 0) {
    console.log(`${TZ} is UTC+0; there is nothing to correct.`);
    return;
  }
  const shiftHours = UNDO ? hours : -hours;
  const interval = `${shiftHours < 0 ? "-" : "+"}${Math.abs(shiftHours)} hours`;

  console.log(`Timezone      : ${TZ} (UTC${hours >= 0 ? "+" : ""}${hours})`);
  console.log(`Transport     : ${OVER_HTTPS ? "Neon over HTTPS" : "TCP"}`);
  console.log(`Direction     : ${UNDO ? "undo (back to wall-clock-as-UTC)" : "correct (wall-clock -> true instant)"}`);
  console.log(`Shift applied : ${interval}`);
  console.log(`Mode          : ${APPLY ? "APPLY — rows will be written" : "dry run — nothing is written"}\n`);

  const before = await db.query(
    `SELECT to_char("startAt" AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI') AS before,
            to_char(("startAt" + $1::interval) AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI') AS after,
            count(*)::int AS n
     FROM "Shift" GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 6`, [interval]);
  console.log("Shift.startAt, as stored in UTC:");
  for (const r of before) console.log(`  ${r.before}Z  ->  ${r.after}Z   (${r.n} shift${r.n === 1 ? "" : "s"})`);

  const counts = await db.query(
    `SELECT (SELECT count(*)::int FROM "Shift") AS shifts,
            (SELECT count(*)::int FROM "AttendanceCheckIn") AS checkins`);
  console.log(`\nRows in scope: ${counts[0].shifts} shifts, ${counts[0].checkins} check-in expectations.`);
  console.log("Left alone (already true instants): CallLog, LocationEvent, SmsMessage, WelfareCheck.sentAt,");
  console.log("WelfareCheck.respondedAt, GatewayDevice heartbeats, Attendance.arrivalConfirmedAt.");

  // Verify every column exists before offering to write. A dry run that cannot fail the way the
  // real run fails is not a dry run: the first version of this script named a WelfareCheck column
  // that does not exist, and only found out half way through writing.
  const missing: string[] = [];
  for (const [table, col] of TARGETS) {
    const found = await db.query(
      `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`, [table, col]);
    if (Number(found[0].n) === 0) missing.push(`${table}.${col}`);
  }
  if (missing.length) {
    console.error(`\nThese columns do not exist: ${missing.join(", ")}. Nothing was written.`);
    process.exit(1);
  }
  console.log(`Columns verified: ${TARGETS.map(([t, c]) => `${t}.${c}`).join(", ")}`);

  if (!APPLY) {
    console.log("\nDry run only. Re-run with --apply to write these changes.");
    await db.close();
    return;
  }

  // One transaction. An earlier version ran the updates separately, and when the second failed it
  // left the database with shifts moved and everything else not — the worst possible state.
  await db.tx([
    [`UPDATE "Shift" SET "startAt" = "startAt" + $1::interval, "endAt" = "endAt" + $1::interval`, [interval]],
    [`UPDATE "AttendanceCheckIn" SET "scheduledStartAt" = "scheduledStartAt" + $1::interval`, [interval]],
  ]);

  const after = await db.query(
    `SELECT to_char("startAt" AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI') AS t, count(*)::int AS n
     FROM "Shift" GROUP BY 1 ORDER BY 2 DESC LIMIT 6`);
  console.log("\nApplied. Shift.startAt now:");
  for (const r of after) console.log(`  ${r.t}Z   (${r.n} shift${r.n === 1 ? "" : "s"})`);
  await db.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
