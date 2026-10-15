/**
 * Gateway device lifecycle: create → activation code → activate (token) → heartbeats →
 * online/offline → disable/revoke. Everything here is additive to the SMS system.
 */
import { addMinutes, addHours } from "date-fns";
import { db } from "@/lib/db";
import type { GatewayDevice, GatewayStatus, Prisma } from "@prisma/client";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { getSettingNumber } from "@/lib/settings";
import { normalisePhone, isValidPhone } from "@/lib/phone";
import { generateActivationCode, generateDeviceToken, hashToken } from "./auth";

export const ACTIVATION_CODE_HOURS = 24;

export const gatewayInclude = { location: { include: { client: true } } } satisfies Prisma.GatewayDeviceInclude;
export type GatewayWithLocation = Prisma.GatewayDeviceGetPayload<{ include: typeof gatewayInclude }>;

export const GATEWAY_STATUS_META: Record<GatewayStatus, { label: string; tone: "ok" | "warn" | "critical" | "neutral" | "muted" }> = {
  ONLINE: { label: "Online", tone: "ok" },
  OFFLINE: { label: "Offline", tone: "critical" },
  DISABLED: { label: "Disabled", tone: "muted" },
  REVOKED: { label: "Revoked", tone: "muted" },
};

export type CreateGatewayInput = { deviceName: string; phoneNumber: string; locationId?: string | null; notes?: string | null; actor: { userId: string; name: string } };

export async function createGateway(input: CreateGatewayInput) {
  const phone = normalisePhone(input.phoneNumber);
  if (!isValidPhone(phone)) throw new Error("Enter a valid phone number for the gateway SIM.");
  const device = await db.gatewayDevice.create({
    data: {
      deviceName: input.deviceName.trim(),
      phoneNumber: phone,
      locationId: input.locationId || null,
      notes: input.notes || null,
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

export type DeviceInfo = { appVersion?: string; androidVersion?: string; deviceModel?: string; batteryLevel?: number; networkType?: string };

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
  await audit({ actor: "gateway", action: "GATEWAY_ACTIVATED", entity: "GatewayDevice", entityId: device.id, details: { deviceName: device.deviceName, ...info }, ip });
  return { device: updated, token, config: await gatewayConfig() };
}

function deviceInfoData(info: DeviceInfo) {
  return {
    ...(info.appVersion ? { appVersion: String(info.appVersion).slice(0, 40) } : {}),
    ...(info.androidVersion ? { androidVersion: String(info.androidVersion).slice(0, 40) } : {}),
    ...(info.deviceModel ? { deviceModel: String(info.deviceModel).slice(0, 80) } : {}),
    ...(typeof info.batteryLevel === "number" ? { batteryLevel: Math.max(0, Math.min(100, Math.round(info.batteryLevel))) } : {}),
    ...(info.networkType ? { networkType: String(info.networkType).slice(0, 20) } : {}),
  };
}

/** What the phone needs to know; sent on activation and with every heartbeat response. */
export async function gatewayConfig() {
  const [heartbeatSeconds, offlineMinutes] = await Promise.all([getSettingNumber("gateway.heartbeatSeconds"), getSettingNumber("gateway.offlineMinutes")]);
  return { heartbeatSeconds: Math.max(30, heartbeatSeconds), offlineMinutes, serverTime: new Date().toISOString() };
}

export async function heartbeat(device: GatewayDevice, info: DeviceInfo, ip: string | null) {
  const now = new Date();
  const wasOffline = device.status === "OFFLINE";
  const updated = await db.gatewayDevice.update({ where: { id: device.id }, data: { lastSeenAt: now, lastIp: ip, ...(device.status === "DISABLED" ? {} : { status: "ONLINE" }), ...deviceInfoData(info) }, include: gatewayInclude });
  if (wasOffline) await audit({ actor: "gateway", action: "GATEWAY_ONLINE", entity: "GatewayDevice", entityId: device.id, ip });
  return { device: updated, config: await gatewayConfig() };
}

export async function updateGateway(id: string, data: { deviceName?: string; phoneNumber?: string; locationId?: string | null; notes?: string | null }, actor: { userId: string; name: string }) {
  const patch: Prisma.GatewayDeviceUpdateInput = {};
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
    await notify({ type: "GATEWAY_OFFLINE", severity: "WARNING", title: `Gateway ${g.deviceName} is offline`, body: `No heartbeat for ${offlineMinutes} min${g.location ? ` · ${g.location.name}` : ""}. Check the phone's power, data and battery settings.`, url: `/gateways/${g.id}` });
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
