import { db } from "@/lib/db";
import { guarded, json, error } from "@/lib/api";
import { getSettingNumber } from "@/lib/settings";
import { effectiveStatus } from "@/lib/gateway/service";
import { createLocationRequest, describeRequest, eligibleDeviceForGuard, LocationRequestError, recentRequestsForGuard } from "@/lib/gateway/location-requests";
import { findLiveShiftForGuard } from "@/lib/services/shifts";
import { audit } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

/** The guard's device, site context and recent requests, for the location panel. Supervisors may look; only admins may ask. */
export const GET = guarded<Ctx>("SUPERVISOR", async (_req, ctx, user) => {
  const { id: guardId } = await ctx.params;
  const guard = await db.guard.findUnique({ where: { id: guardId }, select: { id: true, guardNo: true, firstName: true, lastName: true } });
  if (!guard) return error("Guard not found", 404);
  await audit({ userId: user.id, actor: user.name, action: "LOCATION_VIEWED", entity: "Guard", entityId: guardId, details: { via: "location-panel" } });
  const [device, shift, requests, offlineMinutes, accuracyMaxM] = await Promise.all([eligibleDeviceForGuard(guardId), findLiveShiftForGuard(guardId, new Date()), recentRequestsForGuard(guardId, 10), getSettingNumber("gateway.offlineMinutes"), getSettingNumber("geofence.accuracyMaxM")]);
  const site = shift?.location ?? device?.location ?? null;
  return json({
    guard: { id: guard.id, guardNo: guard.guardNo, name: `${guard.firstName} ${guard.lastName}` },
    device: device ? { id: device.id, deviceName: device.deviceName, deviceModel: device.deviceModel, appVersion: device.appVersion, status: effectiveStatus(device, offlineMinutes), lastSeenAt: device.lastSeenAt, batteryLevel: device.batteryLevel, locationPermission: device.locationPermission, mockLocationSeen: device.mockLocationSeen, lastLatitude: device.lastLatitude, lastLongitude: device.lastLongitude, lastAccuracyM: device.lastAccuracyM, lastLocationAt: device.lastLocationAt, lastLocationState: device.lastLocationState } : null,
    site: site ? { id: site.id, name: site.name, latitude: site.latitude, longitude: site.longitude, radiusM: site.geofenceRadiusM } : null,
    shift: shift ? { id: shift.id, startAt: shift.startAt, endAt: shift.endAt, status: shift.status, siteName: shift.location.name } : null,
    requests: requests.map((r) => ({ ...describeRequest(r, site, accuracyMaxM), requestedBy: r.requestedBy?.name ?? null })),
  });
});

/** Ask the guard's phone for a fresh position. Idempotent while a request is open. */
export const POST = guarded<Ctx>("ADMIN", async (req, ctx, user) => {
  const { id: guardId } = await ctx.params;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const purpose = b.purpose === "SITE_SETUP" || b.purpose === "WELFARE" ? b.purpose : "CHECK";
  const maxAccuracyM = typeof b.maxAccuracyM === "number" && Number.isFinite(b.maxAccuracyM) ? b.maxAccuracyM : undefined;
  const ttlSeconds = typeof b.ttlSeconds === "number" && Number.isFinite(b.ttlSeconds) ? b.ttlSeconds : undefined;
  const locationId = typeof b.locationId === "string" && b.locationId ? b.locationId : null;
  try {
    const { request, reused } = await createLocationRequest({ guardId, actor: { userId: user.id, name: user.name }, purpose, maxAccuracyM, ttlSeconds, locationId });
    const accuracyMaxM = await getSettingNumber("geofence.accuracyMaxM");
    return json({ request: describeRequest(request, null, accuracyMaxM), reused }, reused ? 200 : 201);
  } catch (e) {
    if (e instanceof LocationRequestError) return error(e.message, e.status);
    throw e;
  }
});
