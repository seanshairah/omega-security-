import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { requireUser } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { shiftInclude, LIVE_STATUSES } from "@/lib/services/shifts";
import { PageHeader, Segments } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Table, THead, TBody, Empty } from "@/components/ui/table";
import { Avatar } from "@/components/ui/avatar";
import { Status } from "@/components/ui/status";
import { ShiftStatusLabel } from "@/components/shift-status";
import { LinkButton } from "@/components/ui/button";
import { CallGuardButton } from "@/components/calls/call-guard";
import { fmtTime, ago } from "@/lib/time";
import { cn } from "@/lib/cn";
import { Rows, CardRow } from "@/components/ui/rows";
import { Empty as EmptyState } from "@/components/ui/table";
import { LOCATION_STATE_META, freshness } from "@/lib/geofence";
import type { LocationEvent } from "@prisma/client";

export const metadata = { title: "Active operations" };

export default async function OperationsPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  await requireUser();
  const { f = "all" } = await searchParams;
  const all = await db.shift.findMany({ where: { OR: [{ status: { in: LIVE_STATUSES } }, { status: "SCHEDULED", startAt: { lte: new Date(Date.now() + 3 * 3600_000) } }] }, include: { ...shiftInclude, welfareChecks: { orderBy: { sentAt: "desc" }, take: 1 } }, orderBy: [{ startAt: "asc" }] });
  // Latest location event per shift, for guards with a device. Feature-phone guards show "—".
  const latestLoc = new Map<string, LocationEvent>();
  if (all.length) for (const e of await db.locationEvent.findMany({ where: { shiftId: { in: all.map((s) => s.id) } }, orderBy: { occurredAt: "desc" }, take: 500 })) if (e.shiftId && !latestLoc.has(e.shiftId)) latestLoc.set(e.shiftId, e);
  const loc = (s: (typeof all)[number]) => {
    if (s.guard.deviceKind !== "ANDROID_GUARD") return <span className="text-ink-3">—</span>;
    const e = latestLoc.get(s.id);
    if (!e) return <Status tone="muted">No fix yet</Status>;
    const f = freshness(e.occurredAt, new Date(), e.syncStatus);
    const m = LOCATION_STATE_META[e.locationState];
    return <span><Status tone={f.label === "STALE" ? "muted" : m.tone}>{m.label}</Status><span className="block text-[12px] text-ink-3">{f.label.toLowerCase()} · {fmtTime(e.occurredAt)}</span></span>;
  };
  const groups = {
    all: all,
    attention: all.filter((s) => ["LATE", "NOT_CONFIRMED", "ASSISTANCE", "INCIDENT", "CRITICAL"].includes(s.status)),
    onduty: all.filter((s) => s.status === "ON_DUTY"),
    upcoming: all.filter((s) => s.status === "SCHEDULED" || s.status === "AWAITING_ARRIVAL"),
    watched: all.filter((s) => s.guard.watched),
    location: all.filter((s) => { const e = latestLoc.get(s.id); return e && (e.locationState === "OUTSIDE" || e.eventType === "LOCATION_UNAVAILABLE" || e.eventType === "LOCATION_VERIFICATION_OVERDUE"); }),
  };
  const rows = groups[f as keyof typeof groups] ?? all;
  const welfare = (s: (typeof all)[number]) => {
    const w = s.welfareChecks[0];
    if (!w) return <span className="text-ink-3">—</span>;
    if (w.response === "WELL") return <Status tone="ok">OK {fmtTime(w.respondedAt)}</Status>;
    if (w.response === "ASSISTANCE") return <Status tone="warn">Assistance</Status>;
    if (w.response === "INCIDENT") return <Status tone="critical">Incident</Status>;
    if (w.response === "NO_RESPONSE") return <Status tone="warn">Missed</Status>;
    return <Status tone="neutral">Pending</Status>;
  };

  return (
    <div>
      <PageHeader title="Active operations" description="Every live shift, refreshed as guards reply. Click a row for the full timeline." actions={<span className="flex flex-wrap gap-2"><LinkButton href="/operations/map">Live map</LinkButton><LinkButton href="/operations/exceptions">Location exceptions</LinkButton><LinkButton href="/alerts">Guard alerts</LinkButton><LinkButton href="/shifts/new" variant="primary">New shift</LinkButton></span>} />
      <Segments className="mb-4" items={[
        { href: "/operations", label: "All", count: groups.all.length, active: f === "all" },
        { href: "/operations?f=attention", label: "Needs attention", count: groups.attention.length, active: f === "attention", tone: "critical" },
        { href: "/operations?f=onduty", label: "On duty", count: groups.onduty.length, active: f === "onduty", tone: "ok" },
        { href: "/operations?f=upcoming", label: "Starting soon", count: groups.upcoming.length, active: f === "upcoming", tone: "neutral" },
        ...(groups.watched.length ? [{ href: "/operations?f=watched", label: "Watched", count: groups.watched.length, active: f === "watched", tone: "warn" as const }] : []),
        ...(groups.location.length ? [{ href: "/operations?f=location", label: "Location exceptions", count: groups.location.length, active: f === "location", tone: "critical" as const }] : []),
      ]} />
      <Card>
        <Rows cards={
          rows.length === 0 ? <EmptyState title="No shifts here" body="Shifts appear as they start." /> : rows.map((s) => (
            <CardRow key={s.id} href={`/shifts/${s.id}`} tone={s.status === "CRITICAL" ? "critical" : undefined}
              avatar={<Avatar src={s.guard.photoUrl} name={s.guard.firstName} size={36} />}
              title={<>{s.guard.firstName} {s.guard.lastName}{s.guard.watched && <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-warn">watched</span>}</>}
              subtitle={`${s.location.name} · ${fmtTime(s.startAt)}–${fmtTime(s.endAt)}`}
              right={<ShiftStatusLabel status={s.status} />}
              meta={[
                { label: "Arrival", value: s.attendance?.arrivalConfirmedAt ? fmtTime(s.attendance.arrivalConfirmedAt) : s.status === "SCHEDULED" ? "—" : "Not confirmed" },
                { label: "Mid-shift", value: welfare(s) },
                { label: "Location", value: loc(s) },
              ]} />
          ))
        } table={
        <Table>
          <THead><tr><th>Guard</th><th>Site</th><th>Shift</th><th>Arrival</th><th>Mid-shift</th><th>Location</th><th>Status</th><th>Last update</th><th></th></tr></THead>
          <TBody>
            {rows.length === 0 && <Empty colSpan={9} title="No shifts here" body="Shifts appear as they start. Create one or wait for the next scheduled start." />}
            {rows.map((s) => (
              <tr key={s.id} className={cn(s.status === "CRITICAL" && "bg-critical-soft/40")}>
                <td>
                  <Link href={`/guards/${s.guardId}`} className="flex items-center gap-3">
                    <Avatar src={s.guard.photoUrl} name={`${s.guard.firstName} ${s.guard.lastName}`} size={32} />
                    <div><div className="font-medium text-ink">{s.guard.firstName} {s.guard.lastName}{s.guard.watched && <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-warn">watched</span>}</div><div className="text-[12px] text-ink-3">{s.guard.guardNo}</div></div>
                  </Link>
                </td>
                <td><div className="text-ink">{s.location.name}</div><div className="text-[12px] text-ink-3">{s.location.client.name}</div></td>
                <td className="tnum text-ink">{fmtTime(s.startAt)}–{fmtTime(s.endAt)}</td>
                <td className="tnum">{s.attendance?.arrivalConfirmedAt ? <Status tone={(s.attendance.lateMinutes ?? 0) > 15 ? "warn" : "ok"}>{fmtTime(s.attendance.arrivalConfirmedAt)}{(s.attendance.lateMinutes ?? 0) > 15 ? ` · ${s.attendance.lateMinutes} min late` : ""}</Status> : s.status === "SCHEDULED" ? <span className="text-ink-3">—</span> : <Status tone={s.status === "AWAITING_ARRIVAL" ? "neutral" : "critical"}>Not confirmed</Status>}</td>
                <td>{welfare(s)}</td>
                <td>{loc(s)}</td>
                <td><ShiftStatusLabel status={s.status} /></td>
                <td className="text-ink-3">{ago(s.updatedAt)}</td>
                <td className="text-right"><span className="inline-flex items-center gap-1"><CallGuardButton guardId={s.guardId} guardName={`${s.guard.firstName} ${s.guard.lastName}`} shiftId={s.id} size="sm" variant="ghost" label="Call" /><Link href={`/monitoring?guard=${s.guardId}`} className="inline-flex h-8 items-center px-2 text-[13px] font-medium text-ink-2 hover:text-ink">Monitor</Link><Link href={`/shifts/${s.id}`} className="inline-flex items-center gap-1 text-[13px] font-medium text-ink-2 hover:text-ink">Timeline <Icon name="chevron_right" size={12} filled /></Link></span></td>
              </tr>
            ))}
          </TBody>
        </Table>
        } />
      </Card>
    </div>
  );
}
