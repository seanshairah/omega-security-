"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Status } from "@/components/ui/status";
import { Meta } from "@/components/ui/page";
import { SiteMap } from "@/components/map/site-map";
import { useLocationRequest, type RequestView } from "@/components/location/use-location-request";
import { REQUEST_STATUS_META, FAILURE_META, isOpen } from "@/lib/location-request-state";
import { fixFreshness } from "@/lib/geo-position";
import { LOCATION_STATE_META } from "@/lib/geofence";

type Summary = {
  guard: { id: string; guardNo: string; name: string };
  device: { id: string; deviceName: string; deviceModel: string | null; appVersion: string | null; status: string; lastSeenAt: string | null; batteryLevel: number | null; locationPermission: string | null; mockLocationSeen: boolean; lastLatitude: number | null; lastLongitude: number | null; lastAccuracyM: number | null; lastLocationAt: string | null; lastLocationState: string | null } | null;
  site: { id: string; name: string; latitude: number | null; longitude: number | null; radiusM: number } | null;
  shift: { id: string; startAt: string; endAt: string; status: string; siteName: string } | null;
  requests: RequestView[];
};

const fmt = (d: string | Date | null | undefined) => (d ? new Date(d).toLocaleString("en-GB", { timeZone: "Africa/Harare", hour12: false }) : "—");
const agoS = (d: string | Date | null | undefined) => { if (!d) return "never"; const s = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 1000)); return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };

/**
 * "Where is this guard's phone right now?" panel for the guard profile and the device page.
 * The admin's own browser location is never read here: every coordinate comes from the phone via
 * the server. Polls the request while it is open, shows failures with their reason, and offers
 * "Use as site coordinates" (which opens the site form with the fix as a candidate to confirm).
 */
