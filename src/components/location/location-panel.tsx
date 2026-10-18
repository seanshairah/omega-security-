import Link from "next/link";
import type { GatewayDevice } from "@prisma/client";
import { Meta } from "@/components/ui/page";
import { Status } from "@/components/ui/status";
import { freshness, LOCATION_STATE_META } from "@/lib/geofence";
import { GATEWAY_STATUS_META, effectiveStatus } from "@/lib/gateway/service";
import { fmtDateTime, ago } from "@/lib/time";

const PERM: Record<string, { label: string; tone: "ok" | "warn" | "critical" | "muted" }> = {
  granted: { label: "Granted", tone: "ok" }, background: { label: "Always", tone: "ok" }, foreground_only: { label: "Only while using the app", tone: "warn" }, denied: { label: "Denied", tone: "critical" }, partial: { label: "Partial", tone: "warn" }, unknown: { label: "Unknown", tone: "muted" },
};
export function PermissionBadge({ v }: { v: string | null | undefined }) {
  const m = PERM[v ?? "unknown"] ?? PERM.unknown;
  return <Status tone={m.tone}>{m.label}</Status>;
}

const MON: Record<string, string> = { NOT_ON_SHIFT: "Not on shift", WAITING_FOR_SHIFT: "Waiting for shift", MONITORING: "Monitoring", INSIDE: "Inside", OUTSIDE: "Outside", VERIFYING_OUTSIDE: "Verifying outside reading", LOCATION_UNAVAILABLE: "Location unavailable", OFFLINE_MONITORING: "Monitoring offline", SYNCING: "Syncing" };

/** Device and last-location summary for a guard with an Android device. Labels freshness honestly. */
/** Sync engine state as the phone reports it. "Device offline" and "events waiting" are different things; so are "synced" and "GPS verified". */
export function syncLabel(d: Pick<GatewayDevice, "syncState" | "queuedEvents" | "failedEvents" | "oldestPendingSeconds">) {
  const q = d.queuedEvents ?? 0;
  const behind = d.oldestPendingSeconds != null && d.oldestPendingSeconds > 0 ? ` · oldest ${Math.round(d.oldestPendingSeconds / 60)} min` : "";
  switch (d.syncState) {
    case "REVOKED": return <Status tone="critical">Revoked · nothing is sent</Status>;
    case "SENDING": return <Status tone="ok" pulse>Sending · {q} waiting</Status>;
    case "QUEUED_OFFLINE": return <Status tone="warn">{q} event(s) saved on the phone · no internet{behind}</Status>;
    case "RETRY_PENDING": return <Status tone="warn">{q} event(s) retrying{behind}</Status>;
    case "QUEUED": return <Status tone="neutral">{q} event(s) queued{behind}</Status>;
    case "SYNCED_WITH_FAILURES": return <Status tone="warn">Up to date · {d.failedEvents ?? 0} rejected</Status>;
    case "SYNCED": return <Status tone="ok">Up to date</Status>;
    default: return <span className="text-ink-3">Not reported (older app)</span>;
  }
}

export function DevicePanel({ device, offlineMinutes, now = new Date() }: { device: GatewayDevice; offlineMinutes: number; now?: Date }) {
  const status = effectiveStatus(device, offlineMinutes, now);
  const f = freshness(device.lastLocationAt, now);
  const state = device.lastLocationState ? LOCATION_STATE_META[device.lastLocationState] : null;
  return (
    <div className="grid grid-cols-2 gap-4">
      <Meta label="Device"><Link href={`/gateways/${device.id}`} className="hover:underline">{device.deviceName}</Link><span className="block text-[12px] text-ink-3">{device.deviceModel ?? "—"}{device.appVersion ? ` · v${device.appVersion}` : ""}</span></Meta>
      <Meta label="Device status"><Status tone={GATEWAY_STATUS_META[status].tone} pulse={status === "ONLINE"}>{GATEWAY_STATUS_META[status].label}</Status><span className="block text-[12px] text-ink-3">{device.lastSeenAt ? `heartbeat ${ago(device.lastSeenAt)}` : "never seen"}{device.batteryLevel != null ? ` · ${device.batteryLevel}%` : ""}{device.batteryLevel != null && device.batteryLevel < 15 ? " low" : ""}</span></Meta>
      <Meta label="Location permission"><PermissionBadge v={device.locationPermission} /></Meta>
      <Meta label="Phone permission"><PermissionBadge v={device.callPermission} /></Meta>
      <Meta label="Monitoring">{MON[device.monitoringState ?? ""] ?? device.monitoringState ?? "—"}{device.shiftState && <span className="block text-[12px] text-ink-3">shift {device.shiftState.toLowerCase()} · GPS {(device.gpsState ?? "—").toLowerCase().replace(/_/g, " ")}{device.gpsReason ? ` (${device.gpsReason.replace(/_/g, " ")})` : ""}</span>}</Meta>
      <Meta label="Sync">{syncLabel(device)}<span className="block text-[12px] text-ink-3">{device.lastEventSyncAt ? `last event sync ${ago(device.lastEventSyncAt)}` : "no events synced yet"}{device.lastSyncError ? ` · ${device.lastSyncError}` : ""}</span></Meta>
      <Meta label="Last known location">{state ? <><Status tone={f.label === "STALE" ? "muted" : state.tone}>{state.label}</Status><span className="block text-[12px] text-ink-3">{f.label} · {fmtDateTime(device.lastLocationAt)}{device.lastAccuracyM != null ? ` · ±${Math.round(device.lastAccuracyM)} m` : ""}</span></> : <span className="text-ink-3">None yet</span>}</Meta>
      {device.mockLocationSeen && <Meta label="Integrity" className="col-span-2"><Status tone="warn">Mock location provider seen on this phone</Status></Meta>}
      {(device.secureStorage === false || device.buildType === "debug") && <Meta label="Build" className="col-span-2">{device.buildType === "debug" && <Status tone="warn">Debug build on this phone · install the release APK before production use</Status>}{device.secureStorage === false && <Status tone="critical" className="block">Token not in Keystore-backed storage (damaged keystore) · re-activate after a factory reset or replace the phone</Status>}</Meta>}
    </div>
  );
}
