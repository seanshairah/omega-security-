"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Avatar } from "@/components/ui/avatar";
import { Status, Pill, type Tone } from "@/components/ui/status";
import { Panel, Fact, EmptyState, Workspace } from "@/components/workspace/panel";
import { GuardMap } from "@/components/guards/guard-map";
import { useLocationRequest } from "@/components/location/use-location-request";
import { REQUEST_STATUS_META, FAILURE_META, isOpen } from "@/lib/location-request-state";
import { ACTIVITY_CATEGORIES, type ActivityItem, type ActivityCategory, type ActivitySeverity } from "@/lib/guard-activity-types";
import type { GuardSnapshot } from "@/lib/services/guard-snapshot";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";

type Snapshot = Omit<GuardSnapshot, "device" | "shift" | "presentation" | "request" | "trail"> & {
  trail: { lat: number; lng: number; at: string }[];
  device: (Omit<NonNullable<GuardSnapshot["device"]>, "lastSeenAt"> & { lastSeenAt: string | null }) | null;
  shift: (Omit<NonNullable<GuardSnapshot["shift"]>, "startAt" | "endAt"> & { startAt: string; endAt: string }) | null;
  presentation: { connection: { state: string; label: string; tone: Tone; lastSeenAt: string | null }; monitoring: { onShift: boolean; active: boolean; gps: string; label: string; detail: string; tone: Tone }; position: { latitude: number; longitude: number; accuracyM: number | null; at: string; ageSeconds: number; freshness: "LIVE" | "RECENT" | "STALE"; source: "MONITORING" | "REQUESTED"; mock: boolean } | null; geofence: { assessment: string; label: string; tone: Tone; distanceM: number | null; detail: string } };
  request: (Record<string, unknown> & { id: string; status: keyof typeof REQUEST_STATUS_META; latitude: number | null; longitude: number | null; accuracyM: number | null; capturedAt: string | null; failureReason: keyof typeof FAILURE_META | null; secondsLeft: number; requestedBy?: string | null; mock: boolean }) | null;
};

export type GuardProfile = { photoUrl: string | null; email: string | null; nationalId: string; supervisor: string | null; homeLocation: { id: string; name: string } | null; address: string | null; emergencyContact: string | null; employment: string; employedSince: string; notes: string | null; watchNote: string | null; liveLabel: string; liveTone: Tone; attendance?: { label: string; tone: Tone } | null; performance: { attendancePct: number; completed: number; late: number; missed: number; missedChecks: number; incidents: number; assistance: number } };

