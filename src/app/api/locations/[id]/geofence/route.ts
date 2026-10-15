import { guarded, json, error } from "@/lib/api";
import { db } from "@/lib/db";

export const GET = guarded<{ params: Promise<{ id: string }> }>("SUPERVISOR", async (_req, ctx) => {
  const { id } = await ctx.params;
  const l = await db.location.findUnique({ where: { id }, select: { id: true, name: true, latitude: true, longitude: true, geofenceRadiusM: true } });
  if (!l) return error("Location not found", 404);
  return json({ ...l, hasCoordinates: l.latitude != null && l.longitude != null });
});
