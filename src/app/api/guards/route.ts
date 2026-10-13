import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { guarded, json, error, paging } from "@/lib/api";
import { guardSchema, firstIssue } from "@/lib/validation";
import { nextGuardNo } from "@/lib/services/guards";
import { audit } from "@/lib/audit";

export const GET = guarded("SUPERVISOR", async (req) => {
  const url = new URL(req.url);
  const { take, skip, page } = paging(url);
  const q = url.searchParams.get("q")?.trim();
  const where: Prisma.GuardWhereInput = {};
  if (q) where.OR = [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }, { guardNo: { contains: q, mode: "insensitive" } }];
  if (url.searchParams.get("status")) where.employmentStatus = url.searchParams.get("status") as never;
  if (url.searchParams.get("locationId")) where.homeLocationId = url.searchParams.get("locationId")!;
  if (url.searchParams.get("active") !== "all") where.active = url.searchParams.get("active") !== "false";
  const [items, total] = await Promise.all([db.guard.findMany({ where, include: { homeLocation: true, supervisor: { select: { id: true, name: true } } }, orderBy: [{ lastName: "asc" }], take, skip }), db.guard.count({ where })]);
  return json({ items, total, page });
});

export const POST = guarded("ADMIN", async (req, _ctx, user) => {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = guardSchema.safeParse(body);
  if (!r.success) return error(firstIssue(r.error));
  const d = r.data;
  const guard = await db.guard.create({ data: { ...d, photoUrl: typeof body.photoUrl === "string" ? body.photoUrl : null, dateOfBirth: d.dateOfBirth ? new Date(d.dateOfBirth) : null, dateEmployed: d.dateEmployed ? new Date(d.dateEmployed) : null, guardNo: await nextGuardNo() } });
  await audit({ userId: user.id, actor: user.name, action: "GUARD_CREATED", entity: "Guard", entityId: guard.id, details: { via: "api" } });
  return json(guard, 201);
});