const fmtT = (d: string | Date | null | undefined) => (d ? new Date(d).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Harare" }) : "—");
const fmtDT = (d: string | Date | null | undefined) => (d ? new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Harare" }) : "—");
const ago = (d: string | Date | null | undefined, now = Date.now()) => { if (!d) return "never"; const s = Math.max(0, Math.round((now - new Date(d).getTime()) / 1000)); return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };
const SEV_TONE: Record<ActivitySeverity, Tone> = { info: "neutral", success: "ok", warning: "warn", critical: "critical" };
const CAT_LABEL = Object.fromEntries(ACTIVITY_CATEGORIES.map((c) => [c.key, c.label])) as Record<ActivityCategory, string>;

/**
 * Viewport-aware guard workspace. Desktop (xl): identity bar · [profile | map | live feed] · detail
 * tabs, all inside one viewport-high grid; only the feed, the profile column and the detail region
 * scroll. Below xl it stacks with controlled heights. Status and feed poll their own small
 * endpoints (15 s / 30 s); nothing refreshes the whole page.
 */
export function GuardWorkspace({ initial, profile, canRequest, canEditSites, actions, tabs = [], tab = "", children, initialActivity, fill }: { initial: Snapshot; profile: GuardProfile; canRequest: boolean; canEditSites: boolean; actions?: React.ReactNode; tabs?: { key: string; label: string }[]; tab?: string; children?: React.ReactNode; initialActivity: { items: ActivityItem[]; nextBefore: string | null }; fill?: boolean }) {
  const [snap, setSnap] = useState<Snapshot>(initial);
  const [now, setNow] = useState(() => Date.now());
  const [fitKey, setFitKey] = useState(0);
  const [detailOpen, setDetailOpen] = useState(true);
  // Short desktop viewports (laptops at 720 px) keep the map usable by starting with the detail region collapsed.
  useEffect(() => { if (window.innerWidth >= 1280 && window.innerHeight < 800) setDetailOpen(false); }, []);
  const [profileOpen, setProfileOpen] = useState(false);
  const [showTrail, setShowTrail] = useState(false);
  const pathname = usePathname();
  const req = useLocationRequest(initial.guard.id);
  const guardId = initial.guard.id;

  // Status: a small JSON read every 15 s while the tab is visible.
  const refreshStatus = useCallback(async () => {
    try { const r = await fetch(`/api/guards/${guardId}/status`, { cache: "no-store" }); if (r.ok) setSnap(await r.json()); } catch { /* keep the last snapshot */ }
    setNow(Date.now());
  }, [guardId]);
  useEffect(() => { const id = setInterval(() => { if (document.visibilityState === "visible") void refreshStatus(); }, 15_000); const tick = setInterval(() => setNow(Date.now()), 10_000); return () => { clearInterval(id); clearInterval(tick); }; }, [refreshStatus]);
  // When a request we started reaches a terminal state, re-read the status (position/geofence may have changed).
  useEffect(() => { if (req.request && !isOpen(req.request.status)) void refreshStatus(); }, [req.request, refreshStatus]);
  const liveReq = req.request ?? snap.request;

  const p = snap.presentation;
  const pos = p.position;
  const mapPosition = pos ? { lat: pos.latitude, lng: pos.longitude, accuracyM: pos.accuracyM, source: pos.source, freshness: pos.freshness, label: `${pos.source === "REQUESTED" ? "Requested fix" : "Monitoring fix"} · ${fmtDT(pos.at)}${pos.accuracyM != null ? ` · ±${Math.round(pos.accuracyM)} m` : ""}` } : null;
  const older = snap.request && snap.request.status === "COMPLETED" && snap.request.latitude != null && pos && pos.source !== "REQUESTED" && snap.request.capturedAt ? { lat: snap.request.latitude, lng: snap.request.longitude!, accuracyM: snap.request.accuracyM, label: `Requested fix · ${fmtDT(snap.request.capturedAt)}` } : null;
  const site = snap.site && snap.site.latitude != null && snap.site.longitude != null ? { name: snap.site.name, lat: snap.site.latitude, lng: snap.site.longitude, radiusM: snap.site.radiusM } : null;
  const busy = !!liveReq && isOpen(liveReq.status);
  const btn = "inline-flex h-8 items-center gap-1 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-[12.5px] font-medium text-ink hover:bg-surface-2 disabled:opacity-50";

  const identity = (
    <div className="shrink-0 rounded-[var(--radius-card)] border border-line bg-surface" data-testid="guard-identity">
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
      <div className="flex min-w-[220px] items-center gap-3">
        <Avatar src={profile.photoUrl} name={snap.guard.name} size={40} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><h1 className="truncate text-[18px] font-semibold leading-tight text-ink">{snap.guard.name}</h1><Status tone={profile.liveTone}>{profile.liveLabel}</Status>{snap.guard.watched && <Pill tone="warn">watched</Pill>}{!snap.guard.active && <Pill tone="critical">deactivated</Pill>}</div>
          <div className="truncate text-[12.5px] text-ink-2">{snap.guard.guardNo} · <a href={`tel:${snap.guard.phone}`} className="underline">{snap.guard.phone}</a>{snap.device ? ` · ${snap.device.deviceName}` : " · no guard phone"}</div>
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink-2 lg:ml-auto">
        <span className="inline-flex items-center gap-1.5"><Status tone={p.connection.tone} pulse={p.connection.state === "ONLINE"}>{p.connection.label}</Status>{p.connection.lastSeenAt && <span className="text-ink-3" suppressHydrationWarning>heartbeat {ago(p.connection.lastSeenAt, now)}</span>}</span>
        <span>{snap.shift ? <><span className="font-medium text-ink">On shift</span> · {snap.shift.siteName} · {fmtT(snap.shift.startAt)}–{fmtT(snap.shift.endAt)}</> : <span className="text-ink-3">Off shift</span>}</span>
        {snap.device?.batteryLevel != null && <span className={cn(snap.device.batteryLevel < 15 && "text-critical")}>Battery {snap.device.batteryLevel}%</span>}
        {snap.shift && snap.device && snap.site && snap.site.latitude == null && <Link href={`/locations/${snap.site.id}/edit`} title="GPS verification is off until the site is placed on the map. SMS and call attendance still work."><Pill tone="warn">site has no coordinates</Pill></Link>}
        {profile.attendance && <span className="inline-flex items-center gap-1.5"><span className="text-ink-3">Check-in</span><Status tone={profile.attendance.tone}>{profile.attendance.label}</Status></span>}
        {snap.openAlerts > 0 && <Pill tone="critical">{snap.openAlerts} open alert{snap.openAlerts > 1 ? "s" : ""}</Pill>}
      </div>
    </div>
      {/* The actions get their own row: inline, seven buttons squeezed the guard's name to two letters. */}
      {actions && <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2">{actions}</div>}
    </div>
  );

  const locationBlock = (
    <div className="space-y-3" data-testid="location-state">
      <div>
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">Device connection</div>
        <div className="mt-0.5 flex items-center justify-between gap-2"><Status tone={p.connection.tone} pulse={p.connection.state === "ONLINE"}>{p.connection.label}</Status><span className="text-[12px] text-ink-3" suppressHydrationWarning>{p.connection.lastSeenAt ? `heartbeat ${ago(p.connection.lastSeenAt, now)}` : ""}</span></div>
        {snap.device && <div className="mt-0.5 text-[12px] text-ink-3">{snap.device.deviceModel ?? "—"}{snap.device.appVersion ? ` · v${snap.device.appVersion}` : ""}{snap.device.networkType ? ` · ${snap.device.networkType}` : ""} · location {snap.device.locationPermission === "background" ? "always allowed" : snap.device.locationPermission === "foreground_only" ? "while using only" : snap.device.locationPermission ?? "unknown"}</div>}
        {snap.device?.buildType === "debug" && <div className="mt-1"><Pill tone="warn">debug build</Pill></div>}
      </div>
      <div>
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">Automatic monitoring</div>
        <div className="mt-0.5"><Status tone={p.monitoring.tone} pulse={p.monitoring.active}>{p.monitoring.label}</Status></div>
        <div className="mt-0.5 text-[12px] text-ink-3">{p.monitoring.detail}</div>
      </div>
      <div>
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">Last verified position</div>
        {pos ? (
          <div className="mt-0.5 text-[13px] text-ink">
            <div className="flex flex-wrap items-center gap-x-2"><span className="tnum">{pos.latitude.toFixed(5)}, {pos.longitude.toFixed(5)}</span><Pill tone={pos.freshness === "LIVE" ? "ok" : pos.freshness === "RECENT" ? "warn" : "muted"}>{pos.freshness.toLowerCase()}</Pill></div>
            <div className="text-[12px] text-ink-3" suppressHydrationWarning>{pos.accuracyM != null ? `±${Math.round(pos.accuracyM)} m · ` : ""}{fmtDT(pos.at)} · {ago(pos.at, now)} · {pos.source === "REQUESTED" ? "requested GPS fix" : "automatic monitoring"}</div>
          </div>
        ) : <div className="mt-0.5 text-[13px] text-ink-3">No position from this phone yet.</div>}
      </div>
      <div>
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">Geofence assessment</div>
        <div className="mt-0.5"><Status tone={p.geofence.tone}>{p.geofence.label}</Status>{p.geofence.distanceM != null && <span className="ml-2 text-[12px] text-ink-3 tnum">{p.geofence.distanceM} m from site</span>}</div>
        <div className="mt-0.5 text-[12px] text-ink-3">{p.geofence.detail}</div>
      </div>
    </div>
  );

  const requestRow = (
    <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2 text-[12.5px]" data-testid="map-request-row">
      {snap.device && canRequest ? <button type="button" onClick={() => req.start({ purpose: "CHECK" })} disabled={busy || req.busy} className={cn(btn, "border-accent/60 bg-accent-soft text-accent-strong hover:bg-accent-soft")} data-testid="request-location"><Icon name="my_location" size="sm" filled />{busy ? "Locating…" : "Request location"}</button> : !snap.device ? <span className="inline-flex items-center gap-1 text-ink-3"><Icon name="location_off" size="sm" />No guard phone: SMS and calls only</span> : null}
      {busy && canRequest && <button type="button" onClick={() => req.cancel()} disabled={req.busy} className={btn}><Icon name="close" size="sm" />Cancel</button>}
      {liveReq && (
        <span className="inline-flex items-center gap-1.5"><Status tone={REQUEST_STATUS_META[liveReq.status].tone} pulse={isOpen(liveReq.status)}>{REQUEST_STATUS_META[liveReq.status].label}</Status>
          <span className="text-ink-3">{isOpen(liveReq.status) ? `${liveReq.secondsLeft} s left` : liveReq.status === "FAILED" && liveReq.failureReason ? FAILURE_META[liveReq.failureReason] : liveReq.accuracyM != null ? `±${Math.round(liveReq.accuracyM)} m · ${fmtDT(liveReq.capturedAt)}` : ""}</span></span>
      )}
      {req.error && <span className="text-critical">{req.error}</span>}
      <span className="ml-auto flex items-center gap-1.5">
        {snap.trail.length > 1 && <button type="button" onClick={() => setShowTrail((v) => !v)} aria-pressed={showTrail} title={`Draw the last ${snap.trail.length} recorded positions as a path`} className={cn(btn, showTrail && "border-accent/60 bg-accent-soft text-accent-strong")}><Icon name="route" size="sm" filled={showTrail} />Path</button>}
        <button type="button" onClick={() => setFitKey((k) => k + 1)} title="Fit the map to the site and the latest position" className={btn}><Icon name="fit_screen" size="sm" />Recenter</button>
        {pos && <button type="button" onClick={() => navigator.clipboard?.writeText(`${pos.latitude.toFixed(6)}, ${pos.longitude.toFixed(6)}`)} title="Copy the coordinates of the last verified position" className={btn}><Icon name="content_copy" size="sm" />Copy</button>}
        {canEditSites && snap.site && liveReq?.status === "COMPLETED" && !liveReq.mock && <Link href={`/locations/${snap.site.id}/edit?fromRequest=${liveReq.id}`} title="Open the site with this fix ready to confirm as the new centre" className={btn}><Icon name="pin_drop" size="sm" />Set site centre</Link>}
      </span>
    </div>
  );

  return (
    <Workspace fill={fill}>
      {identity}
      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[240px_minmax(0,1fr)_300px] 2xl:grid-cols-[290px_minmax(0,1fr)_370px]">
        {/* Profile column */}
        <Panel title="Guard profile" scroll className="order-3 xl:order-1" action={<button type="button" className="text-[12px] text-ink-2 underline xl:hidden" onClick={() => setProfileOpen((v) => !v)}>{profileOpen ? "Less" : "More"}</button>}>
          <div className="space-y-4 p-3.5">
            {locationBlock}
            <div className="border-t border-dashed border-line pt-3">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">Shift and site</div>
              <div className="mt-0.5 text-[13px] text-ink">{snap.shift ? <Link href={`/shifts/${snap.shift.id}`} className="hover:underline">{snap.shift.siteName} · {fmtT(snap.shift.startAt)}–{fmtT(snap.shift.endAt)}</Link> : "Not on shift"}</div>
              {snap.site && <div className="text-[12px] text-ink-3">{snap.site.latitude != null ? `${snap.site.name} · fence ${snap.site.radiusM} m` : `${snap.site.name} · no coordinates`}{canEditSites && <Link href={`/locations/${snap.site.id}/edit`} className="ml-1 underline">edit</Link>}</div>}
            </div>
            <div className={cn("space-y-3 border-t border-dashed border-line pt-3", !profileOpen && "hidden xl:block")}>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                <Fact label="Attendance" strong>{profile.performance.attendancePct}%</Fact>
                <Fact label="Completed" strong>{profile.performance.completed}</Fact>
                <Fact label="Late" strong>{profile.performance.late}</Fact>
                <Fact label="Missed" strong>{profile.performance.missed}</Fact>
                <Fact label="Missed checks" strong>{profile.performance.missedChecks}</Fact>
                <Fact label="Incidents" strong>{profile.performance.incidents}</Fact>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-dashed border-line pt-3">
                <Fact label="Email">{profile.email ? <a href={`mailto:${profile.email}`} className="underline">{profile.email}</a> : "—"}</Fact>
                <Fact label="National ID">{profile.nationalId}</Fact>
                <Fact label="Supervisor">{profile.supervisor ?? "—"}</Fact>
                <Fact label="Usual site">{profile.homeLocation ? <Link href={`/locations/${profile.homeLocation.id}`} className="hover:underline">{profile.homeLocation.name}</Link> : "—"}</Fact>
                <Fact label="Employment">{profile.employment} · since {profile.employedSince}</Fact>
                <Fact label="Emergency contact">{profile.emergencyContact ?? "—"}</Fact>
                <Fact label="Address" className="col-span-2">{profile.address ?? "—"}</Fact>
              </div>
              {profile.watchNote && <div className="rounded-[8px] border border-warn/40 bg-warn-soft px-2.5 py-1.5 text-[12.5px] text-[#8a5e05]"><span className="font-semibold">Watched</span> · {profile.watchNote}</div>}
              {profile.notes && <p className="text-[12.5px] text-ink-2">{profile.notes}</p>}
            </div>
          </div>
        </Panel>

        {/* Map column */}
        <Panel title="Live map" subtitle={pos ? <span suppressHydrationWarning>{`${pos.source === "REQUESTED" ? "Requested fix" : "Monitoring fix"} · ${ago(pos.at, now)}${pos.accuracyM != null ? ` · ±${Math.round(pos.accuracyM)} m` : ""} · ${p.geofence.label.toLowerCase()}`}</span> : "No verified position yet"} className="order-1 min-h-[400px] overflow-hidden xl:order-2 xl:min-h-0" bodyClassName="flex flex-col">
          <div className="relative min-h-[280px] flex-1 xl:min-h-0"><GuardMap site={site} position={mapPosition} requested={older} trail={showTrail ? snap.trail : []} fitKey={fitKey} className="absolute inset-0 flex flex-col p-0" /></div>
          {requestRow}
        </Panel>

        {/* Live feed column */}
        <ActivityFeed guardId={guardId} initial={initialActivity} className="order-2 max-h-[70vh] xl:order-3 xl:max-h-none" />
      </div>

      {/* Detail region: the existing tables, inside a controlled-height panel on desktop */}
      {tabs.length > 0 && <section className={cn("flex min-h-0 flex-col rounded-[var(--radius-card)] border border-line bg-surface", detailOpen ? "xl:h-[31%] xl:min-h-[180px]" : "xl:h-auto")} data-testid="detail-region">
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line px-2 scroll-thin">
          {tabs.map((t) => <Link key={t.key} href={`${pathname}?tab=${t.key}`} scroll={false} className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium", tab === t.key ? "border-accent text-ink" : "border-transparent text-ink-2 hover:text-ink")}>{t.label}</Link>)}
          <button type="button" onClick={() => setDetailOpen((v) => !v)} className="ml-auto hidden px-2 text-[12px] text-ink-3 hover:text-ink xl:block" aria-expanded={detailOpen}>{detailOpen ? "Collapse" : "Expand"}</button>
        </div>
        <div className={cn("min-h-0 flex-1 overflow-auto scroll-thin", !detailOpen && "hidden xl:hidden")}>{children}</div>
        {!detailOpen && <div className="xl:hidden">{children}</div>}
      </section>}
    </Workspace>
  );
}

function ActivityFeed({ guardId, initial, className }: { guardId: string; initial: { items: ActivityItem[]; nextBefore: string | null }; className?: string }) {
  const [items, setItems] = useState<ActivityItem[]>(initial.items);
  const [nextBefore, setNextBefore] = useState<string | null>(initial.nextBefore);
  const [cats, setCats] = useState<ActivityCategory[]>([]);
  const [sev, setSev] = useState<ActivitySeverity | "all">("all");
  const [period, setPeriod] = useState<"24h" | "7d" | "all">("7d");
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const newest = useRef<string | null>(initial.items[0]?.at ?? null);
  const since = useMemo(() => (period === "24h" ? new Date(Date.now() - 86_400_000) : period === "7d" ? new Date(Date.now() - 7 * 86_400_000) : null), [period]);
  const query = useCallback((extra: Record<string, string>) => { const u = new URLSearchParams({ limit: "50", ...extra }); if (cats.length) u.set("cat", cats.join(",")); if (sev !== "all") u.set("severity", sev); if (since && !extra.since) u.set("since", since.toISOString()); return `/api/guards/${guardId}/activity?${u}`; }, [guardId, cats, sev, since]);

  // Reload on filter change.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    let cancelled = false; setLoading(true);
    fetch(query({}), { cache: "no-store" }).then((r) => r.json()).then((j) => { if (cancelled) return; setItems(j.items); setNextBefore(j.nextBefore); newest.current = j.items[0]?.at ?? null; }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [query]);
  // Poll for new items every 30 s: only rows newer than the newest we hold.
  useEffect(() => {
    const id = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      setNow(Date.now());
      try {
        const r = await fetch(query(newest.current ? { since: newest.current } : {}), { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json() as { items: ActivityItem[] };
        if (j.items.length) { setItems((cur) => { const ids = new Set(cur.map((i) => i.id)); const fresh = j.items.filter((i) => !ids.has(i.id)); return fresh.length ? [...fresh, ...cur] : cur; }); newest.current = j.items[0].at; }
      } catch { /* next tick */ }
    }, 30_000);
    return () => clearInterval(id);
  }, [query]);
  const loadMore = async () => { if (!nextBefore) return; setLoading(true); try { const r = await fetch(query({ before: nextBefore }), { cache: "no-store" }); const j = await r.json(); setItems((cur) => [...cur, ...j.items]); setNextBefore(j.nextBefore); } finally { setLoading(false); } };
  const toggleCat = (c: ActivityCategory) => setCats((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));
  const chip = (active: boolean) => cn("h-6 rounded-full border px-2 text-[11.5px] font-medium", active ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink-2 hover:text-ink");

  return (
    <Panel title="Live operations" subtitle={`${items.length} event${items.length === 1 ? "" : "s"} shown`} className={className} scroll action={<select value={period} onChange={(e) => setPeriod(e.target.value as typeof period)} className="h-7 rounded-[8px] border border-line bg-surface px-1.5 text-[12px]" aria-label="Period"><option value="24h">24 h</option><option value="7d">7 days</option><option value="all">All</option></select>}>
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1 border-b border-line bg-surface/95 px-3 py-2 backdrop-blur" data-testid="feed-filters">
        <button type="button" onClick={() => setCats([])} className={chip(cats.length === 0)}>All</button>
        {ACTIVITY_CATEGORIES.map((c) => <button key={c.key} type="button" onClick={() => toggleCat(c.key)} className={chip(cats.includes(c.key))}>{c.label}</button>)}
        <select value={sev} onChange={(e) => setSev(e.target.value as typeof sev)} className="ml-auto h-6 rounded-[8px] border border-line bg-surface px-1 text-[11.5px]" aria-label="Severity"><option value="all">Any severity</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="success">OK</option><option value="info">Info</option></select>
      </div>
      <ol className="divide-y divide-line" data-testid="feed-list">
        {items.length === 0 && !loading && <li><EmptyState title="Nothing in this period" body="Events from the phone, SMS, calls and shifts appear here as they happen." /></li>}
        {items.map((i) => (
          <li key={i.id} className={cn("px-3 py-2", i.severity === "critical" && "bg-critical-soft/40")}>
            <div className="flex items-start gap-2">
              <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", { info: "bg-line-strong", success: "bg-ok", warning: "bg-warn", critical: "bg-critical" }[i.severity])} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2"><span className={cn("truncate text-[13px] font-medium", SEV_TONE[i.severity] === "critical" ? "text-critical" : "text-ink")}>{i.href ? <Link href={i.href} className="hover:underline">{i.title}</Link> : i.title}</span><span className="shrink-0 text-[11px] text-ink-3 tnum" title={fmtDT(i.at)} suppressHydrationWarning>{ago(i.at, now)}</span></div>
                <div className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-ink-3"><span className="uppercase tracking-[0.06em]">{CAT_LABEL[i.category]}</span>{i.late && <span className="rounded-[4px] bg-info-soft px-1 text-[10px] font-semibold uppercase text-[#3a50ad]">synced late</span>}{i.detail && <span className="truncate text-ink-2">{i.detail}</span>}</div>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <div className="px-3 py-2 text-center">{nextBefore ? <button type="button" onClick={loadMore} disabled={loading} className="text-[12.5px] font-medium text-accent-strong hover:underline disabled:opacity-50">{loading ? "Loading…" : "Load older events"}</button> : items.length > 0 ? <span className="text-[11.5px] text-ink-3">End of the period</span> : null}</div>
    </Panel>
  );
}
