import { db } from "@/lib/db";
import { guarded, json } from "@/lib/api";
import { shiftInclude, LIVE_STATUSES } from "@/lib/services/shifts";

export const GET = guarded("SUPERVISOR", async () => {
  const items = await db.shift.findMany({ where: { status: { in: LIVE_STATUSES } }, include: { ...shiftInclude, welfareChecks: { orderBy: { sentAt: "desc" }, take: 1 } }, orderBy: { startAt: "asc" } });
  return json({ items });
});
