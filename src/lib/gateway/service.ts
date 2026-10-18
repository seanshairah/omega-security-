/**
 * Gateway device lifecycle: create → activation code → activate (token) → heartbeats →
 * online/offline → disable/revoke. Everything here is additive to the SMS system.
 */
import { addMinutes, addHours } from "date-fns";
import { db } from "@/lib/db";
import type { GatewayDevice, GatewayStatus, Prisma } from "@prisma/client";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { getSettingNumber, getSettings } from "@/lib/settings";
import { normalisePhone, isValidPhone } from "@/lib/phone";
import { generateActivationCode, generateDeviceToken, hashToken } from "./auth";
import { effectiveGeofence, configVersionString } from "@/lib/site-config";

export const ACTIVATION_CODE_HOURS = 24;

export const gatewayInclude = { location: { include: { client: true } }, guard: { select: { id: true, firstName: true, lastName: true, guardNo: true, phone: true, photoUrl: true } } } satisfies Prisma.GatewayDeviceInclude;
export type GatewayWithLocation = Prisma.GatewayDeviceGetPayload<{ include: typeof gatewayInclude }>;

export const GATEWAY_STATUS_META: Record<GatewayStatus, { label: string; tone: "ok" | "warn" | "critical" | "neutral" | "muted" }> = {
  ONLINE: { label: "Online", tone: "ok" },
  OFFLINE: { label: "Offline", tone: "critical" },
  DISABLED: { label: "Disabled", tone: "muted" },
  REVOKED: { label: "Revoked", tone: "muted" },
};

export type CreateGatewayInput = { deviceName: string; phoneNumber: string; locationId?: string | null; notes?: string | null; mode?: "OPERATIONS_GATEWAY" | "GUARD"; guardId?: string | null; actor: { userId: string; name: string } };

export async function createGateway(input: CreateGatewayInput) {
  const phone = normalisePhone(input.phoneNumber);
  if (!isValidPhone(phone)) throw new Error("Enter a valid phone number for the gateway SIM.");
  const device = await db.gatewayDevice.create({
    data: {
      deviceName: input.deviceName.trim(),
      phoneNumber: phone,
      locationId: input.locationId || null,
      notes: input.notes || null,
      mode: input.mode === "GUARD" ? "GUARD" : "OPERATIONS_GATEWAY",
      guardId: input.mode === "GUARD" ? input.guardId || null : null,
      activationCode: await uniqueCode(),
      activationExpiresAt: addHours(new Date(), ACTIVATION_CODE_HOURS),
    },
    include: gatewayInclude,
  });
  await audit({ userId: input.actor.userId, actor: input.actor.name, action: "GATEWAY_CREATED", entity: "GatewayDevice", entityId: device.id, details: { deviceName: device.deviceName, phoneNumber: device.phoneNumber } });
  return device;
}

async function uniqueCode(): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const code = generateActivationCode();
    if (!(await db.gatewayDevice.findUnique({ where: { activationCode: code } }))) return code;
  }
  return generateActivationCode(8);
}

/** A fresh code for a pending device, or to re-activate a device whose phone was replaced. */
export async function regenerateActivationCode(id: string, actor: { userId: string; name: string }) {
  const device = await db.gatewayDevice.findUnique({ where: { id } });
  if (!device) throw new Error("Gateway not found");
  if (device.status === "REVOKED") throw new Error("A revoked gateway cannot be re-activated. Create a new one.");
  const updated = await db.gatewayDevice.update({
    where: { id },
    data: { activationCode: await uniqueCode(), activationExpiresAt: addHours(new Date(), ACTIVATION_CODE_HOURS), activationStatus: "PENDING", tokenHash: null, tokenIssuedAt: null, status: device.status === "DISABLED" ? "DISABLED" : "OFFLINE" },
  });
  await audit({ userId: actor.userId, actor: actor.name, action: "GATEWAY_CODE_REGENERATED", entity: "GatewayDevice", entityId: id });
  return updated;
}

