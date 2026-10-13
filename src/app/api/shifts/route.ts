import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { addDays } from "date-fns";
import { guarded, json, error, paging } from "@/lib/api";
import { shiftSchema, firstIssue } from "@/lib/validation";
import { combineDateTime } from "@/lib/time";
import { createShift, shiftInclude } from "@/lib/services/shifts";

export const GET = guarded("SUPERVISOR", async (req) => {
  const url = new URL(req.url);
  const { take, skip, page } = paging(url);
  const q = url.searchParams;
  const where: Prisma.ShiftWhereInput = {};
  if (q.get("from")) where.startAt = { ...(where.startAt as object), gte: new Date(q.get("from")!) };
  if (q.get("to")) where.startAt = { ...(where.startAt as object), lte: new Date(q.get("to")!) };
  if (q.get("status")) where.status = q.get("status") as never;
  if (q.get("guardId")) where.guardId = q.get("guardId")!;
  if (q.get("locationId")) where.locationId = q.get("locationId")!;
  const [items, total] = await Promise.all([db.shift.findMany({ where, include: shiftInclude, orderBy: { startAt: "desc" }, take, skip }), db.shift.count({ where })]);
  return json({ items, total, page });
});

export const POST = guarded("ADMIN", async (req, _ctx, user) => {
  const r = shiftSchema.safeParse(await req.json().catch(() => ({})));
  if (!r.success) return error(firstIssue(r.error));
  const d = r.data;
  const startAt = combineDateTime(d.date, d.startTime);
  let endAt = combineDateTime(d.date, d.endTime);
  if (endAt <= startAt) endAt = addDays(endAt, 1);
  const shift = await createShift({ guardId: d.guardId, locationId: d.locationId, supervisorId: d.supervisorId, startAt, endAt, instructions: d.instructions, notes: d.notes, actorUserId: user.id, actorName: user.name });
  return json(shift, 201);
});
