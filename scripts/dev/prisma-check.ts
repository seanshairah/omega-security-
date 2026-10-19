/**
 * Prisma consistency check, run before a build or a deploy:
 *   1. `prisma validate` on the schema.
 *   2. The generated client's embedded schema equals prisma/schema.prisma (ignoring comments/whitespace),
 *      so the running code and the database model agree; otherwise `npx prisma generate` is required.
 *   3. Every folder in prisma/migrations has a migration.sql.
 *   4. With --db: `npm run db:migration-status` against DATABASE_URL (read-only).
 *   npx tsx scripts/dev/prisma-check.ts [--db]
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const norm = (s: string) => s.split("\n").map((l) => l.replace(/\/\/.*$/, "").replace(/\/\*\*?.*?\*\//g, "").replace(/\s+/g, " ").trim()).filter((l) => l && !l.startsWith("*") && !l.startsWith("/**")).join("\n");
let failed = 0;
const ok = (m: string) => console.log(`  ✓ ${m}`);
const bad = (m: string) => { failed++; console.log(`  ✗ ${m}`); };

try { execSync("npx prisma validate", { stdio: "pipe" }); ok("schema validates"); } catch (e) { bad(`prisma validate failed: ${(e as Error).message.split("\n")[0]}`); }

const gen = join("node_modules", ".prisma", "client", "schema.prisma");
if (!existsSync(gen)) bad("generated Prisma client not found: run `npx prisma generate`");
else if (norm(readFileSync(gen, "utf8")) === norm(readFileSync(join("prisma", "schema.prisma"), "utf8"))) ok("generated client matches prisma/schema.prisma");
else bad("generated client is STALE: run `npx prisma generate` (a running `next dev` must be restarted)");

const dirs = readdirSync(join("prisma", "migrations"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const missing = dirs.filter((d) => !existsSync(join("prisma", "migrations", d, "migration.sql")));
if (missing.length) bad(`migration folders without migration.sql: ${missing.join(", ")}`); else ok(`${dirs.length} migration folders, each with migration.sql`);

if (process.argv.includes("--db")) {
  try { execSync("npm run -s db:migration-status", { stdio: "inherit" }); ok("database migration status clean"); } catch { bad("database has pending or unknown migrations"); }
}
console.log(failed ? `\n${failed} problem(s)` : "\nPrisma is consistent");
process.exit(failed ? 1 : 0);
