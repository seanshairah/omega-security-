import { after, NextResponse } from "next/server";
import { authenticateGateway, clientIp, rateLimit } from "@/lib/gateway/auth";
import { heartbeat, guardDeviceConfig } from "@/lib/gateway/service";
import { alertsForDevice } from "@/lib/gateway/alerts";
import { pendingCommandsForDevice, commandPollSeconds } from "@/lib/gateway/location-requests";
import { currentRelease, distributable } from "@/lib/app-release";
import { maybeTickFromHeartbeat } from "@/lib/automation/scheduler";

// Long enough for the engine run a heartbeat may trigger after it has answered the phone.
export const maxDuration = 60;

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
    lastSyncError: "lastSyncError" in b ? s(b.lastSyncError) ?? null : undefined, lastSyncTrigger: "lastSyncTrigger" in b ? s(b.lastSyncTrigger) ?? null : undefined,
    secureStorage: typeof b.secureStorage === "boolean" ? b.secureStorage : undefined, buildType: s(b.buildType), placeCallPermission: s(b.placeCallPermission) }, clientIp(req));
  // Phones heartbeat every two minutes whether or not anyone is signed in to the portal, so they
  // keep the engine on time when the external cron lags. Runs after the response is sent.
  after(() => maybeTickFromHeartbeat());
  // Guard phones compare this with the version they applied and re-download the shift config when it differs.
  const configVersion = device.mode === "GUARD" ? (await guardDeviceConfig(device)).configVersion : null;
  // Acknowledgements for the alerts this guard sent recently travel back on the heartbeat.
  const alerts = device.mode === "GUARD" ? await alertsForDevice(device) : [];
  // Operations commands (location requests) ride on the heartbeat too; GET /api/gateways/commands polls them faster.
  const [commands, pollSeconds] = device.mode === "GUARD" ? await Promise.all([pendingCommandsForDevice(device), commandPollSeconds()]) : [[], null];
  // There is no Play Store, so a phone only learns an update exists if the server tells it. The
  // heartbeat already runs on its own schedule, so it costs no extra call. Withheld when the build
  // is not distributable, so a phone is never pointed at a download that will be refused.
  const rel = await currentRelease();
  const dist = distributable(rel);
  const app = dist.ok
    ? { versionName: dist.release.versionName, versionCode: dist.release.versionCode, sha256: dist.release.sha256, downloadUrl: "/api/app/download" }
    : null;
  return NextResponse.json({ ok: true, app, commands, commandPollSeconds: pollSeconds, deviceId: device.id, deviceName: device.deviceName, phoneNumber: device.phoneNumber, status: device.status, mode: device.mode, guard: device.guard ? { id: device.guard.id, name: `${device.guard.firstName} ${device.guard.lastName}` } : null, location: device.location ? { id: device.location.id, name: device.location.name, client: device.location.client.name } : null, configVersion, alerts, config });
}
const s = (v: unknown) => (typeof v === "string" ? v : undefined);
