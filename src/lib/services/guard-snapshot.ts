/**
 * One small, cheap read per guard for the workspace header, the location block and the map:
 * the eligible phone (one selection rule for every panel), the live shift and its site, the
 * latest location request, and the four-concept presentation. Polled by the client every 15 s,
 * so it must stay a handful of indexed queries and never touch feeds or tables.
 */
import { db } from "@/lib/db";
import { getSettingNumber } from "@/lib/settings";
import { effectiveStatus } from "@/lib/gateway/service";
import { eligibleDeviceForGuard, describeRequest, expireStaleRequests } from "@/lib/gateway/location-requests";
import { findLiveShiftForGuard } from "@/lib/services/shifts";
import { presentGuardLocation } from "@/lib/guard-status";

export async function guardSnapshot(guardId: string, now = new Date()) {
  const guard = await db.guard.findUnique({ where: { id: guardId }, select: { id: true, guardNo: true, firstName: true, lastName: true, phone: true, deviceKind: true, watched: true, active: true, homeLocation: { select: { id: true, name: true, latitude: true, longitude: true, geofenceRadiusM: true } } } });
  if (!guard) return null;
  await expireStaleRequests(now);
  const [device, shift, lastRequest, lastCompleted, offlineMinutes, accuracyMaxM, openAlerts] = await Promise.all([
    eligibleDeviceForGuard(guardId),
    findLiveShiftForGuard(guardId, now),
    db.deviceLocationRequest.findFirst({ where: { guardId }, orderBy: { requestedAt: "desc" }, include: { requestedBy: { select: { name: true } } } }),
    db.deviceLocationRequest.findFirst({ where: { guardId, status: "COMPLETED", mock: false, latitude: { not: null } }, orderBy: { capturedAt: "desc" } }), // a mock fix never stands for the position; it is still shown on the request row
    getSettingNumber("gateway.offlineMinutes"),
    getSettingNumber("geofence.accuracyMaxM"),
    db.guardAlert.count({ where: { guardId, status: "OPEN" } }),
  ]);
  const siteRow = shift?.location ?? device?.location ?? guard.homeLocation ?? null;
  const site = siteRow ? { id: siteRow.id, name: siteRow.name, latitude: siteRow.latitude, longitude: siteRow.longitude, radiusM: siteRow.geofenceRadiusM } : null;
  const presentation = presentGuardLocation({
    device: device ? { status: device.status, activationStatus: device.activationStatus, lastSeenAt: device.lastSeenAt, shiftState: device.shiftState, gpsState: device.gpsState, gpsReason: device.gpsReason, monitoringState: device.monitoringState, lastLatitude: device.lastLatitude, lastLongitude: device.lastLongitude, lastAccuracyM: device.lastAccuracyM, lastLocationAt: device.lastLocationAt, locationPermission: device.locationPermission, mockLocationSeen: device.mockLocationSeen } : null,
    lastRequest: lastCompleted ? { status: lastCompleted.status, latitude: lastCompleted.latitude, longitude: lastCompleted.longitude, accuracyM: lastCompleted.accuracyM, capturedAt: lastCompleted.capturedAt, mock: lastCompleted.mock } : null,
    site, offlineMinutes, accuracyMaxM, now,
  });
  return {
    serverTime: now.toISOString(),
    guard: { id: guard.id, guardNo: guard.guardNo, name: `${guard.firstName} ${guard.lastName}`, phone: guard.phone, deviceKind: guard.deviceKind, watched: guard.watched, active: guard.active },
    device: device ? { id: device.id, deviceName: device.deviceName, deviceModel: device.deviceModel, appVersion: device.appVersion, batteryLevel: device.batteryLevel, locationPermission: device.locationPermission, lastSeenAt: device.lastSeenAt, status: effectiveStatus(device, offlineMinutes, now), mockLocationSeen: device.mockLocationSeen, syncState: device.syncState, queuedEvents: device.queuedEvents, buildType: device.buildType, secureStorage: device.secureStorage, networkType: device.networkType } : null,
    shift: shift ? { id: shift.id, startAt: shift.startAt, endAt: shift.endAt, status: shift.status, siteId: shift.location.id, siteName: shift.location.name } : null,
    site,
    presentation,
    request: lastRequest ? { ...describeRequest(lastRequest, siteRow ? { name: siteRow.name, latitude: siteRow.latitude, longitude: siteRow.longitude, geofenceRadiusM: siteRow.geofenceRadiusM } : null, accuracyMaxM, now), requestedBy: lastRequest.requestedBy?.name ?? null } : null,
    openAlerts,
    limits: { offlineMinutes, accuracyMaxM },
  };
}
export type GuardSnapshot = NonNullable<Awaited<ReturnType<typeof guardSnapshot>>>;
