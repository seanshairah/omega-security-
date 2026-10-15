import { guarded, json, error } from "@/lib/api";
import { db } from "@/lib/db";

export const GET = guarded<{ params: Promise<{ id: string }> }>("SUPERVISOR", async (_req, ctx) => {
  const { id } = await ctx.params;
  const shift = await db.shift.findUnique({ where: { id }, select: { id: true, location: { select: { id: true, name: true, latitude: true, longitude: true, geofenceRadiusM: true } }, attendance: { select: { locationVerification: true, locationVerifiedAt: true } } } });
  if (!shift) return error("Shift not found", 404);
  const items = await db.locationEvent.findMany({ where: { shiftId: id }, orderBy: { occurredAt: "asc" } });
  return json({ shiftId: id, site: shift.location, attendance: shift.attendance, items });
});
