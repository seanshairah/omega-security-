/**
 * Apply prisma/migrations/*.sql to a Neon database over HTTPS (port 443), for environments
 * where port 5432 is not reachable. Records each migration in _prisma_migrations so that
 * `prisma migrate deploy` stays in sync later. Usage: npx tsx scripts/neon-migrate.ts
 */
import { neon } from "@neondatabase/serverless";
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { config } from "dotenv";
config();

const url = process.env.DATABASE_URL!;
const sql = neon(url);

function splitStatements(text: string): string[] {
  return text.split(/;\s*\n/).map((s) => s.replace(/^--.*$/gm, "").trim()).filter(Boolean);
}

async function main() {
  await sql.query(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    id varchar(36) PRIMARY KEY, checksum varchar(64) NOT NULL, finished_at timestamptz, migration_name varchar(255) NOT NULL,
    logs text, rolled_back_at timestamptz, started_at timestamptz NOT NULL DEFAULT now(), applied_steps_count integer NOT NULL DEFAULT 0)`);
  const applied = new Set(((await sql.query(`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`)) as { migration_name: string }[]).map((r) => r.migration_name));
  const dir = join(process.cwd(), "prisma", "migrations");
  for (const name of readdirSync(dir).filter((d) => /^\d{14}_/.test(d)).sort()) {
    if (applied.has(name)) { console.log(`skip ${name} (applied)`); continue; }
    const text = readFileSync(join(dir, name, "migration.sql"), "utf8");
    const checksum = createHash("sha256").update(text).digest("hex");
    const statements = splitStatements(text);
    console.log(`apply ${name}: ${statements.length} statements`);
    for (const st of statements) await sql.query(st);
    await sql.query(`INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count) VALUES ($1,$2,now(),$3,$4)`, [crypto.randomUUID(), checksum, name, statements.length]);
  }
  console.log("done");
}
main().catch((e) => { console.error(e); process.exit(1); });
