/**
 * Remote "where is this guard phone right now?" requests.
 *
 * Operations creates a DeviceLocationRequest for a registered guard phone. The phone fetches it as
 * a REQUEST_LOCATION command (heartbeat response or GET /api/gateways/commands), acknowledges
 * PROCESSING, measures a fresh fix and answers through the ordinary event outbox with a
 * LOCATION_REQUEST_RESULT event, so retries, offline queuing and replay protection are the same as
 * for every other event. Only the device the request names can answer it, and only once.
 *
 * Nothing here moves a site: a completed request is a measured position that operations may then
 * confirm as a site's coordinates in the site form (source GUARD_DEVICE).
 */
import { db } from "@/lib/db";
import type { DeviceLocationRequest, GatewayDevice, Location, Prisma } from "@prisma/client";
import { audit } from "@/lib/audit";
import { getSettingNumber } from "@/lib/settings";
import { classifyFix, haversineM } from "@/lib/geofence";
import { effectiveGeofence } from "@/lib/site-config";
import { findLiveShiftForGuard } from "@/lib/services/shifts";
import { canTransition, capturePlausible, commandFor, FAILURE_REASONS, isExpired, isOpen, REQUEST_LIMITS, type FailureReason, type LocationCommand } from "@/lib/location-request-state";
import { saneTimestamp } from "./call-state";

export const LOCATION_REQUEST_EVENT_TYPES = ["LOCATION_REQUEST_RESULT"] as const;

export type Actor = { userId: string; name: string };

export class LocationRequestError extends Error { constructor(message: string, public status = 400) { super(message); } }

/** The guard's one eligible phone: GUARD mode, activated, not disabled or revoked. */
export async function eligibleDeviceForGuard(guardId: string) {
  return db.gatewayDevice.findFirst({ where: { guardId, mode: "GUARD", activationStatus: "ACTIVE", status: { notIn: ["REVOKED", "DISABLED"] } }, orderBy: { lastSeenAt: "desc" }, include: { guard: true, location: true } });
}

export async function requestTtlSeconds() {
  const v = await getSettingNumber("location.requestTtlSeconds");
  return Math.min(REQUEST_LIMITS.ttlSecondsMax, Math.max(REQUEST_LIMITS.ttlSecondsMin, Number.isFinite(v) && v > 0 ? v : REQUEST_LIMITS.ttlSecondsDefault));
}

export async function commandPollSeconds() {
  const v = await getSettingNumber("gateway.commandPollSeconds");
  return Math.min(REQUEST_LIMITS.commandPollSecondsMax, Math.max(REQUEST_LIMITS.commandPollSecondsMin, Number.isFinite(v) && v > 0 ? v : REQUEST_LIMITS.commandPollSecondsDefault));
}

/**
 * Create (or reuse) a request. Idempotent per device: while one request is open, asking again
 * returns it instead of queueing a second GPS acquisition. Rate-limited per device per hour.
 */
export async function createLocationRequest(input: { guardId?: string; deviceId?: string; actor: Actor; purpose?: "CHECK" | "SITE_SETUP" | "WELFARE"; locationId?: string | null; maxAccuracyM?: number; ttlSeconds?: number }, now = new Date()) {
  const device = input.deviceId
    ? await db.gatewayDevice.findUnique({ where: { id: input.deviceId }, include: { guard: true, location: true } })
    : input.guardId ? await eligibleDeviceForGuard(input.guardId) : null;
  if (!device) throw new LocationRequestError(input.deviceId ? "Device not found." : "This guard has no activated Android guard phone. Only a registered guard device can report its position.", 404);
  if (device.mode !== "GUARD" || !device.guardId) throw new LocationRequestError("Only a phone in guard mode, linked to a guard, can be asked for its position.", 409);
  if (input.guardId && device.guardId !== input.guardId) throw new LocationRequestError("That device is registered to a different guard.", 403);
  if (device.activationStatus !== "ACTIVE" || device.status === "REVOKED" || device.status === "DISABLED") throw new LocationRequestError(`The device is ${device.status.toLowerCase()} and cannot be asked for its position.`, 409);

  await expireStaleRequests(now);
  const open = await db.deviceLocationRequest.findFirst({ where: { gatewayDeviceId: device.id, status: { in: ["PENDING", "DELIVERED", "PROCESSING"] } }, orderBy: { requestedAt: "desc" } });
  if (open) return { request: open, device, reused: true };

  const recent = await db.deviceLocationRequest.count({ where: { gatewayDeviceId: device.id, requestedAt: { gte: new Date(now.getTime() - 3_600_000) } } });
  if (recent >= REQUEST_LIMITS.perDevicePerHour) throw new LocationRequestError(`Too many location requests to this phone in the last hour (${recent}). Wait before asking again.`, 429);

  const ttl = Math.min(REQUEST_LIMITS.ttlSecondsMax, Math.max(REQUEST_LIMITS.ttlSecondsMin, input.ttlSeconds ?? (await requestTtlSeconds())));
  const defaultAcc = await getSettingNumber("geofence.accuracyMaxM");
  const maxAccuracyM = Math.round(Math.min(REQUEST_LIMITS.maxAccuracyMMax, Math.max(REQUEST_LIMITS.maxAccuracyMMin, input.maxAccuracyM ?? (Number.isFinite(defaultAcc) && defaultAcc > 0 ? defaultAcc : REQUEST_LIMITS.maxAccuracyMDefault))));
  const request = await db.deviceLocationRequest.create({ data: { gatewayDeviceId: device.id, guardId: device.guardId, requestedById: input.actor.userId, locationId: input.locationId ?? null, purpose: input.purpose ?? "CHECK", requestedAt: now, expiresAt: new Date(now.getTime() + ttl * 1000), maxAccuracyM, requireFreshFix: true } });
  await audit({ userId: input.actor.userId, actor: input.actor.name, action: "LOCATION_REQUESTED", entity: "Guard", entityId: device.guardId, details: { requestId: request.id, deviceId: device.id, purpose: request.purpose, locationId: request.locationId, maxAccuracyM, ttlSeconds: ttl } });
  return { request, device, reused: false };
}

