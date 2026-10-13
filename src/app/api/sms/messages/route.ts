import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { guarded, json, paging } from "@/lib/api";

export const GET = guarded("SUPERVISOR", async (req) => {
  const url = new URL(req.url);
  const { take, skip, page } = paging(url);
  const q = url.searchParams;
  const where: Prisma.SmsMessageWhereInput = {};
  if (q.get("guardId")) where.guardId = q.get("guardId")!;
  if (q.get("shiftId")) where.shiftId = q.get("shiftId")!;
  if (q.get("type")) where.type = q.get("type") as never;
  if (q.get("direction")) where.direction = q.get("direction") as never;
  const [items, total] = await Promise.all([
    db.smsMessage.findMany({ where, include: { guard: { select: { id: true, firstName: true, lastName: true } }, location: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" }, take, skip }),
    db.smsMessage.count({ where }),
  ]);
  return json({ items, total, page });
});
