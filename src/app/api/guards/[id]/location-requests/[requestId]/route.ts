import { db } from "@/lib/db";
import { guarded, json, error } from "@/lib/api";
import { getSettingNumber } from "@/lib/settings";
import { cancelLocationRequest, describeRequest, expireStaleRequests, LocationRequestError } from "@/lib/gateway/location-requests";
import { findLiveShiftForGuard } from "@/lib/services/shifts";

type Ctx = { params: Promise<{ id: string; requestId: string }> };

async function load(guardId: string, requestId: string) {
  await expireStaleRequests();
  const r = await db.deviceLocationRequest.findUnique({ where: { id: requestId }, include: { gatewayDevice: { include: { location: true } }, requestedBy: { select: { name: true } } } });
  if (!r || r.guardId !== guardId) return null;
  return r;
}

async function siteFor(r: { guardId: string; locationId: string | null; gatewayDevice: { location: { id: string; name: string; latitude: number | null; longitude: number | null; geofenceRadiusM: number } | null } }) {
  if (r.locationId) { const l = await db.location.findUnique({ where: { id: r.locationId } }); if (l) return l; }
  const shift = await findLiveShiftForGuard(r.guardId, new Date());
  return shift?.location ?? r.gatewayDevice.location ?? null;
}

export const GET = guarded<Ctx>("SUPERVISOR", async (_req, ctx) => {
  const { id: guardId, requestId } = await ctx.params;
  const r = await load(guardId, requestId);
  if (!r) return error("Request not found", 404);
  const [site, accuracyMaxM] = await Promise.all([siteFor(r), getSettingNumber("geofence.accuracyMaxM")]);
  return json({ request: { ...describeRequest(r, site, accuracyMaxM), requestedBy: r.requestedBy?.name ?? null, deviceName: r.gatewayDevice.deviceName } });
});

/** Withdraw an open request. */
export const DELETE = guarded<Ctx>("ADMIN", async (_req, ctx, user) => {
  const { id: guardId, requestId } = await ctx.params;
  const r = await load(guardId, requestId);
  if (!r) return error("Request not found", 404);
  try {
    const updated = await cancelLocationRequest(r.id, { userId: user.id, name: user.name });
    return json({ request: describeRequest(updated, null, await getSettingNumber("geofence.accuracyMaxM")) });
  } catch (e) { if (e instanceof LocationRequestError) return error(e.message, e.status); throw e; }
});