export async function cancelLocationRequest(id: string, actor: Actor, now = new Date()) {
  const r = await db.deviceLocationRequest.findUnique({ where: { id } });
  if (!r) throw new LocationRequestError("Request not found.", 404);
  if (!canTransition(r.status, "CANCELLED")) return r;
  const updated = await db.deviceLocationRequest.update({ where: { id, status: r.status }, data: { status: "CANCELLED", completedAt: now } });
  await audit({ userId: actor.userId, actor: actor.name, action: "LOCATION_REQUEST_CANCELLED", entity: "Guard", entityId: r.guardId, details: { requestId: id } });
  return updated;
}

/** Open requests past their deadline become EXPIRED. Cheap; called on every read and by the engine. */
export async function expireStaleRequests(now = new Date()) {
  const r = await db.deviceLocationRequest.updateMany({ where: { status: { in: ["PENDING", "DELIVERED", "PROCESSING"] }, expiresAt: { lte: now } }, data: { status: "EXPIRED", completedAt: now } });
  return r.count;
}

/** Commands for this phone. Marks first delivery; a redelivery of a DELIVERED/PROCESSING request keeps its state. */
export async function pendingCommandsForDevice(device: Pick<GatewayDevice, "id" | "mode">, now = new Date()): Promise<LocationCommand[]> {
  if (device.mode !== "GUARD") return [];
  await expireStaleRequests(now);
  const open = await db.deviceLocationRequest.findMany({ where: { gatewayDeviceId: device.id, status: { in: ["PENDING", "DELIVERED", "PROCESSING"] }, expiresAt: { gt: now } }, orderBy: { requestedAt: "asc" }, take: 5 });
  const pendingIds = open.filter((r) => r.status === "PENDING").map((r) => r.id);
  if (pendingIds.length) await db.deviceLocationRequest.updateMany({ where: { id: { in: pendingIds }, status: "PENDING" }, data: { status: "DELIVERED", deliveredAt: now } });
  return open.map(commandFor);
}

/** The phone says it has started the GPS for this request. */
export async function acknowledgeProcessing(device: Pick<GatewayDevice, "id">, requestId: string, now = new Date()) {
  const r = await db.deviceLocationRequest.findUnique({ where: { id: requestId } });
  if (!r || r.gatewayDeviceId !== device.id) throw new LocationRequestError("Unknown request for this device.", 404);
  if (isExpired(r, now) && isOpen(r.status)) { await expireStaleRequests(now); return { ...r, status: "EXPIRED" as const }; }
  if (!canTransition(r.status, "PROCESSING")) return r;
  return db.deviceLocationRequest.update({ where: { id: r.id, status: r.status }, data: { status: "PROCESSING", processingAt: now, deliveredAt: r.deliveredAt ?? now } });
}

