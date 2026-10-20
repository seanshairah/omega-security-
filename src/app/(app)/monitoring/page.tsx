import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { requireUser, can } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { LIVE_STATUSES, STATUS_META } from "@/lib/services/shifts";
import { CHECK_IN_META } from "@/lib/attendance/check-in";
import { Avatar } from "@/components/ui/avatar";
import { Status, Pill, type Tone } from "@/components/ui/status";
import { ButtonGroup, LinkButton } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { GuardWorkspace } from "@/components/guards/guard-workspace";
import { CallGuardButton } from "@/components/calls/call-guard";
import { NotifyClientButton } from "@/components/clients/notify-client";
import { guardWorkspaceData } from "@/lib/services/guard-workspace-data";
import { setGuardWatched } from "@/actions/messages";
import { escalateGuard } from "@/actions/monitoring";
import { audit } from "@/lib/audit";
import { fmtTime } from "@/lib/time";
import { cn } from "@/lib/cn";

export const metadata = { title: "Monitoring" };

type RailRow = { id: string; name: string; photoUrl: string | null; watched: boolean; site: string | null; hours: string | null; shiftLabel: string; shiftTone: Tone; checkIn: { label: string; tone: Tone } | null; alerts: number };

/**
 * Guard Monitoring: one guard at a time, without leaving the page. On the left, the guards worth
 * watching (pinned with Watch, and everyone on duty now); on the right, the selected guard's
 * workspace: identity, shift, check-in and connection always in view, the map beside an activity
 * feed that scrolls on its own, and the actions that matter on a shift.
 */
export default async function MonitoringPage({ searchParams }: { searchParams: Promise<{ guard?: string }> }) {
  const user = await requireUser();
  const { guard: selectedParam } = await searchParams;

  const [watched, live] = await Promise.all([
    db.guard.findMany({ where: { watched: true }, select: { id: true, firstName: true, lastName: true, photoUrl: true }, orderBy: { watchedAt: "desc" } }),
    db.shift.findMany({ where: { status: { in: LIVE_STATUSES } }, include: { guard: { select: { id: true, firstName: true, lastName: true, photoUrl: true, watched: true } }, location: { select: { name: true } }, attendanceCheckIn: { select: { status: true } } }, orderBy: { startAt: "asc" } }),
  ]);
  const ids = [...new Set([...watched.map((g) => g.id), ...live.map((s) => s.guardId)])];
  const openAlerts = ids.length ? await db.guardAlert.groupBy({ by: ["guardId"], where: { guardId: { in: ids }, status: "OPEN" }, _count: true }) : [];

  const row = (g: { id: string; firstName: string; lastName: string; photoUrl: string | null }, isWatched: boolean): RailRow => {
    const s = live.find((x) => x.guardId === g.id);
    const meta = s ? STATUS_META[s.status] : null;
    return {
      id: g.id, name: `${g.firstName} ${g.lastName}`, photoUrl: g.photoUrl, watched: isWatched,
      site: s?.location.name ?? null, hours: s ? `${fmtTime(s.startAt)}–${fmtTime(s.endAt)}` : null,
      shiftLabel: meta?.label ?? "Off duty", shiftTone: (meta?.tone ?? "muted") as Tone,
      checkIn: s?.attendanceCheckIn ? { label: CHECK_IN_META[s.attendanceCheckIn.status].label, tone: CHECK_IN_META[s.attendanceCheckIn.status].tone } : null,
      alerts: openAlerts.find((a) => a.guardId === g.id)?._count ?? 0,
    };
  };
  const watchedRows = watched.map((g) => row(g, true));
  const dutyRows = live.filter((s) => !s.guard.watched).map((s) => row(s.guard, false));
  // Anything that needs attention first: open alerts, then check-in exceptions.
  const urgency = (r: RailRow) => (r.alerts ? 0 : r.checkIn && (r.checkIn.tone === "critical" || r.checkIn.tone === "warn") ? 1 : 2);
  dutyRows.sort((a, b) => urgency(a) - urgency(b));

  const selectedId = selectedParam && ids.includes(selectedParam) ? selectedParam : watchedRows[0]?.id ?? dutyRows[0]?.id ?? null;
  const data = selectedId ? await guardWorkspaceData(selectedId) : null;
  if (data) await audit({ userId: user.id, actor: user.name, action: "LOCATION_VIEWED", entity: "Guard", entityId: data.guard.id, details: { via: "monitoring" } });

  const g = data?.guard;
  const name = g ? `${g.firstName} ${g.lastName}` : "";
  const shift = data?.snapshot.shift as { id: string } | null | undefined;
  const actions = g && (
    <ButtonGroup>
      {g.active && <CallGuardButton guardId={g.id} guardName={name} shiftId={shift?.id ?? null} size="sm" />}
      {g.active && <NotifyClientButton guardId={g.id} shiftId={shift?.id ?? null} size="sm" />}
      <LinkButton href={`/incidents/new?guardId=${g.id}${shift ? `&shiftId=${shift.id}` : ""}`} size="sm">Record incident</LinkButton>
      {shift && <LinkButton href={`/shifts/${shift.id}`} size="sm">View shift</LinkButton>}
      <ConfirmButton size="sm" label="Escalate" variant="danger" title={`Escalate ${name}?`} body="Sends a critical alert to every portal user's devices and writes it on the shift timeline. It does not contact the client." withNote="Why? (shown in the alert)" confirmLabel="Escalate" action={async (note) => { "use server"; await escalateGuard(g.id, note); }} />
      {can.manageGuards(user) && (g.watched
        ? <ConfirmButton size="sm" label="Stop watching" title={`Stop watching ${name}?`} body="Their events return to normal priority. They stay here while they are on duty." confirmLabel="Stop watching" action={async () => { "use server"; await setGuardWatched(g.id, false); }} />
        : <ConfirmButton size="sm" label="Watch" title={`Watch ${name} closely?`} body="Every event about them is raised to at least a warning and pushed to your devices." withNote="Why are you watching them?" confirmLabel="Start watching" action={async (note) => { "use server"; await setGuardWatched(g.id, true, note); }} />)}
    </ButtonGroup>
  );

  const all = [...watchedRows, ...dutyRows];
  return (
    // Below 2xl the guard list is a strip above the workspace, so the map keeps its width on a laptop.
    <div className="flex flex-col gap-3 xl:h-[calc(100dvh-6.75rem)] 2xl:grid 2xl:grid-cols-[264px_minmax(0,1fr)]">
      <aside className="flex min-h-0 shrink-0 flex-col rounded-[var(--radius-card)] border border-line bg-surface" aria-label="Guards being monitored">
        <header className="flex shrink-0 items-baseline justify-between gap-2 border-b border-line px-3.5 py-2 2xl:block 2xl:py-2.5">
          <h1 className="text-[15px] font-semibold text-ink">Monitoring</h1>
          <p className="text-[12px] text-ink-3">{watchedRows.length} watched · {live.length} on duty</p>
        </header>
        <ul className="flex gap-1 overflow-x-auto p-1.5 scroll-thin 2xl:hidden">
          {all.length === 0 && <li className="px-2 py-1 text-[12px] text-ink-3">Nobody is watched or on duty.</li>}
          {all.map((r) => <li key={r.id} className="w-[236px] shrink-0"><RailItem r={r} selected={r.id === selectedId} /></li>)}
        </ul>
        <div className="hidden min-h-0 flex-1 overflow-y-auto scroll-thin 2xl:block">
          <RailGroup title="Watched" rows={watchedRows} selectedId={selectedId} empty="Nobody is watched. Open a guard and choose Watch to pin them here." />
          <RailGroup title="On duty now" rows={dutyRows} selectedId={selectedId} empty="Nobody else is on duty." />
        </div>
      </aside>

      {data ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <GuardWorkspace key={data.guard.id} initial={data.snapshot} profile={data.profile} canRequest={can.manageGuards(user)} canEditSites={can.manageLocations(user)} actions={actions} initialActivity={data.activity} fill />
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-line bg-surface px-6 py-16 text-center">
          <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-ink-3"><Icon name="visibility" size={20} filled /></span>
          <p className="text-[14px] font-medium text-ink">No guard to monitor</p>
          <p className="mt-1 max-w-md text-[13px] text-ink-2">Nobody is on duty and nobody is watched. Guards appear here when a shift starts, or when you choose Watch on a guard.</p>
          <LinkButton href="/guards" className="mt-4" size="sm">Go to guards</LinkButton>
        </div>
      )}
    </div>
  );
}