export type DeviceInfo = { appVersion?: string; androidVersion?: string; deviceModel?: string; batteryLevel?: number; networkType?: string; locationPermission?: string; callPermission?: string; monitoringState?: string; mockLocation?: boolean; lastLocation?: { latitude: number; longitude: number; accuracyM?: number; at?: string; state?: string }; configVersion?: string;
  // Stage 1/3 diagnostics (all optional; older app versions do not send them)
  shiftState?: string; gpsState?: string; gpsReason?: string | null; syncState?: string; queuedEvents?: number; failedEvents?: number; oldestPendingSeconds?: number | null; lastEventSyncAt?: string | null; lastSyncAttemptAt?: string | null; lastSyncError?: string | null; lastSyncTrigger?: string | null };

/** Exchange an activation code for a device token. The token is returned exactly once. */
export async function activateGateway(code: string, info: DeviceInfo, ip: string | null) {
  const clean = code.trim().toUpperCase();
  const device = await db.gatewayDevice.findUnique({ where: { activationCode: clean } });
  if (!device || device.activationStatus !== "PENDING") throw new Error("Activation code not recognised");
  if (device.status === "REVOKED") throw new Error("This gateway has been revoked");
  if (device.activationExpiresAt && device.activationExpiresAt < new Date()) throw new Error("Activation code has expired. Ask an administrator for a new one.");
  const token = generateDeviceToken();
  const now = new Date();
  const updated = await db.gatewayDevice.update({
    where: { id: device.id },
    data: {
      activationStatus: "ACTIVE", activationCode: null, activationExpiresAt: null, activatedAt: now,
      tokenHash: hashToken(token), tokenIssuedAt: now, lastSeenAt: now, lastIp: ip,
      status: device.status === "DISABLED" ? "DISABLED" : "ONLINE",
      ...deviceInfoData(info),
    },
    include: gatewayInclude,
  });
  await audit({ actor: "gateway", action: "GATEWAY_ACTIVATED", entity: "GatewayDevice", entityId: device.id, details: { deviceName: device.deviceName, mode: device.mode, ...deviceInfoData(info) }, ip });
  await syncGuardDeviceKind(updated.guardId);
  return { device: updated, token, config: await gatewayConfig() };
}

function deviceInfoData(info: DeviceInfo) {
  return {
    ...(info.appVersion ? { appVersion: String(info.appVersion).slice(0, 40) } : {}),
    ...(info.androidVersion ? { androidVersion: String(info.androidVersion).slice(0, 40) } : {}),
    ...(info.deviceModel ? { deviceModel: String(info.deviceModel).slice(0, 80) } : {}),
    ...(typeof info.batteryLevel === "number" ? { batteryLevel: Math.max(0, Math.min(100, Math.round(info.batteryLevel))) } : {}),
    ...(info.networkType ? { networkType: String(info.networkType).slice(0, 20) } : {}),
    ...(info.locationPermission ? { locationPermission: String(info.locationPermission).slice(0, 30) } : {}),
    ...(info.callPermission ? { callPermission: String(info.callPermission).slice(0, 30) } : {}),
    ...(info.monitoringState ? { monitoringState: String(info.monitoringState).slice(0, 30) } : {}),
    ...(info.mockLocation === true ? { mockLocationSeen: true } : {}),
  };
}

const date = (v: unknown) => { if (typeof v !== "string") return undefined; const d = new Date(v); return Number.isNaN(d.getTime()) ? undefined : d; };
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);
const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : undefined);

/** Separate shift / GPS / sync facts from the phone. A key that is absent is left untouched; null clears it. */
function syncDiagnosticsData(info: DeviceInfo) {
  const out: Record<string, unknown> = {};
  if (info.shiftState !== undefined) out.shiftState = str(info.shiftState, 20) ?? null;
  if (info.gpsState !== undefined) out.gpsState = str(info.gpsState, 30) ?? null;
  if (info.gpsReason !== undefined) out.gpsReason = str(info.gpsReason, 40) ?? null;
  if (info.syncState !== undefined) out.syncState = str(info.syncState, 30) ?? null;
  if (info.queuedEvents !== undefined) out.queuedEvents = int(info.queuedEvents) ?? null;
  if (info.failedEvents !== undefined) out.failedEvents = int(info.failedEvents) ?? null;
  if (info.oldestPendingSeconds !== undefined) out.oldestPendingSeconds = int(info.oldestPendingSeconds) ?? null;
  if (info.lastEventSyncAt !== undefined) out.lastEventSyncAt = date(info.lastEventSyncAt) ?? null;
  if (info.lastSyncAttemptAt !== undefined) out.lastSyncAttemptAt = date(info.lastSyncAttemptAt) ?? null;
  if (info.lastSyncError !== undefined) out.lastSyncError = str(info.lastSyncError, 200) ?? null;
  if (info.lastSyncTrigger !== undefined) out.lastSyncTrigger = str(info.lastSyncTrigger, 30) ?? null;
  return out as Prisma.GatewayDeviceUncheckedUpdateInput;
}

