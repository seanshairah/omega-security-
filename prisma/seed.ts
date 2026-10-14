/**
 * Production seed for Omega Protection Services. Safe to run repeatedly.
 * Creates the settings and message templates that are missing and the single super admin.
 * Never touches operational data. Run: npm run db:seed
 *   ADMIN_PASSWORD=…  password for the super admin (required on first run; later runs leave it alone)
 */
import { config as loadEnv } from "dotenv";
loadEnv();
import bcrypt from "bcryptjs";
import { TEMPLATE_DEFS } from "../src/lib/sms/templates";
import { SETTING_DEFS } from "../src/lib/settings";
import { db } from "../src/lib/db";

export const SUPER_ADMIN = { name: "Mr Kudzu Felix Zveshure", email: "admin@omegasecurity.co.zw", title: "Managing Director", phone: "+263772100100", avatarUrl: "/avatars/admin.svg" };

export async function ensureBaseline() {
  for (const s of SETTING_DEFS) {
    await db.setting.upsert({ where: { key: s.key }, update: { label: s.label, description: s.description, group: s.group }, create: { key: s.key, value: s.default, label: s.label, description: s.description, group: s.group } });
  }
  for (const t of TEMPLATE_DEFS) {
    await db.messageTemplate.upsert({ where: { key: t.key }, update: { name: t.name, description: t.description, variables: t.variables }, create: { key: t.key, name: t.name, description: t.description, body: t.body, variables: t.variables } });
  }
  const existing = await db.user.findUnique({ where: { email: SUPER_ADMIN.email } });
  if (existing) {
    await db.user.update({ where: { id: existing.id }, data: { name: SUPER_ADMIN.name, role: "SUPER_ADMIN", title: SUPER_ADMIN.title, active: true } });
    return existing.id;
  }
  const password = process.env.ADMIN_PASSWORD;
  if (!password) throw new Error("ADMIN_PASSWORD is required to create the super admin.");
  const u = await db.user.create({ data: { ...SUPER_ADMIN, role: "SUPER_ADMIN", passwordHash: await bcrypt.hash(password, 10) } });
  return u.id;
}

if (process.argv[1]?.endsWith("seed.ts")) {
  ensureBaseline()
    .then(() => console.log("Baseline ready: settings, templates and the super admin."))
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => db.$disconnect());
}
