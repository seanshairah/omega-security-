import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { guarded, json, error, paging } from "@/lib/api";
import { incidentSchema, firstIssue } from "@/lib/validation";
import { createIncident } from "@/lib/services/incidents";

export const GET = guarded("SUPERVISOR", async (req) => {
  const url = new URL(req.url);
  const { take, skip, page } = paging(url);
  const q = url.searchParams;
  const where: Prisma.IncidentWhereInput = {};
  if (q.get("status")) where.status = q.get("status") as never;
  if (q.get("severity")) where.severity = q.get("severity") as never;
  if (q.get("guardId")) where.guardId = q.get("guardId")!;
  if (q.get("locationId")) where.locationId = q.get("locationId")!;
  const [items, total] = await Promise.all([db.incident.findMany({ where, include: { guard: true, location: true, supervisor: { select: { id: true, name: true } } }, orderBy: { occurredAt: "desc" }, take, skip }), db.incident.count({ where })]);
  return json({ items, total, page });
});

export const POST = guarded("SUPERVISOR", async (req, _ctx, user) => {
  const r = incidentSchema.safeParse(await req.json().catch(() => ({})));
  if (!r.success) return error(firstIssue(r.error));
  const d = r.data;
  const inc = await createIncident({ ...d, source: "ADMIN", occurredAt: d.occurredAt ? new Date(d.occurredAt) : new Date(), actorUserId: user.id, actorName: user.name });
  return json(inc, 201);
});
