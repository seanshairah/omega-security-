import { NextResponse } from "next/server";
import { authenticateGateway, clientIp, rateLimit } from "@/lib/gateway/auth";
import { heartbeat, guardDeviceConfig } from "@/lib/gateway/service";

/** POST /api/gateways/heartbeat  Bearer <deviceToken>  { appVersion, androidVersion, batteryLevel, networkType, timestamp } */
export async function POST(req: Request) {
  const auth = await authenticateGateway(req);
  if (!auth.device) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const rl = rateLimit(`hb:${auth.device.id}`, 30, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many heartbeats" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const ll = b.lastLocation && typeof b.lastLocation === "object" ? (b.lastLocation as { latitude: number; longitude: number; accuracyM?: number; at?: string; state?: string }) : undefined;
  const { device, config } = await heartbeat(auth.device, { appVersion: s(b.appVersion), androidVersion: s(b.androidVersion), deviceModel: s(b.deviceModel), batteryLevel: typeof b.batteryLevel === "number" ? b.batteryLevel : undefined, networkType: s(b.networkType), locationPermission: s(b.locationPermission), callPermission: s(b.callPermission), monitoringState: s(b.monitoringState), mockLocation: b.mockLocation === true, lastLocation: ll, configVersion: s(b.configVersion),
    shiftState: s(b.shiftState), gpsState: s(b.gpsState), gpsReason: "gpsReason" in b ? s(b.gpsReason) ?? null : undefined, syncState: s(b.syncState),
    queuedEvents: typeof b.queuedEvents === "number" ? b.queuedEvents : undefined, failedEvents: typeof b.failedEvents === "number" ? b.failedEvents : undefined,
    oldestPendingSeconds: "oldestPendingSeconds" in b ? (typeof b.oldestPendingSeconds === "number" ? b.oldestPendingSeconds : null) : undefined,
    lastEventSyncAt: "lastEventSyncAt" in b ? s(b.lastEventSyncAt) ?? null : undefined, lastSyncAttemptAt: "lastSyncAttemptAt" in b ? s(b.lastSyncAttemptAt) ?? null : undefined,
    lastSyncError: "lastSyncError" in b ? s(b.lastSyncError) ?? null : undefined, lastSyncTrigger: "lastSyncTrigger" in b ? s(b.lastSyncTrigger) ?? null : undefined }, clientIp(req));
  // Guard phones compare this with the version they applied and re-download the shift config when it differs.
  const configVersion = device.mode === "GUARD" ? (await guardDeviceConfig(device)).configVersion : null;
  return NextResponse.json({ ok: true, deviceId: device.id, deviceName: device.deviceName, phoneNumber: device.phoneNumber, status: device.status, mode: device.mode, guard: device.guard ? { id: device.guard.id, name: `${device.guard.firstName} ${device.guard.lastName}` } : null, location: device.location ? { id: device.location.id, name: device.location.name, client: device.location.client.name } : null, configVersion, config });
}
const s = (v: unknown) => (typeof v === "string" ? v : undefined);
