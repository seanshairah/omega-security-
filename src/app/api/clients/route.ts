import { db } from "@/lib/db";
import { guarded, json, error } from "@/lib/api";
import { clientSchema, firstIssue } from "@/lib/validation";
import { audit } from "@/lib/audit";

export const GET = guarded("SUPERVISOR", async (req) => {
  const all = new URL(req.url).searchParams.get("active") === "all";
  return json({ items: await db.client.findMany({ where: all ? {} : { active: true }, include: { locations: { where: { active: true }, select: { id: true, name: true, code: true } } }, orderBy: { name: "asc" } }) });
});

export const POST = guarded("ADMIN", async (req, _ctx, user) => {
  const r = clientSchema.safeParse(await req.json().catch(() => ({})));
  if (!r.success) return error(firstIssue(r.error));
  const row = await db.client.create({ data: r.data });
  await audit({ userId: user.id, actor: user.name, action: "Client_CREATED".toUpperCase(), entity: "Client", entityId: row.id, details: { via: "api" } });
  return json(row, 201);
});