export function GuardLocationPanel({ guardId, canRequest, canEditSites, compact = false }: { guardId: string; canRequest: boolean; canEditSites: boolean; compact?: boolean }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(!compact);
  const [copied, setCopied] = useState(false);
  const req = useLocationRequest(guardId);
  const { setRequest } = req;

  const load = useCallback(async () => {
    const res = await fetch(`/api/guards/${guardId}/location-requests`, { cache: "no-store" });
    if (!res.ok) { setLoadError((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`); return; }
    const s = (await res.json()) as Summary;
    setSummary(s);
    const open = s.requests.find((r) => isOpen(r.status));
    if (open) setRequest((cur) => cur ?? open);
  }, [guardId, setRequest]);

  useEffect(() => { void load(); }, [load]);
  // When the live request reaches a terminal state, reload the summary (last location, history).
  useEffect(() => { if (req.request && !isOpen(req.request.status)) void load(); }, [req.request, load]);

  if (loadError) return <p className="text-[13px] text-critical">Could not load the location panel: {loadError}</p>;
  if (!summary) return <p className="text-[13px] text-ink-3">Loading…</p>;
  const { device, site, shift, guard } = summary;
  const live = req.request ?? summary.requests[0] ?? null;
  const lastCompleted = [req.request, ...summary.requests].find((r) => r && r.status === "COMPLETED" && r.latitude != null) ?? null;
  const best = lastCompleted && (!device?.lastLocationAt || (lastCompleted.capturedAt && new Date(lastCompleted.capturedAt) >= new Date(device.lastLocationAt))) ? { lat: lastCompleted.latitude!, lng: lastCompleted.longitude!, acc: lastCompleted.accuracyM, at: lastCompleted.capturedAt!, provider: lastCompleted.provider, from: "requested fix", state: lastCompleted.site?.state ?? null, distanceM: lastCompleted.site?.distanceM ?? null } : device?.lastLatitude != null && device.lastLongitude != null ? { lat: device.lastLatitude, lng: device.lastLongitude, acc: device.lastAccuracyM, at: device.lastLocationAt!, provider: null, from: "automatic monitoring", state: device.lastLocationState, distanceM: null } : null;
  const bestFresh = best ? fixFreshness(new Date(best.at).getTime()) : null;
  const copy = async () => { if (!best) return; try { await navigator.clipboard.writeText(`${best.lat.toFixed(6)}, ${best.lng.toFixed(6)}`); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ } };
  const busy = !!req.request && isOpen(req.request.status);
  const btn = "h-9 rounded-[8px] border border-line bg-surface px-3 text-[13px] font-medium hover:bg-surface-2 disabled:opacity-50";

  return (
    <div className="space-y-4" data-testid="guard-location-panel">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Meta label="Guard">{guard.name}<span className="block text-[12px] text-ink-3">{guard.guardNo}</span></Meta>
        <Meta label="Registered Android device">{device ? <><Link href={`/gateways/${device.id}`} className="hover:underline">{device.deviceName}</Link><span className="block text-[12px] text-ink-3">{device.deviceModel ?? "—"}{device.appVersion ? ` · v${device.appVersion}` : ""}</span></> : <span className="text-ink-3">None activated</span>}</Meta>
        <Meta label="Device status">{device ? <><Status tone={device.status === "ONLINE" ? "ok" : device.status === "OFFLINE" ? "warn" : "critical"} pulse={device.status === "ONLINE"}>{device.status.toLowerCase()}</Status><span className="block text-[12px] text-ink-3">heartbeat {agoS(device.lastSeenAt)}{device.batteryLevel != null ? ` · ${device.batteryLevel}%` : ""}</span></> : "—"}</Meta>
        <Meta label="Assigned duty site">{site ? <Link href={`/locations/${site.id}`} className="hover:underline">{site.name}</Link> : <span className="text-ink-3">None</span>}{site && site.latitude == null && <span className="block text-[12px] text-warn">Site has no coordinates</span>}{site && site.latitude != null && <span className="block text-[12px] text-ink-3">fence {site.radiusM} m</span>}</Meta>
        <Meta label="Current shift">{shift ? <Link href={`/shifts/${shift.id}`} className="hover:underline">{shift.siteName} · {fmt(shift.startAt).slice(-5)}–{fmt(shift.endAt).slice(-5)}</Link> : <span className="text-ink-3">Not on shift</span>}</Meta>
        <Meta label="Request status">{live ? <><Status tone={REQUEST_STATUS_META[live.status].tone} pulse={isOpen(live.status)}>{REQUEST_STATUS_META[live.status].label}</Status><span className="block text-[12px] text-ink-3">{isOpen(live.status) ? `${live.secondsLeft} s left · asked ${agoS(live.requestedAt)}` : `${agoS(live.completedAt ?? live.requestedAt)}${live.requestedBy ? ` · by ${live.requestedBy}` : ""}`}</span></> : <span className="text-ink-3">No request yet</span>}</Meta>
      </div>

      {live && (
        <div className={`rounded-[8px] border px-3 py-2 text-[12.5px] ${live.status === "FAILED" ? "border-critical/40 bg-critical/5" : "border-line bg-surface"}`} data-testid="request-detail">
          {live.status === "FAILED" && live.failureReason ? <><span className="font-medium text-ink">{live.failureReason.replace(/_/g, " ").toLowerCase()}</span> · {FAILURE_META[live.failureReason]}{live.failureDetail ? ` (${live.failureDetail})` : ""}</> : REQUEST_STATUS_META[live.status].detail}
          {isOpen(live.status) && device?.status !== "ONLINE" && <span className="block text-warn">The phone has not checked in recently; the request stays queued until it reconnects or the deadline passes.</span>}
          {live.mock && <span className="block text-critical">A mock (fake) location provider was reported with this fix. Do not treat it as the guard&apos;s real position.</span>}
        </div>
      )}

      <div>
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-3">Last verified location</div>
        {best ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 tnum text-[13px] sm:grid-cols-4" data-testid="last-location">
            <div><span className="block text-[11px] text-ink-3">Latitude</span>{best.lat.toFixed(6)}</div>
            <div><span className="block text-[11px] text-ink-3">Longitude</span>{best.lng.toFixed(6)}</div>
            <div><span className="block text-[11px] text-ink-3">GPS accuracy</span>{best.acc != null ? `±${Math.round(best.acc)} m` : "unknown"}</div>
            <div><span className="block text-[11px] text-ink-3">Fix time · age</span>{fmt(best.at)}<span className="block text-[12px] text-ink-3">{bestFresh!.label}</span></div>
            <div><span className="block text-[11px] text-ink-3">Provider · source</span>{best.provider ?? "—"} · {best.from}</div>
            <div><span className="block text-[11px] text-ink-3">Distance from site</span>{best.distanceM != null ? `${best.distanceM} m` : site?.latitude != null ? "—" : "site has no coordinates"}</div>
            <div className="col-span-2"><span className="block text-[11px] text-ink-3">Geofence classification</span>{best.state && best.state in LOCATION_STATE_META ? <Status tone={bestFresh!.fresh ? LOCATION_STATE_META[best.state as keyof typeof LOCATION_STATE_META].tone : "muted"}>{LOCATION_STATE_META[best.state as keyof typeof LOCATION_STATE_META].label}{bestFresh!.fresh ? "" : " (stale)"}</Status> : <span className="text-ink-3">not classified</span>}</div>
          </div>
        ) : <p className="text-[13px] text-ink-3">No position from this phone yet.</p>}
      </div>

      <div className="flex flex-wrap gap-2">
        {canRequest && device && <button type="button" onClick={() => req.start({ purpose: "CHECK" })} disabled={busy || req.busy} className={`${btn} border-accent/60 bg-accent/10 text-accent-strong hover:bg-accent/15`} data-testid="request-location">{busy ? "Request in progress…" : "Request current location"}</button>}
        {canRequest && live && live.status === "FAILED" && <button type="button" onClick={() => req.start({ purpose: "CHECK" })} disabled={busy || req.busy} className={btn}>Retry failed request</button>}
        {canRequest && busy && <button type="button" onClick={() => req.cancel()} disabled={req.busy} className={btn}>Cancel</button>}
        <button type="button" onClick={() => { void load(); if (req.request) void req.refresh(); }} className={btn}>Refresh status</button>
        {best && <button type="button" onClick={() => setShowMap((v) => !v)} className={btn}>{showMap ? "Hide map" : "View on map"}</button>}
        {best && <button type="button" onClick={copy} className={btn}>{copied ? "Copied" : "Copy coordinates"}</button>}
        {canEditSites && lastCompleted && site && !lastCompleted.mock && <Link href={`/locations/${site.id}/edit?fromRequest=${lastCompleted.id}`} className={`${btn} inline-flex items-center`}>Use as site coordinates…</Link>}
        {!device && <span className="text-[12.5px] text-ink-3">This guard has no activated Android guard phone, so no position can be requested. Feature-phone guards are verified by SMS only.</span>}
      </div>
      {req.error && <p className="text-[13px] text-critical">{req.error}</p>}

      {showMap && best && <SiteMap site={site?.latitude != null && site.longitude != null ? { lat: site.latitude, lng: site.longitude, radiusM: site.radiusM, name: site.name } : null} points={[{ lat: best.lat, lng: best.lng, label: `Guard phone · ${best.from}`, kind: best.from === "requested fix" ? "request" : "latest", at: fmt(best.at), freshness: bestFresh!.label, accuracyM: best.acc ?? undefined }]} height={compact ? 240 : 320} />}

      {summary.requests.length > 0 && !compact && (
        <details className="text-[12.5px]">
          <summary className="cursor-pointer text-ink-2">Recent requests ({summary.requests.length})</summary>
          <ul className="mt-2 divide-y divide-line rounded-[8px] border border-line">
            {summary.requests.map((r) => <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5"><Status tone={REQUEST_STATUS_META[r.status].tone}>{REQUEST_STATUS_META[r.status].label}</Status><span className="tnum text-ink-2">{fmt(r.requestedAt)}</span>{r.requestedBy && <span className="text-ink-3">by {r.requestedBy}</span>}{r.latitude != null && <span className="tnum text-ink-3">{r.latitude.toFixed(5)}, {r.longitude!.toFixed(5)} ±{Math.round(r.accuracyM ?? 0)} m</span>}{r.failureReason && <span className="text-ink-3">{r.failureReason.replace(/_/g, " ").toLowerCase()}</span>}{r.mock && <Status tone="critical">mock</Status>}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}