export type IncomingLocationRequestResult = {
  eventId: string; eventType: "LOCATION_REQUEST_RESULT"; timestamp: string | Date;
  requestId: string; status: "COMPLETED" | "FAILED";
  latitude?: number; longitude?: number; accuracyM?: number; provider?: string; capturedAt?: string; mock?: boolean;
  failureReason?: FailureReason; failureDetail?: string; meta?: Record<string, unknown>;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export function validateLocationRequestResult(raw: Record<string, unknown>, eventId: string): { ok: true; event: IncomingLocationRequestResult } | { ok: false; error: string } {
  const requestId = typeof raw.requestId === "string" ? raw.requestId.trim() : "";
  if (!requestId || requestId.length > 60) return { ok: false, error: "requestId is required" };
  const status = raw.status === "COMPLETED" || raw.status === "FAILED" ? raw.status : null;
  if (!status) return { ok: false, error: "status must be COMPLETED or FAILED" };
  const lat = num(raw.latitude), lon = num(raw.longitude), acc = num(raw.accuracyM);
  if (status === "COMPLETED") {
    if (lat === undefined || lon === undefined || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return { ok: false, error: "a COMPLETED result needs valid coordinates" };
    if (acc === undefined || acc < 0 || acc > 100_000) return { ok: false, error: "a COMPLETED result needs accuracyM" };
    if (typeof raw.capturedAt !== "string" || Number.isNaN(new Date(raw.capturedAt).getTime())) return { ok: false, error: "a COMPLETED result needs capturedAt" };
  }
  const failureReason = typeof raw.failureReason === "string" && (FAILURE_REASONS as readonly string[]).includes(raw.failureReason) ? (raw.failureReason as FailureReason) : undefined;
  if (status === "FAILED" && !failureReason) return { ok: false, error: `a FAILED result needs one of ${FAILURE_REASONS.join(", ")}` };
  return { ok: true, event: {
    eventId, eventType: "LOCATION_REQUEST_RESULT", timestamp: typeof raw.timestamp === "string" || raw.timestamp instanceof Date ? raw.timestamp : new Date().toISOString(),
    requestId, status, latitude: lat, longitude: lon, accuracyM: acc, provider: typeof raw.provider === "string" ? raw.provider.slice(0, 20) : undefined,
    capturedAt: typeof raw.capturedAt === "string" ? raw.capturedAt : undefined, mock: raw.mock === true, failureReason, failureDetail: typeof raw.failureDetail === "string" ? raw.failureDetail.slice(0, 200) : undefined,
    meta: typeof raw.meta === "object" && raw.meta ? (raw.meta as Record<string, unknown>) : undefined,
  } };
}

/**
 * Apply a result from the phone. The event's own eventId has already been stored (dedup), so this
 * only has to bind it to the request: same device, request still open, capture time plausible,
 * accuracy within the request's limit. A result for a terminal request is ignored (never overwrites).
 */
export async function applyLocationRequestResult(device: GatewayDevice, ev: IncomingLocationRequestResult, now = new Date()): Promise<{ outcome: string }> {
  const r = await db.deviceLocationRequest.findUnique({ where: { id: ev.requestId } });
  if (!r) return { outcome: "ignored: unknown request" };
  if (r.gatewayDeviceId !== device.id) return { outcome: "rejected: request belongs to another device" };
  if (r.resultEventId) return { outcome: `ignored: already answered by ${r.resultEventId}` };
  if (!isOpen(r.status)) return { outcome: `ignored: request already ${r.status}` };

  const base = { resultEventId: ev.eventId, completedAt: now, provider: ev.provider ?? null, mock: Boolean(ev.mock), metadata: { ...(ev.meta ?? {}), reportedAt: String(ev.timestamp) } as Prisma.InputJsonObject };
  let data: Prisma.DeviceLocationRequestUncheckedUpdateInput;
  let outcome: string;
  if (ev.status === "FAILED") {
    data = { ...base, status: "FAILED", failureReason: ev.failureReason, failureDetail: ev.failureDetail ?? null };
    outcome = `FAILED ${ev.failureReason}`;
  } else {
    const capturedAt = saneTimestamp(ev.capturedAt!, now);
    const plaus = capturePlausible(capturedAt, r, now);
    const coords = { latitude: ev.latitude!, longitude: ev.longitude!, accuracyM: ev.accuracyM!, capturedAt };
    if (!plaus.ok) { data = { ...base, ...coords, status: "FAILED", failureReason: "REQUEST_EXPIRED", failureDetail: plaus.why }; outcome = `FAILED REQUEST_EXPIRED (${plaus.why})`; }
    else if (ev.accuracyM! > r.maxAccuracyM) { data = { ...base, ...coords, status: "FAILED", failureReason: "POOR_ACCURACY", failureDetail: `±${Math.round(ev.accuracyM!)} m, limit ${r.maxAccuracyM} m` }; outcome = `FAILED POOR_ACCURACY ±${Math.round(ev.accuracyM!)} m`; }
    else { data = { ...base, ...coords, status: "COMPLETED" }; outcome = `COMPLETED ±${Math.round(ev.accuracyM!)} m${ev.mock ? " MOCK" : ""}`; }
  }
  // Guard the transition with the status we read: a concurrent cancel/expire wins and this becomes a no-op.
  const res = await db.deviceLocationRequest.updateMany({ where: { id: r.id, status: r.status, resultEventId: null }, data });
  if (res.count === 0) return { outcome: "ignored: request changed concurrently" };

  // The device panel's "last known location" follows a fix the request accepted; never a mock, never a loose or implausible one.
  if (data.status === "COMPLETED" && !ev.mock && ev.latitude != null && ev.longitude != null) {
    const at = saneTimestamp(ev.capturedAt!, now);
    if (!device.lastLocationAt || device.lastLocationAt < at) {
      const acc = await getSettingNumber("geofence.accuracyMaxM");
      const fence = await fenceForDevice(device, at);
      const state = fence ? classifyFix({ latitude: ev.latitude, longitude: ev.longitude, accuracyM: ev.accuracyM }, fence, acc).state : "UNKNOWN";
      await db.gatewayDevice.update({ where: { id: device.id }, data: { lastLatitude: ev.latitude, lastLongitude: ev.longitude, lastAccuracyM: ev.accuracyM ?? null, lastLocationAt: at, lastLocationState: state } });
    }
  }
  if (ev.mock) await db.gatewayDevice.update({ where: { id: device.id }, data: { mockLocationSeen: true } });
  return { outcome };
}

/** The fence the phone is judged against right now: its live shift's, else its home site's. */
async function fenceForDevice(device: GatewayDevice, at: Date) {
  if (device.guardId) {
    const shift = await findLiveShiftForGuard(device.guardId, at);
    if (shift) { const f = effectiveGeofence(shift, shift.location)?.fence; if (f) return f; }
  }
  if (device.locationId) {
    const home = await db.location.findUnique({ where: { id: device.locationId } });
    if (home?.latitude != null && home.longitude != null) return { latitude: home.latitude, longitude: home.longitude, radiusM: home.geofenceRadiusM };
  }
  return null;
}

/** What the portal shows for one request: the row plus distance/classification against a site when both are known. */
export function describeRequest(r: DeviceLocationRequest, site: Pick<Location, "latitude" | "longitude" | "geofenceRadiusM" | "name"> | null, accuracyMaxM: number, now = new Date()) {
  const hasFix = r.latitude != null && r.longitude != null;
  const distanceM = hasFix && site?.latitude != null && site.longitude != null ? Math.round(haversineM(r.latitude!, r.longitude!, site.latitude, site.longitude)) : null;
  const classification = hasFix && site?.latitude != null && site.longitude != null ? classifyFix({ latitude: r.latitude!, longitude: r.longitude!, accuracyM: r.accuracyM ?? undefined }, { latitude: site.latitude, longitude: site.longitude, radiusM: site.geofenceRadiusM }, accuracyMaxM) : null;
  const ageSeconds = r.capturedAt ? Math.max(0, Math.round((now.getTime() - r.capturedAt.getTime()) / 1000)) : null;
  return {
    id: r.id, status: r.status, purpose: r.purpose, locationId: r.locationId, requestedAt: r.requestedAt, deliveredAt: r.deliveredAt, processingAt: r.processingAt, completedAt: r.completedAt, expiresAt: r.expiresAt,
    maxAccuracyM: r.maxAccuracyM, latitude: r.latitude, longitude: r.longitude, accuracyM: r.accuracyM, provider: r.provider, capturedAt: r.capturedAt, ageSeconds, mock: r.mock,
    failureReason: r.failureReason, failureDetail: r.failureDetail, gatewayDeviceId: r.gatewayDeviceId, guardId: r.guardId, requestedById: r.requestedById,
    site: site ? { name: site.name, distanceM, state: classification?.state ?? null, reason: classification?.reason ?? null, radiusM: site.geofenceRadiusM } : null,
    secondsLeft: isOpen(r.status) ? Math.max(0, Math.round((r.expiresAt.getTime() - now.getTime()) / 1000)) : 0,
  };
}
export type LocationRequestView = ReturnType<typeof describeRequest>;

export async function recentRequestsForGuard(guardId: string, take = 10, now = new Date()) {
  await expireStaleRequests(now);
  return db.deviceLocationRequest.findMany({ where: { guardId }, orderBy: { requestedAt: "desc" }, take, include: { requestedBy: { select: { name: true } } } });
}
