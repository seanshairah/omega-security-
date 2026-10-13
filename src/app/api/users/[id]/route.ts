import { db } from "@/lib/db";
import { guarded, json, error } from "@/lib/api";
import { userSchema, firstIssue } from "@/lib/validation";
import { hashPassword } from "@/lib/auth/password";
import { audit } from "@/lib/audit";

export const PATCH = guarded<{ params: Promise<{ id: string }> }>("SUPER_ADMIN", async (req, { params }, me) => {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = userSchema.partial().safeParse(body);
  if (!r.success) return error(firstIssue(r.error));
  const d = r.data;
  if (typeof body.active === "boolean" && !body.active && id === me.id) return error("You cannot deactivate your own account.");
  const u = await db.user.update({ where: { id }, data: { name: d.name, email: d.email, role: d.role, title: d.title, phone: d.phone, ...(typeof body.active === "boolean" ? { active: body.active } : {}), ...(d.password ? { passwordHash: await hashPassword(d.password) } : {}) }, select: { id: true, name: true, email: true, role: true, active: true } });
  await audit({ userId: me.id, actor: me.name, action: "USER_UPDATED", entity: "User", entityId: id, details: { ...d, password: undefined, active: body.active } as never });
  return json(u);
});
