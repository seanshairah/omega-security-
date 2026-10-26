import Link from "next/link";
import { startOfDay, subDays, startOfWeek, startOfMonth, endOfDay } from "date-fns";
import { requireUser } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { attendanceRows, ATTENDANCE_LABEL } from "@/lib/services/attendance";
import type { AttendanceStatus } from "@prisma/client";
import { PageHeader, Segments } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Table, THead, TBody, Empty } from "@/components/ui/table";
import { Status } from "@/components/ui/status";
import { Input, Select } from "@/components/ui/form";
import { ShiftStatusLabel } from "@/components/shift-status";
import { fmtDate, fmtTime, dateInputValue } from "@/lib/time";

export const metadata = { title: "Attendance" };

export default async function AttendancePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const range = sp.range ?? "week";
  const now = new Date();
  let from = startOfWeek(now, { weekStartsOn: 1 }), to: Date | undefined = endOfDay(now);
  if (range === "today") from = startOfDay(now);
  if (range === "yesterday") { from = startOfDay(subDays(now, 1)); to = endOfDay(subDays(now, 1)); }
  if (range === "month") from = startOfMonth(now);
  if (range === "custom") { from = sp.from ? new Date(sp.from) : subDays(now, 7); to = sp.to ? endOfDay(new Date(sp.to)) : endOfDay(now); }
  const filter = { from, to, guardId: sp.guardId || undefined, locationId: sp.locationId || undefined, clientId: sp.clientId || undefined, status: (sp.status as AttendanceStatus) || undefined };
  const [rows, guards, locations, clients] = await Promise.all([attendanceRows(filter), db.guard.findMany({ orderBy: { lastName: "asc" } }), db.location.findMany({ orderBy: { name: "asc" } }), db.client.findMany({ orderBy: { name: "asc" } })]);
  const qs = new URLSearchParams(Object.entries({ from: from.toISOString(), to: to?.toISOString() ?? "", guardId: sp.guardId ?? "", locationId: sp.locationId ?? "", clientId: sp.clientId ?? "", status: sp.status ?? "" }).filter(([, v]) => v)).toString();
  const totals = { scheduled: rows.length, arrived: rows.filter((r) => r.attendance?.arrivalConfirmedAt).length, late: rows.filter((r) => (r.attendance?.lateMinutes ?? 0) > 15).length, notReported: rows.filter((r) => r.attendance?.status === "NOT_REPORTED" || r.status === "MISSED").length, missedChecks: rows.reduce((n, r) => n + (r.attendance?.missedChecks ?? 0), 0) };
  const keep = (over: Record<string, string>) => "/attendance?" + new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([, v]) => v) as [string, string][]), ...over }).toString();

  return (
    <div>
      <PageHeader title="Attendance" description="Who was scheduled, who arrived, how late, and whether the shift was completed." actions={<a href={`/api/reports/attendance.csv?${qs}`} className="inline-flex h-9 items-center rounded-[8px] border border-line bg-surface px-3.5 text-sm font-medium hover:bg-surface-2">Export CSV</a>} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segments items={[{ href: keep({ range: "today" }), label: "Today", active: range === "today" }, { href: keep({ range: "yesterday" }), label: "Yesterday", active: range === "yesterday" }, { href: keep({ range: "week" }), label: "This week", active: range === "week" }, { href: keep({ range: "month" }), label: "This month", active: range === "month" }, { href: keep({ range: "custom" }), label: "Custom", active: range === "custom" }]} />
        <form className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="range" value={range} />
          {range === "custom" && <><Input type="date" name="from" defaultValue={sp.from ?? dateInputValue(from)} className="w-full sm:w-40" /><Input type="date" name="to" defaultValue={sp.to ?? dateInputValue(now)} className="w-full sm:w-40" /></>}
          <Select name="clientId" defaultValue={sp.clientId ?? ""} className="w-full sm:w-44"><option value="">All clients</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          <Select name="locationId" defaultValue={sp.locationId ?? ""} className="w-full sm:w-48"><option value="">All locations</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
          <Select name="guardId" defaultValue={sp.guardId ?? ""} className="w-full sm:w-44"><option value="">All guards</option>{guards.map((g) => <option key={g.id} value={g.id}>{g.firstName} {g.lastName}</option>)}</Select>
          <Select name="status" defaultValue={sp.status ?? ""} className="w-full sm:w-40"><option value="">Any status</option>{Object.entries(ATTENDANCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>
          <button className="h-9 rounded-[8px] border border-line bg-surface px-3 text-[13px] font-medium hover:bg-surface-2">Apply</button>
        </form>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[["Scheduled", totals.scheduled], ["Arrived", totals.arrived], ["Late", totals.late], ["Not reported", totals.notReported], ["Missed checks", totals.missedChecks]].map(([l, v]) => (
          <div key={l} className="rounded-[12px] border border-line bg-surface px-4 py-3"><div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">{l}</div><div className="mt-1 text-[20px] font-semibold tnum">{v}</div></div>
        ))}
      </div>
      <Card>
        <Table>
          <THead><tr><th>Date</th><th>Guard</th><th>Location</th><th>Scheduled</th><th>Arrived</th><th>Late</th><th>Completed</th><th>Missed checks</th><th>Attendance</th><th>Shift</th></tr></THead>
          <TBody>
            {rows.length === 0 && <Empty colSpan={10} title="No shifts in this range" />}
            {rows.map((s) => (
              <tr key={s.id}>
                <td className="tnum"><Link href={`/shifts/${s.id}`} className="font-medium text-ink hover:underline">{fmtDate(s.startAt)}</Link></td>
                <td><Link href={`/guards/${s.guardId}`} className="hover:underline">{s.guard.firstName} {s.guard.lastName}</Link></td>
                <td><div>{s.location.name}</div><div className="text-[12px] text-ink-3">{s.location.client.name}</div></td>
                <td className="tnum">{fmtTime(s.startAt)}–{fmtTime(s.endAt)}</td>
                <td className="tnum">{s.attendance?.arrivalConfirmedAt ? fmtTime(s.attendance.arrivalConfirmedAt) : <span className="text-ink-3">—</span>}</td>
                <td className="tnum">{(s.attendance?.lateMinutes ?? 0) > 0 && s.attendance?.arrivalConfirmedAt ? <span className={s.attendance.lateMinutes > 15 ? "text-warn" : "text-ink-2"}>{s.attendance.lateMinutes} min</span> : <span className="text-ink-3">—</span>}</td>
                <td className="tnum">{s.attendance?.completionConfirmedAt ? fmtTime(s.attendance.completionConfirmedAt) : s.completionTimedOutAt ? <span className="text-ink-3">unconfirmed</span> : <span className="text-ink-3">—</span>}</td>
                <td className="tnum">{s.attendance?.missedChecks || <span className="text-ink-3">0</span>}</td>
                <td>{s.attendance ? <Status tone={ATTENDANCE_LABEL[s.attendance.status].tone}>{ATTENDANCE_LABEL[s.attendance.status].label}</Status> : "—"}</td>
                <td><ShiftStatusLabel status={s.status} startAt={s.startAt} /></td>
              </tr>
            ))}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
