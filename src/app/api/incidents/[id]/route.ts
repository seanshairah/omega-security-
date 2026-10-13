import { db } from "@/lib/db";
import { guarded, json, error } from "@/lib/api";
import { audit } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

export const GET = guarded<Ctx>("SUPERVISOR", async (_req, { params }) => {
  const { id } = await params;
  const inc = await db.incident.findUnique({ where: { id }, include: { guard: true, location: { include: { client: true } }, shift: true, supervisor: { select: { id: true, name: true } } } });
  if (!inc) return error("Incident not found", 404);
  return json(inc);
});

export const PATCH = guarded<Ctx>("SUPERVISOR", async (req, { params }, user) => {
  const { id } = await params;
  const b = (await req.json().catch(() => ({}))) as { status?: "ACKNOWLEDGED" | "RESOLVED" | "CLOSED"; resolutionNotes?: string; severity?: string; category?: string };
  const now = new Date();
  const inc = await db.incident.update({ where: { id }, data: {
    status: b.status, severity: b.severity as never, category: b.category as never, resolutionNotes: b.resolutionNotes,
    acknowledgedAt: b.status === "ACKNOWLEDGED" ? now : undefined, resolvedAt: b.status === "RESOLVED" ? now : undefined, supervisorId: b.status ? user.id : undefined,
  } });
  await audit({ userId: user.id, actor: user.name, action: `INCIDENT_${b.status ?? "UPDATED"}`, entity: "Incident", entityId: id, details: b as never });
  return json(inc);
});
