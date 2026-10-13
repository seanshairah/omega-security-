import { db } from "@/lib/db";
import { guarded, json, error } from "@/lib/api";
import { userSchema, firstIssue } from "@/lib/validation";
import { hashPassword } from "@/lib/auth/password";
import { audit } from "@/lib/audit";

const select = { id: true, name: true, email: true, role: true, title: true, phone: true, active: true, lastLoginAt: true, createdAt: true };

export const GET = guarded("SUPER_ADMIN", async () => json({ items: await db.user.findMany({ select, orderBy: { name: "asc" } }) }));

export const POST = guarded("SUPER_ADMIN", async (req, _ctx, me) => {
  const r = userSchema.safeParse(await req.json().catch(() => ({})));
  if (!r.success) return error(firstIssue(r.error));
  const d = r.data;
  if (!d.password) return error("password is required");
  const u = await db.user.create({ data: { name: d.name, email: d.email, role: d.role, title: d.title, phone: d.phone, passwordHash: await hashPassword(d.password) }, select });
  await audit({ userId: me.id, actor: me.name, action: "USER_CREATED", entity: "User", entityId: u.id, details: { email: u.email, role: u.role } });
  return json(u, 201);
});