/** Guard mode: mark the guard as an Android guard once a device is active; back to feature phone when none is. */
async function syncGuardDeviceKind(guardId: string | null | undefined) {
  if (!guardId) return;
  const active = await db.gatewayDevice.count({ where: { guardId, mode: "GUARD", activationStatus: "ACTIVE", status: { not: "REVOKED" } } });
  await db.guard.update({ where: { id: guardId }, data: { deviceKind: active > 0 ? "ANDROID_GUARD" : "FEATURE_PHONE" } });
}

/** What the phone needs to know; sent on activation and with every heartbeat response. */
export async function gatewayConfig() {
  const [heartbeatSeconds, offlineMinutes, checkMinutes, verifySeconds, outsideCheckMinutes, escalationMinutes, accuracyMaxM] = await Promise.all([
    getSettingNumber("gateway.heartbeatSeconds"), getSettingNumber("gateway.offlineMinutes"), getSettingNumber("geofence.checkMinutes"), getSettingNumber("geofence.verifySeconds"), getSettingNumber("geofence.outsideCheckMinutes"), getSettingNumber("geofence.escalationMinutes"), getSettingNumber("geofence.accuracyMaxM"),
  ]);
  const opsPhone = (await getSettings())["general.controlRoomPhone"]?.trim() || null;
  return { heartbeatSeconds: Math.max(30, heartbeatSeconds), offlineMinutes, opsPhone, geofence: { checkMinutes: Math.max(1, checkMinutes), verifySeconds: Math.max(15, verifySeconds), outsideCheckMinutes: Math.max(1, outsideCheckMinutes), escalationMinutes, accuracyMaxM }, serverTime: new Date().toISOString() };
}

/**
 * Everything a guard phone needs to monitor a shift offline: the guard, the live or next shift,
 * the site's coordinates and radius, and the timing policy. Cached on the phone.
 */
export async function guardDeviceConfig(device: GatewayDevice, now = new Date()) {
  const config = await gatewayConfig();
  if (device.mode !== "GUARD" || !device.guardId) return { mode: device.mode, guard: null, shift: null, config };
  const guard = await db.guard.findUnique({ where: { id: device.guardId }, select: { id: true, firstName: true, lastName: true, guardNo: true } });
  const shift = await db.shift.findFirst({
    where: { guardId: device.guardId, status: { notIn: ["COMPLETED", "MISSED", "CANCELLED"] }, endAt: { gte: addMinutes(now, -60) } },
    include: { location: { select: { id: true, name: true, latitude: true, longitude: true, geofenceRadiusM: true, address: true, configVersion: true, coordinatesSource: true } } },
    orderBy: { startAt: "asc" },
  });
  // The fence the phone judges against: the shift's override when set, else the site. Versioned so the phone can echo what it applied.
  const eff = shift ? effectiveGeofence(shift, shift.location) : null;
  const configVersion = shift ? configVersionString(shift.location.configVersion, shift.configVersion) : null;
  return {
    mode: device.mode,
    guard: guard ? { id: guard.id, name: `${guard.firstName} ${guard.lastName}`, guardNo: guard.guardNo } : null,
    shift: shift ? {
      id: shift.id, startAt: shift.startAt.toISOString(), endAt: shift.endAt.toISOString(), status: shift.status,
      site: { id: shift.location.id, name: shift.location.name, latitude: eff?.fence.latitude ?? null, longitude: eff?.fence.longitude ?? null, radiusM: eff?.fence.radiusM ?? shift.location.geofenceRadiusM, hasCoordinates: eff != null, geofenceSource: eff?.source ?? "NONE", coordinatesSource: shift.location.coordinatesSource, geofenceNote: shift.geofenceNote },
      configVersion,
    } : null,
    configVersion,
    config,
  };
}

