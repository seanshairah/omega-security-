import { db } from "@/lib/db";
import { guarded, json, error } from "@/lib/api";
import { locationSchema, firstIssue } from "@/lib/validation";
import { audit } from "@/lib/audit";

export const GET = guarded("SUPERVISOR", async (req) => {
  const all = new URL(req.url).searchParams.get("active") === "all";
  return json({ items: await db.location.findMany({ where: all ? {} : { active: true }, include: { client: true, supervisor: { select: { id: true, name: true } } }, orderBy: { name: "asc" } }) });
});

export const POST = guarded("ADMIN", async (req, _ctx, user) => {
  const r = locationSchema.safeParse(await req.json().catch(() => ({})));
  if (!r.success) return error(firstIssue(r.error));
  const row = await db.location.create({ data: r.data });
  await audit({ userId: user.id, actor: user.name, action: "Location_CREATED".toUpperCase(), entity: "Location", entityId: row.id, details: { via: "api" } });
  return json(row, 201);
});
