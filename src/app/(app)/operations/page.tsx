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
import { effectiveGeofence } from "@/lib/site-config";
import type { EvidenceSource, LocationEvent } from "@prisma/client";
import { arrivalSource, phoneGroup, ARRIVAL_SOURCE_LABEL, type ArrivalSource, type PhoneGroup } from "@/lib/attendance/arrival-source";

export const metadata = { title: "Active operations" };

export default async function OperationsPage({ searchParams }: { searchParams: Promise<{ f?: string; phone?: string; by?: string }> }) {
  await requireUser();
  const { f = "all", phone = "all", by = "any" } = await searchParams;
  const all = await db.shift.findMany({ where: { OR: [{ status: { in: LIVE_STATUSES } }, { status: "SCHEDULED", startAt: { lte: new Date(Date.now() + 3 * 3600_000) } }] }, include: { ...shiftInclude, welfareChecks: { orderBy: { sentAt: "desc" }, take: 1 } }, orderBy: [{ startAt: "asc" }] });
  // Latest location event per shift, for guards with a device. Feature-phone guards show "—".
  const latestLoc = new Map<string, LocationEvent>();
  if (all.length) for (const e of await db.locationEvent.findMany({ where: { shiftId: { in: all.map((s) => s.id) } }, orderBy: { occurredAt: "desc" }, take: 500 })) if (e.shiftId && !latestLoc.has(e.shiftId)) latestLoc.set(e.shiftId, e);
  // A site with no coordinates cannot be GPS-verified. It is said here, not discovered on a phone.
  const noFence = all.filter((s) => s.guard.deviceKind === "ANDROID_GUARD" && !effectiveGeofence(s, s.location));
  const sitesNoFence = [...new Map(noFence.map((s) => [s.locationId, s.location])).values()];
  const loc = (s: (typeof all)[number]) => {
    if (s.guard.deviceKind !== "ANDROID_GUARD") return <span className="text-ink-3">—</span>;
    if (!effectiveGeofence(s, s.location)) return <Status tone="warn">Site has no coordinates</Status>;
    const e = latestLoc.get(s.id);
    if (!e) return <Status tone="muted">No fix yet</Status>;
    const f = freshness(e.occurredAt, new Date(), e.syncStatus);
    const m = LOCATION_STATE_META[e.locationState];
    return <span><Status tone={f.label === "STALE" ? "muted" : m.tone}>{m.label}</Status><span className="block text-[12px] text-ink-3">{f.label.toLowerCase()} · {fmtTime(e.occurredAt)}</span></span>;
  };
  // Shifts with a clock-in, welfare call or clock-out waiting for a person (a missed call, a short call, two shifts at once).
  const pendingIds = new Set(all.length ? (await db.attendanceEvidence.findMany({ where: { shiftId: { in: all.map((s) => s.id) }, status: { in: ["PENDING", "PROVISIONAL"] } }, select: { shiftId: true } })).map((e) => e.shiftId) : []);
  const groups = {
    pending: all.filter((s) => pendingIds.has(s.id)),
    all: all,
    attention: all.filter((s) => ["LATE", "NOT_CONFIRMED", "ASSISTANCE", "INCIDENT", "CRITICAL"].includes(s.status)),
    onduty: all.filter((s) => s.status === "ON_DUTY"),
    upcoming: all.filter((s) => s.status === "SCHEDULED" || s.status === "AWAITING_ARRIVAL"),
    watched: all.filter((s) => s.guard.watched),
    welfare: all.filter((s) => (s.attendance?.missedChecks ?? 0) > 0 || s.welfareChecks[0]?.response === "NO_RESPONSE"),
    checkout: all.filter((s) => s.endAt.getTime() < Date.now() && !s.attendance?.completionConfirmedAt),
    location: all.filter((s) => { const e = latestLoc.get(s.id); return e && (e.locationState === "OUTSIDE" || e.eventType === "LOCATION_UNAVAILABLE" || e.eventType === "LOCATION_VERIFICATION_OVERDUE"); }),
  };
  // How each arrival is known, from the evidence. A call or an SMS is never shown as GPS.
  const confirmed = new Map<string, EvidenceSource[]>();
  if (all.length) for (const e of await db.attendanceEvidence.findMany({ where: { shiftId: { in: all.map((s) => s.id) }, status: "CONFIRMED", kind: { in: ["CHECK_IN", "PRESENCE"] }, NOT: { flags: { has: "SIMULATED" } } }, select: { shiftId: true, source: true } })) confirmed.set(e.shiftId, [...(confirmed.get(e.shiftId) ?? []), e.source]);
  const sourceOf = (s: (typeof all)[number]): ArrivalSource => arrivalSource({ arrivalConfirmedAt: s.attendance?.arrivalConfirmedAt ?? null, gpsVerified: s.attendance?.locationVerification === "VERIFIED", confirmedSources: confirmed.get(s.id) ?? [] });
  const phoneOf = (s: (typeof all)[number]): PhoneGroup => phoneGroup(s.guard);
  const byPhone = (s: (typeof all)[number]) => phone === "all" || phoneOf(s) === phone.toUpperCase();
  const bySource = (s: (typeof all)[number]) => by === "any" || sourceOf(s) === by.toUpperCase();
  const rows = (groups[f as keyof typeof groups] ?? all).filter((s) => byPhone(s) && bySource(s));
  const href = (o: { f?: string; phone?: string; by?: string }) => {
    const q = new URLSearchParams();
    const v = { f, phone, by, ...o };
    if (v.f !== "all") q.set("f", v.f);
    if (v.phone !== "all") q.set("phone", v.phone);
    if (v.by !== "any") q.set("by", v.by);
    const qs = q.toString();
    return qs ? `/operations?${qs}` : "/operations";
  };
  const arrivalBy = (s: (typeof all)[number]) => {
    const src = sourceOf(s);
    return src === "NONE" ? null : <span className="block text-[12px] text-ink-3">{ARRIVAL_SOURCE_LABEL[src]}</span>;
  };
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
      {sitesNoFence.length > 0 && (
        <div role="status" className="mb-4 flex gap-2.5 rounded-[var(--radius-card)] border border-warn/40 bg-warn-soft px-4 py-3 text-[13px] text-ink">
          <Icon name="location_off" size={18} className="mt-0.5 shrink-0 text-warn" />
          <p><span className="font-semibold">GPS verification is off at {sitesNoFence.length === 1 ? "1 site" : `${sitesNoFence.length} sites`} with guards on duty or starting soon</span>, because the site has no coordinates. Attendance by SMS and call still works. Place the site on the map: {sitesNoFence.map((l, i) => <span key={l.id}>{i > 0 && ", "}<Link href={`/locations/${l.id}/edit`} className="font-medium underline">{l.name}</Link></span>)}.</p>
        </div>
      )}
      <Segments className="mb-4" items={[
        { href: href({ f: "all" }), label: "All", count: groups.all.length, active: f === "all" },
        { href: href({ f: "attention" }), label: "Needs attention", count: groups.attention.length, active: f === "attention", tone: "critical" },
        ...(groups.pending.length ? [{ href: href({ f: "pending" }), label: "Attendance to confirm", count: groups.pending.length, active: f === "pending", tone: "warn" as const }] : []),
        { href: href({ f: "onduty" }), label: "On duty", count: groups.onduty.length, active: f === "onduty", tone: "ok" },
        { href: href({ f: "upcoming" }), label: "Starting soon", count: groups.upcoming.length, active: f === "upcoming", tone: "neutral" },
        ...(groups.watched.length ? [{ href: href({ f: "watched" }), label: "Watched", count: groups.watched.length, active: f === "watched", tone: "warn" as const }] : []),
        ...(groups.welfare.length ? [{ href: href({ f: "welfare" }), label: "Missed welfare checks", count: groups.welfare.length, active: f === "welfare", tone: "warn" as const }] : []),
        ...(groups.checkout.length ? [{ href: href({ f: "checkout" }), label: "Not checked out", count: groups.checkout.length, active: f === "checkout", tone: "warn" as const }] : []),
        ...(groups.location.length ? [{ href: href({ f: "location" }), label: "Location exceptions", count: groups.location.length, active: f === "location", tone: "critical" as const }] : []),
      ]} />
      <div className="mb-4 flex flex-wrap gap-2">
        <Segments items={[
          { href: href({ phone: "all" }), label: "All phones", active: phone === "all" },
          { href: href({ phone: "basic" }), label: "Basic phones", count: all.filter((s) => phoneOf(s) === "BASIC").length, active: phone === "basic" },
          { href: href({ phone: "android" }), label: "Guard app", count: all.filter((s) => phoneOf(s) === "ANDROID").length, active: phone === "android" },
          { href: href({ phone: "unknown" }), label: "Phone not known", count: all.filter((s) => phoneOf(s) === "UNKNOWN").length, active: phone === "unknown" },
        ]} />
        <Segments items={[
          { href: href({ by: "any" }), label: "Any arrival", active: by === "any" },
          ...(["gps", "network", "call", "sms", "manual", "none"] as const).map((k) => ({ href: href({ by: k }), label: k === "none" ? "Not confirmed" : ARRIVAL_SOURCE_LABEL[k.toUpperCase() as ArrivalSource], count: all.filter((s) => byPhone(s) && sourceOf(s) === k.toUpperCase()).length, active: by === k })),
        ]} />
      </div>
      <Card>
        <Rows cards={
          rows.length === 0 ? <EmptyState title="No shifts here" body="Shifts appear as they start." /> : rows.map((s) => (
            <CardRow key={s.id} href={`/shifts/${s.id}`} tone={s.status === "CRITICAL" ? "critical" : undefined}
              avatar={<Avatar src={s.guard.photoUrl} name={s.guard.firstName} size={36} />}
              title={<>{s.guard.firstName} {s.guard.lastName}{s.guard.watched && <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-warn">watched</span>}</>}
              subtitle={`${s.location.name} · ${fmtTime(s.startAt)}–${fmtTime(s.endAt)}`}
              right={<ShiftStatusLabel status={s.status} startAt={s.startAt} />}
              meta={[
                { label: "Arrival", value: s.attendance?.arrivalConfirmedAt ? `${fmtTime(s.attendance.arrivalConfirmedAt)} · ${ARRIVAL_SOURCE_LABEL[sourceOf(s)].toLowerCase()}` : s.status === "SCHEDULED" ? "—" : "Not confirmed" },
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
                <td className="tnum">{s.attendance?.arrivalConfirmedAt ? <><Status tone={(s.attendance.lateMinutes ?? 0) > 15 ? "warn" : "ok"}>{fmtTime(s.attendance.arrivalConfirmedAt)}{(s.attendance.lateMinutes ?? 0) > 15 ? ` · ${s.attendance.lateMinutes} min late` : ""}</Status>{arrivalBy(s)}</> : s.status === "SCHEDULED" ? <span className="text-ink-3">—</span> : <Status tone={s.status === "AWAITING_ARRIVAL" ? "neutral" : "critical"}>Not confirmed</Status>}</td>
                <td>{welfare(s)}</td>
                <td>{loc(s)}</td>
                <td><ShiftStatusLabel status={s.status} startAt={s.startAt} /></td>
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
