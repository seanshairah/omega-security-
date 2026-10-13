import { db } from "@/lib/db";
import { guarded, json, error } from "@/lib/api";
import { locationSchema, firstIssue } from "@/lib/validation";
import { audit } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

export const GET = guarded<Ctx>("SUPERVISOR", async (_req, { params }) => {
  const { id } = await params;
  const row = await db.location.findUnique({ where: { id }, include: { client: true, supervisor: { select: { id: true, name: true } } } });
  if (!row) return error("Location not found", 404);
  return json(row);
});

export const PATCH = guarded<Ctx>("ADMIN", async (req, { params }, user) => {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = locationSchema.partial().safeParse(body);
  if (!r.success) return error(firstIssue(r.error));
  const row = await db.location.update({ where: { id }, data: { ...r.data, ...(typeof body.active === "boolean" ? { active: body.active } : {}) } });
  await audit({ userId: user.id, actor: user.name, action: "Location_UPDATED".toUpperCase(), entity: "Location", entityId: id, details: r.data as never });
  return json(row);
});
