import { config } from "dotenv"; config();
import { db } from "../../src/lib/db";
(async () => {
  console.log("devices:", JSON.stringify(await db.gatewayDevice.findMany({ select: { id: true, deviceName: true, mode: true, status: true, activationStatus: true, appVersion: true, androidVersion: true, deviceModel: true, locationPermission: true, callPermission: true, monitoringState: true, lastSeenAt: true, lastLocationAt: true, lastLocationState: true, lastAccuracyM: true, batteryLevel: true, guard: { select: { firstName: true, lastName: true } }, location: { select: { name: true } } } }), null, 1));
  console.log("sites:", JSON.stringify(await db.location.findMany({ select: { code: true, name: true, latitude: true, longitude: true, geofenceRadiusM: true, updatedAt: true } })));
  const ev = await db.locationEvent.findMany({ orderBy: { occurredAt: "desc" }, take: 25, select: { occurredAt: true, receivedAt: true, eventType: true, locationState: true, distanceM: true, accuracyM: true, reason: true, provider: true, syncStatus: true, metadata: true, location: { select: { name: true } } } });
  for (const e of ev) console.log(e.occurredAt.toISOString(), e.eventType, e.locationState, e.distanceM, e.accuracyM, e.reason, e.provider, e.syncStatus, e.location?.name, JSON.stringify(e.metadata));
  console.log("gateway events:", (await db.gatewayEvent.findMany({ orderBy: { receivedAt: "desc" }, take: 15, select: { receivedAt: true, eventType: true, outcome: true } })).map((g) => `${g.receivedAt.toISOString()} ${g.eventType} → ${g.outcome}`).join("\n"));
  console.log("calls:", (await db.callLog.findMany({ orderBy: { startedAt: "desc" }, take: 10, select: { startedAt: true, direction: true, status: true, normalizedPhoneNumber: true, durationSeconds: true, gateway: { select: { deviceName: true, mode: true } } } })).map((c) => `${c.startedAt.toISOString()} ${c.gateway.mode} ${c.direction} ${c.status} ${c.normalizedPhoneNumber} ${c.durationSeconds}`).join("\n"));
  console.log("shifts active:", JSON.stringify(await db.shift.findMany({ where: { status: { notIn: ["COMPLETED", "MISSED", "CANCELLED"] } }, select: { id: true, status: true, startAt: true, endAt: true, guard: { select: { firstName: true, lastName: true, deviceKind: true } }, location: { select: { code: true, name: true } }, attendance: { select: { status: true, locationVerification: true } } } })));
  console.log("settings:", JSON.stringify(await db.setting.findMany({ where: { key: { startsWith: "geofence" } }, select: { key: true, value: true } })));
  await db.$disconnect();
})();