export async function heartbeat(device: GatewayDevice, info: DeviceInfo, ip: string | null) {
  const now = new Date();
  const wasOffline = device.status === "OFFLINE";
  const loc = info.lastLocation && typeof info.lastLocation.latitude === "number" && typeof info.lastLocation.longitude === "number" ? info.lastLocation : null;
  const locAt = loc?.at ? new Date(loc.at) : now;
  const locData = loc && (!device.lastLocationAt || device.lastLocationAt < locAt) ? { lastLatitude: loc.latitude, lastLongitude: loc.longitude, lastAccuracyM: typeof loc.accuracyM === "number" ? loc.accuracyM : null, lastLocationAt: Number.isNaN(locAt.getTime()) ? now : locAt, lastLocationState: (loc.state === "INSIDE" || loc.state === "OUTSIDE" ? loc.state : "UNKNOWN") as "INSIDE" | "OUTSIDE" | "UNKNOWN" } : {};
  const cfgData = typeof info.configVersion === "string" && info.configVersion.length <= 40 && info.configVersion !== device.configVersionApplied ? { configVersionApplied: info.configVersion, configAppliedAt: now } : {};
  const updated = await db.gatewayDevice.update({ where: { id: device.id }, data: { lastSeenAt: now, lastIp: ip, ...(device.status === "DISABLED" ? {} : { status: "ONLINE" }), ...deviceInfoData(info), ...syncDiagnosticsData(info), ...locData, ...cfgData }, include: gatewayInclude });
  if (wasOffline) await audit({ actor: "gateway", action: "GATEWAY_ONLINE", entity: "GatewayDevice", entityId: device.id, ip });
  if (typeof info.batteryLevel === "number" && info.batteryLevel < 15 && (device.batteryLevel == null || device.batteryLevel >= 15)) {
    await notify({ type: "DEVICE_LOW_BATTERY", severity: "WARNING", title: `Low battery · ${device.deviceName}`, body: `${Math.round(info.batteryLevel)}% left. ${device.mode === "GUARD" ? "Location monitoring stops when the phone dies; that is not the same as leaving the site." : "Calls will not be reported once the phone dies."}`, guardId: device.guardId, url: `/gateways/${device.id}` });
  }
  return { device: updated, config: await gatewayConfig() };
}

export async function updateGateway(id: string, data: { deviceName?: string; phoneNumber?: string; locationId?: string | null; notes?: string | null; mode?: "OPERATIONS_GATEWAY" | "GUARD"; guardId?: string | null }, actor: { userId: string; name: string }) {
  const patch: Prisma.GatewayDeviceUpdateInput = {};
  const before = await db.gatewayDevice.findUnique({ where: { id } });
  if (data.mode !== undefined) patch.mode = data.mode;
  if (data.guardId !== undefined || data.mode !== undefined) {
    const mode = data.mode ?? before?.mode;
    patch.guard = mode === "GUARD" && data.guardId ? { connect: { id: data.guardId } } : { disconnect: true };
  }
  if (data.deviceName !== undefined) patch.deviceName = data.deviceName.trim();
  if (data.phoneNumber !== undefined) {
    const phone = normalisePhone(data.phoneNumber);
    if (!isValidPhone(phone)) throw new Error("Enter a valid phone number for the gateway SIM.");
    patch.phoneNumber = phone;
  }
  if (data.locationId !== undefined) patch.location = data.locationId ? { connect: { id: data.locationId } } : { disconnect: true };
  if (data.notes !== undefined) patch.notes = data.notes || null;
  const updated = await db.gatewayDevice.update({ where: { id }, data: patch, include: gatewayInclude });
  await audit({ userId: actor.userId, actor: actor.name, action: "GATEWAY_UPDATED", entity: "GatewayDevice", entityId: id, details: data as Prisma.InputJsonObject });
  await syncGuardDeviceKind(before?.guardId);
  await syncGuardDeviceKind(updated.guardId);
  return updated;
}

