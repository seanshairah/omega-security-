import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { guarded, json, paging } from "@/lib/api";

export const GET = guarded("SUPER_ADMIN", async (req) => {
  const url = new URL(req.url);
  const { take, skip, page } = paging(url);
  const where: Prisma.AuditLogWhereInput = {};
  if (url.searchParams.get("action")) where.action = url.searchParams.get("action")!;
  if (url.searchParams.get("userId")) where.userId = url.searchParams.get("userId")!;
  const [items, total] = await Promise.all([db.auditLog.findMany({ where, include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" }, take, skip }), db.auditLog.count({ where })]);
  return json({ items, total, page });
});
