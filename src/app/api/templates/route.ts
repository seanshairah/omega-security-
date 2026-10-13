import { db } from "@/lib/db";
import { guarded, json, error } from "@/lib/api";
import { invalidateTemplateCache } from "@/lib/sms/templates";
import { audit } from "@/lib/audit";

export const GET = guarded("SUPERVISOR", async () => json({ items: await db.messageTemplate.findMany({ orderBy: { key: "asc" } }) }));

export const PUT = guarded("SUPER_ADMIN", async (req, _ctx, user) => {
  const b = (await req.json().catch(() => ({}))) as { key?: string; body?: string };
  if (!b.key || !b.body) return error("key and body are required");
  const t = await db.messageTemplate.update({ where: { key: b.key }, data: { body: b.body } });
  invalidateTemplateCache();
  await audit({ userId: user.id, actor: user.name, action: "TEMPLATE_UPDATED", entity: "MessageTemplate", entityId: b.key });
  return json(t);
});
