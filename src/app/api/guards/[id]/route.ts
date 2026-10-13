import { db } from "@/lib/db";
import { guarded, json, error } from "@/lib/api";
import { guardSchema, firstIssue } from "@/lib/validation";
import { guardPerformance } from "@/lib/services/guards";
import { audit } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

export const GET = guarded<Ctx>("SUPERVISOR", async (_req, { params }) => {
  const { id } = await params;
  const guard = await db.guard.findUnique({ where: { id }, include: { homeLocation: true, supervisor: { select: { id: true, name: true } }, shifts: { include: { location: true, attendance: true }, orderBy: { startAt: "desc" }, take: 30 }, incidents: { orderBy: { occurredAt: "desc" }, take: 20 } } });
  if (!guard) return error("Guard not found", 404);
  return json({ ...guard, performance: await guardPerformance(id) });
});

export const PATCH = guarded<Ctx>("ADMIN", async (req, { params }, user) => {
  const { id } = await params;
  const r = guardSchema.partial().safeParse(await req.json().catch(() => ({})));
  if (!r.success) return error(firstIssue(r.error));
  const d = r.data;
  const guard = await db.guard.update({ where: { id }, data: { ...d, dateOfBirth: d.dateOfBirth ? new Date(d.dateOfBirth) : undefined, dateEmployed: d.dateEmployed ? new Date(d.dateEmployed) : undefined } });
  await audit({ userId: user.id, actor: user.name, action: "GUARD_UPDATED", entity: "Guard", entityId: id, details: d as never });
  return json(guard);
});