export async function setGatewayDisabled(id: string, disabled: boolean, actor: { userId: string; name: string }) {
  const device = await db.gatewayDevice.findUnique({ where: { id } });
  if (!device) throw new Error("Gateway not found");
  if (device.status === "REVOKED") throw new Error("A revoked gateway cannot be changed.");
  const updated = await db.gatewayDevice.update({ where: { id }, data: disabled ? { status: "DISABLED", disabledAt: new Date() } : { status: "OFFLINE", disabledAt: null } });
  await audit({ userId: actor.userId, actor: actor.name, action: disabled ? "GATEWAY_DISABLED" : "GATEWAY_ENABLED", entity: "GatewayDevice", entityId: id });
  return updated;
}

/** Permanent: the token is deleted and the device can never submit again. */
export async function revokeGateway(id: string, actor: { userId: string; name: string }, reason?: string) {
  const updated = await db.gatewayDevice.update({ where: { id }, data: { status: "REVOKED", activationStatus: "REVOKED", tokenHash: null, activationCode: null, revokedAt: new Date(), notes: reason ? `${reason}` : undefined } });
  await audit({ userId: actor.userId, actor: actor.name, action: "GATEWAY_REVOKED", entity: "GatewayDevice", entityId: id, details: { reason: reason ?? null } });
  await syncGuardDeviceKind(updated.guardId);
  return updated;
}

/** ONLINE/OFFLINE as of `now`, without waiting for the engine tick. */
export function effectiveStatus(device: Pick<GatewayDevice, "status" | "lastSeenAt" | "activationStatus">, offlineMinutes: number, now = new Date()): GatewayStatus {
  if (device.status === "REVOKED" || device.status === "DISABLED") return device.status;
  if (device.activationStatus !== "ACTIVE" || !device.lastSeenAt) return "OFFLINE";
  return device.lastSeenAt >= addMinutes(now, -offlineMinutes) ? "ONLINE" : "OFFLINE";
}

/**
 * Engine step: mark gateways offline once the heartbeat threshold passes (notifying once),
 * close ringing calls that never ended, and apply call retention.
 */
export async function gatewayMaintenance(now = new Date()) {
  const report = { offline: 0, staleCalls: 0, purged: 0 };
  const [offlineMinutes, retentionDays] = await Promise.all([getSettingNumber("gateway.offlineMinutes"), getSettingNumber("gateway.callRetentionDays")]);
  const gone = await db.gatewayDevice.findMany({ where: { status: "ONLINE", OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: addMinutes(now, -offlineMinutes) } }] }, include: gatewayInclude });
  for (const g of gone) {
    await db.gatewayDevice.update({ where: { id: g.id }, data: { status: "OFFLINE" } });
    await audit({ actor: "system", action: "GATEWAY_OFFLINE", entity: "GatewayDevice", entityId: g.id, details: { lastSeenAt: g.lastSeenAt?.toISOString() ?? null } });
    if (g.mode === "GUARD") await notify({ type: "DEVICE_OFFLINE", severity: "WARNING", title: `Device offline · ${g.deviceName}`, body: `No heartbeat for ${offlineMinutes} min. The phone may be off, out of data or the app stopped. This does not mean the guard left the site.`, guardId: g.guardId, url: `/gateways/${g.id}` });
    else await notify({ type: "GATEWAY_OFFLINE", severity: "WARNING", title: `Gateway ${g.deviceName} is offline`, body: `No heartbeat for ${offlineMinutes} min${g.location ? ` · ${g.location.name}` : ""}. Check the phone's power, data and battery settings.`, url: `/gateways/${g.id}` });
    report.offline++;
  }
  const stale = await db.callLog.updateMany({ where: { status: { in: ["RINGING", "ANSWERED"] }, startedAt: { lt: addMinutes(now, -30) } }, data: { status: "UNKNOWN", note: "No end event received from the gateway within 30 minutes." } });
  report.staleCalls = stale.count;
  if (retentionDays > 0) {
    const cutoff = new Date(now.getTime() - retentionDays * 86400_000);
    const purged = await db.callLog.deleteMany({ where: { startedAt: { lt: cutoff } } });
    await db.gatewayEvent.deleteMany({ where: { receivedAt: { lt: cutoff } } });
    report.purged = purged.count;
  }
  return report;
}