function RailGroup({ title, rows, selectedId, empty }: { title: string; rows: RailRow[]; selectedId: string | null; empty: string }) {
  return (
    <section className="py-1.5">
      <h2 className="px-3.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">{title}</h2>
      {rows.length === 0 ? <p className="px-3.5 pb-2 text-[12px] text-ink-3">{empty}</p> : (
        <ul>
          {rows.map((r) => <li key={r.id}><RailItem r={r} selected={r.id === selectedId} /></li>)}
        </ul>
      )}
    </section>
  );
}

function RailItem({ r, selected }: { r: RailRow; selected: boolean }) {
  return (
    <Link href={`/monitoring?guard=${r.id}`} scroll={false} aria-current={selected ? "true" : undefined}
      className={cn("flex items-start gap-2.5 rounded-[10px] px-2.5 py-2 hover:bg-surface-2 2xl:rounded-none 2xl:px-3.5", selected && "bg-accent-soft hover:bg-accent-soft")}>
      <Avatar src={r.photoUrl} name={r.name} size={32} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5"><span className="truncate text-[13px] font-medium text-ink">{r.name}</span>{r.watched && <Icon name="visibility" size={13} className="shrink-0 text-ink-3" />}{r.alerts > 0 && <Pill tone="critical">{r.alerts}</Pill>}</span>
        <span className="block truncate text-[11.5px] text-ink-3">{r.site ? `${r.site} · ${r.hours}` : "Not on shift"}</span>
        <span className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5"><Status tone={r.shiftTone}>{r.shiftLabel}</Status>{r.checkIn && <Status tone={r.checkIn.tone}>{r.checkIn.label}</Status>}</span>
      </span>
    </Link>
  );
}
