import Link from "next/link";
import { requireUser } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { shiftInclude, LIVE_STATUSES } from "@/lib/services/shifts";
import { effectiveGeofence } from "@/lib/site-config";
import { LOCATION_STATE_META, freshness } from "@/lib/geofence";
import { ALERT_META } from "@/lib/gateway/alerts";
import { PageHeader } from "@/components/ui/page";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Status } from "@/components/ui/status";
import { Avatar } from "@/components/ui/avatar";
import { LinkButton, ButtonGroup } from "@/components/ui/button";
import { AutoRefresh } from "@/components/auto-refresh";
import { LiveMap, type LiveGuard, type LiveSite } from "@/components/map/live-map";
import { EmptyState } from "@/components/workspace/panel";
import { fmtDateTime, fmtTime } from "@/lib/time";
import type { LocationEvent } from "@prisma/client";

export const metadata = { title: "Live map" };

/**
 * Where every Android guard on a live shift last was, on one map with every active site's fence.
 * Feature-phone guards are listed without a point: their attendance comes from SMS, not GPS.
 */
export default async function LiveMapPage() {
  await requireUser();
  const now = new Date();
  const shifts = await db.shift.findMany({ where: { status: { in: LIVE_STATUSES } }, include: { ...shiftInclude, guard: { include: { devices: { where: { mode: "GUARD", activationStatus: "ACTIVE" }, take: 1 } } } }, orderBy: { startAt: "asc" } });
  const latest = new Map<string, LocationEvent>();
  if (shifts.length) for (const e of await db.locationEvent.findMany({ where: { shiftId: { in: shifts.map((s) => s.id) }, latitude: { not: null } }, orderBy: { occurredAt: "desc" }, take: 800 })) if (e.shiftId && !latest.has(e.shiftId)) latest.set(e.shiftId, e);
  const openAlerts = await db.guardAlert.findMany({ where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } }, select: { guardId: true, type: true } });
  const alertFor = new Map<string, string>();
  for (const a of openAlerts) if (!alertFor.has(a.guardId)) alertFor.set(a.guardId, ALERT_META[a.type].label);

  const siteMap = new Map<string, LiveSite>();
  const guards: LiveGuard[] = [];
  const noPoint: { shift: (typeof shifts)[number]; why: string }[] = [];
  for (const s of shifts) {
    const fence = effectiveGeofence(s, s.location);
    if (fence) {
      const key = `${s.location.id}:${fence.fence.latitude.toFixed(5)}:${fence.fence.longitude.toFixed(5)}`;
      const site = siteMap.get(key) ?? { id: s.location.id, name: fence.source === "SHIFT_OVERRIDE" ? `${s.location.name} (shift fence)` : s.location.name, lat: fence.fence.latitude, lng: fence.fence.longitude, radiusM: fence.fence.radiusM, href: `/locations/${s.location.id}`, guards: 0 };
      site.guards += 1; siteMap.set(key, site);
    }
    const name = `${s.guard.firstName} ${s.guard.lastName}`;
    if (s.guard.deviceKind !== "ANDROID_GUARD") { noPoint.push({ shift: s, why: "feature phone · SMS attendance" }); continue; }
    const e = latest.get(s.id);
    const dev = s.guard.devices[0];
    if (e?.latitude != null && e.longitude != null) {
      const f = freshness(e.occurredAt, now, e.syncStatus);
      guards.push({ id: s.id, name, lat: e.latitude, lng: e.longitude, state: e.locationState, at: fmtDateTime(e.occurredAt), freshness: f.label, accuracyM: e.accuracyM, href: `/shifts/${s.id}`, alert: alertFor.get(s.guardId) ?? null });
    } else if (dev?.lastLatitude != null && dev.lastLongitude != null) {
      const f = freshness(dev.lastLocationAt, now);
      guards.push({ id: s.id, name, lat: dev.lastLatitude, lng: dev.lastLongitude, state: dev.lastLocationState ?? "UNKNOWN", at: fmtDateTime(dev.lastLocationAt), freshness: f.label, accuracyM: dev.lastAccuracyM, href: `/shifts/${s.id}`, alert: alertFor.get(s.guardId) ?? null });
    } else noPoint.push({ shift: s, why: dev ? "no fix yet" : "no active device" });
  }
  const sites = [...siteMap.values()];
  const outside = guards.filter((g) => g.state === "OUTSIDE").length;
  const stale = guards.filter((g) => g.freshness === "STALE").length;

  return (
    <div>
      <AutoRefresh seconds={30} />
      <PageHeader title="Live map" description={`${guards.length} positioned on ${shifts.length} live shift${shifts.length === 1 ? "" : "s"} · ${outside} off site · ${stale} stale · ${noPoint.length} without a fix`} actions={
        <ButtonGroup><LinkButton href="/operations">Active operations</LinkButton><LinkButton href="/operations/exceptions">Location exceptions</LinkButton><LinkButton href="/alerts">Guard alerts</LinkButton></ButtonGroup>
      } />
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <Card><CardBody>{sites.length === 0 && guards.length === 0 ? <EmptyState icon="map" title="Nothing to plot yet" detail="No live shift has a site centre, and no guard phone has reported a fix." action={<LinkButton href="/locations" variant="primary" size="sm">Set a site centre</LinkButton>} /> : <LiveMap sites={sites} guards={guards} />}</CardBody></Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Guards on the map" />
            <CardBody className="pt-2">
              {guards.length === 0 && <p className="text-[13px] text-ink-3">None yet.</p>}
              <ul className="divide-y divide-line">
                {guards.map((g) => { const s = shifts.find((x) => x.id === g.id)!; return (
                  <li key={g.id} className="flex items-center gap-3 py-2.5">
                    <Avatar src={s.guard.photoUrl} name={s.guard.firstName} size={28} />
                    <div className="min-w-0 flex-1"><Link href={g.href} className="block truncate text-[13.5px] font-medium text-ink hover:underline">{g.name}</Link><span className="block truncate text-[12px] text-ink-3">{s.location.name} · {fmtTime(s.startAt)}–{fmtTime(s.endAt)}{g.alert ? ` · ${g.alert}` : ""}</span></div>
                    <span className="text-right"><Status tone={g.freshness === "STALE" ? "muted" : LOCATION_STATE_META[g.state].tone}>{LOCATION_STATE_META[g.state].label}</Status><span className="block text-[11px] text-ink-3">{g.freshness.toLowerCase()}</span></span>
                  </li>
                ); })}
              </ul>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Without a point" description="On a live shift but not on the map." />
            <CardBody className="pt-2">
              {noPoint.length === 0 && <p className="text-[13px] text-ink-3">Everyone on shift has a point.</p>}
              <ul className="divide-y divide-line">{noPoint.map(({ shift: s, why }) => <li key={s.id} className="py-2 text-[13px]"><Link href={`/shifts/${s.id}`} className="font-medium text-ink hover:underline">{s.guard.firstName} {s.guard.lastName}</Link><span className="block text-[12px] text-ink-3">{s.location.name} · {why}</span></li>)}</ul>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
