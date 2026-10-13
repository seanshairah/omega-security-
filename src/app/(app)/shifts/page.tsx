import Link from "next/link";
import { addDays, startOfDay, subDays } from "date-fns";
import { requireUser, can } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { shiftInclude } from "@/lib/services/shifts";
import { PageHeader, Segments } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Table, THead, TBody, Empty } from "@/components/ui/table";
import { ShiftStatusLabel } from "@/components/shift-status";
import { ButtonGroup, LinkButton } from "@/components/ui/button";
import { Select, Input } from "@/components/ui/form";
import { Status } from "@/components/ui/status";
import { fmtTime, fmtDate, fmtDuration } from "@/lib/time";
import { setRecurrenceActive } from "@/actions/shifts";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Rows, CardRow } from "@/components/ui/rows";

export const metadata = { title: "Shifts" };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function ShiftsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const view = sp.view ?? "upcoming";
  const today = startOfDay(new Date());
  const where: Prisma.ShiftWhereInput = {};
  if (view === "today") where.startAt = { gte: today, lt: addDays(today, 1) };
  else if (view === "upcoming") where.startAt = { gte: new Date() };
  else if (view === "past") where.startAt = { lt: new Date(), gte: subDays(today, 30) };
  if (sp.guardId) where.guardId = sp.guardId;
  if (sp.locationId) where.locationId = sp.locationId;
  if (sp.status) where.status = sp.status as never;
  if (sp.date) { const d = new Date(sp.date); where.startAt = { gte: d, lt: addDays(d, 1) }; }

  const [shifts, guards, locations, recurrences, counts] = await Promise.all([
    view === "recurring" ? [] : db.shift.findMany({ where, include: shiftInclude, orderBy: { startAt: view === "past" ? "desc" : "asc" }, take: 200 }),
    db.guard.findMany({ where: { active: true }, orderBy: { lastName: "asc" } }),
    db.location.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.shiftRecurrence.findMany({ include: { guard: true, location: true }, orderBy: { createdAt: "desc" } }),
    Promise.all([db.shift.count({ where: { startAt: { gte: today, lt: addDays(today, 1) } } }), db.shift.count({ where: { startAt: { gte: new Date() } } })]),
  ]);

  return (
    <div>
      <PageHeader title="Shifts" description="Schedule guards to sites. Duration and the welfare midpoint are worked out for you." actions={can.manageShifts(user) && (
        <ButtonGroup><LinkButton href="/shifts/recurring/new">Recurring pattern</LinkButton><LinkButton href="/shifts/new" variant="primary">New shift</LinkButton></ButtonGroup>
      )} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segments items={[
          { href: "/shifts?view=today", label: "Today", count: counts[0], active: view === "today" },
          { href: "/shifts?view=upcoming", label: "Upcoming", count: counts[1], active: view === "upcoming" },
          { href: "/shifts?view=past", label: "Last 30 days", active: view === "past" },
          { href: "/shifts?view=recurring", label: "Recurring", count: recurrences.filter((r) => r.active).length, active: view === "recurring" },
        ]} />
        {view !== "recurring" && (
          <form className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="view" value={view} />
            <Select name="guardId" defaultValue={sp.guardId ?? ""} className="w-44"><option value="">All guards</option>{guards.map((g) => <option key={g.id} value={g.id}>{g.firstName} {g.lastName}</option>)}</Select>
            <Select name="locationId" defaultValue={sp.locationId ?? ""} className="w-52"><option value="">All locations</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
            <Input type="date" name="date" defaultValue={sp.date ?? ""} className="w-40" />
            <button className="h-9 rounded-[8px] border border-line bg-surface px-3 text-[13px] font-medium hover:bg-surface-2">Filter</button>
          </form>
        )}
      </div>

      {view === "recurring" ? (
        <Card>
          <Table>
            <THead><tr><th>Guard</th><th>Location</th><th>Days</th><th>Hours</th><th>From</th><th>Until</th><th>Status</th><th></th></tr></THead>
            <TBody>
              {recurrences.length === 0 && <Empty colSpan={8} title="No recurring patterns" body="Set up a pattern for guards who work the same schedule every week." action={<LinkButton href="/shifts/recurring/new" variant="primary" size="sm">Recurring pattern</LinkButton>} />}
              {recurrences.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium text-ink"><Link href={`/guards/${r.guardId}`}>{r.guard.firstName} {r.guard.lastName}</Link></td>
                  <td>{r.location.name}</td>
                  <td className="tnum">{r.daysOfWeek.length === 7 ? "Every day" : r.daysOfWeek.sort().map((d) => DAYS[d]).join(", ")}</td>
                  <td className="tnum">{r.startTime}–{r.endTime}</td>
                  <td className="tnum">{fmtDate(r.startsOn)}</td>
                  <td className="tnum">{r.endsOn ? fmtDate(r.endsOn) : "Open-ended"}</td>
                  <td>{r.active ? <Status tone="ok">Active</Status> : <Status tone="muted">Stopped</Status>}</td>
                  <td className="text-right">{can.manageShifts(user) && (r.active
                    ? <ConfirmButton label="Stop" title="Stop this pattern?" body="Future scheduled shifts from this pattern will be cancelled. Shifts already in progress are not affected." confirmLabel="Stop pattern" variant="danger" action={async () => { "use server"; await setRecurrenceActive(r.id, false); }} />
                    : <ConfirmButton label="Resume" title="Resume this pattern?" body="Shifts will be created again for the coming days." confirmLabel="Resume" action={async () => { "use server"; await setRecurrenceActive(r.id, true); }} />)}</td>
                </tr>
              ))}
            </TBody>
          </Table>
        </Card>
      ) : (
        <Card>
          <Rows cards={
            shifts.length === 0 ? <Empty title="No shifts match" /> : shifts.map((s) => (
              <CardRow key={s.id} href={`/shifts/${s.id}`} title={`${s.guard.firstName} ${s.guard.lastName}`} subtitle={`${s.location.name}`} right={<ShiftStatusLabel status={s.status} />}
                meta={[{ label: "Date", value: fmtDate(s.startAt) }, { label: "Hours", value: `${fmtTime(s.startAt)}–${fmtTime(s.endAt)} · ${fmtDuration(s.durationMinutes)}` }, { label: "Arrival", value: s.attendance?.arrivalConfirmedAt ? fmtTime(s.attendance.arrivalConfirmedAt) : "—" }, { label: "Supervisor", value: s.supervisor?.name ?? "—" }]} />
            ))
          } table={
          <Table>
            <THead><tr><th>Date</th><th>Guard</th><th>Location</th><th>Hours</th><th>Duration</th><th>Supervisor</th><th>Arrival</th><th>Status</th></tr></THead>
            <TBody>
              {shifts.length === 0 && <Empty colSpan={8} title="No shifts match" body="Try another view or clear the filters." />}
              {shifts.map((s) => (
                <tr key={s.id}>
                  <td className="tnum"><Link href={`/shifts/${s.id}`} className="font-medium text-ink hover:underline">{fmtDate(s.startAt)}</Link></td>
                  <td>{s.guard.firstName} {s.guard.lastName}</td>
                  <td><div>{s.location.name}</div><div className="text-[12px] text-ink-3">{s.location.client.name}</div></td>
                  <td className="tnum">{fmtTime(s.startAt)}–{fmtTime(s.endAt)}</td>
                  <td className="tnum">{fmtDuration(s.durationMinutes)}</td>
                  <td className="text-ink-2">{s.supervisor?.name ?? "—"}</td>
                  <td className="tnum">{s.attendance?.arrivalConfirmedAt ? fmtTime(s.attendance.arrivalConfirmedAt) : <span className="text-ink-3">—</span>}</td>
                  <td><ShiftStatusLabel status={s.status} /></td>
                </tr>
              ))}
            </TBody>
          </Table>
          } />
        </Card>
      )}
    </div>
  );
}
