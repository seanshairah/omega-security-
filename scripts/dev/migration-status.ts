/**
 * Compare the migrations in prisma/migrations with what the configured database has applied.
 * Works over Neon's HTTPS driver as well as TCP. Read-only. Exit code 1 when anything is pending
 * or unknown, so it can gate a deploy:  npm run db:migration-status
 */
import { config } from "dotenv"; config();
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

async function applied(): Promise<Map<string, { finished: boolean; checksum: string }>> {
  const url = process.env.DATABASE_URL!;
  const rows: { migration_name: string; finished_at: string | null; checksum: string }[] = [];
  if (process.env.DATABASE_OVER_HTTP === "true" || /neon\.tech/.test(url)) {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(url);
    rows.push(...((await sql.query(`SELECT migration_name, finished_at, checksum FROM "_prisma_migrations"`)) as typeof rows));
  } else {
    const { db } = await import("../../src/lib/db");
    rows.push(...(await db.$queryRawUnsafe<typeof rows>(`SELECT migration_name, finished_at, checksum FROM "_prisma_migrations"`)));
    await db.$disconnect();
  }
  return new Map(rows.map((r) => [r.migration_name, { finished: r.finished_at != null, checksum: r.checksum }]));
}

async function main() {
  const dir = join(process.cwd(), "prisma", "migrations");
  const local = readdirSync(dir).filter((d) => /^\d{14}_/.test(d) && existsSync(join(dir, d, "migration.sql"))).sort();
  const remote = await applied();
  let problems = 0;
  console.log(`database: ${process.env.DATABASE_URL?.replace(/:\/\/.*@/, "://<redacted>@")}`);
  for (const name of local) {
    const r = remote.get(name);
    const sum = createHash("sha256").update(readFileSync(join(dir, name, "migration.sql"), "utf8")).digest("hex");
    if (!r) { problems++; console.log(`  PENDING   ${name}`); }
    else if (!r.finished) { problems++; console.log(`  FAILED    ${name} (started, not finished)`); }
    else console.log(`  applied   ${name}${r.checksum && r.checksum !== sum && r.checksum.length === 64 ? "  (checksum differs: edited after apply?)" : ""}`);
  }
  for (const name of remote.keys()) if (!local.includes(name)) { problems++; console.log(`  UNKNOWN   ${name} (applied on the database, not in the repository)`); }
  console.log(problems ? `\n${problems} problem(s)` : "\nall migrations applied");
  process.exit(problems ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
