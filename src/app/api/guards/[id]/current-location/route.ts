import { guarded, json, error } from "@/lib/api";
import { db } from "@/lib/db";
import { freshness } from "@/lib/geofence";
import { audit } from "@/lib/audit";
import { eligibleDeviceForGuard } from "@/lib/gateway/location-requests";

/** Latest known fix for a guard, labelled LIVE / RECENT / STALE / SYNCED LATE. Reads are audited: location is sensitive. */
export const GET = guarded<{ params: Promise<{ id: string }> }>("SUPERVISOR", async (_req, ctx, user) => {
  const { id } = await ctx.params;
  const guard = await db.guard.findUnique({ where: { id }, select: { id: true, firstName: true, lastName: true, deviceKind: true } });
  if (!guard) return error("Guard not found", 404);
  const device = await eligibleDeviceForGuard(id); // the same selection every guard panel uses
  const last = await db.locationEvent.findFirst({ where: { guardId: id, latitude: { not: null } }, orderBy: { occurredAt: "desc" } });
  await audit({ userId: user.id, actor: user.name, action: "LOCATION_VIEWED", entity: "Guard", entityId: id, details: { via: "api" } });
  const at = last?.occurredAt ?? device?.lastLocationAt ?? null;
  return json({ guardId: id, deviceKind: guard.deviceKind, device: device ? { id: device.id, status: device.status, lastSeenAt: device.lastSeenAt, monitoringState: device.monitoringState, locationPermission: device.locationPermission } : null, location: last ? { latitude: last.latitude, longitude: last.longitude, accuracyM: last.accuracyM, state: last.locationState, distanceM: last.distanceM, at: last.occurredAt, syncStatus: last.syncStatus, eventType: last.eventType } : null, freshness: freshness(at, new Date(), last?.syncStatus) });
});
