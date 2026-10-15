import Link from "next/link";
import { startOfMonth, subDays, endOfDay } from "date-fns";
import { requireUser } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { guardPerformance } from "@/lib/services/guards";
import { PageHeader, Segments } from "@/components/ui/page";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, THead, TBody, Empty } from "@/components/ui/table";
import { Avatar } from "@/components/ui/avatar";
import { Status } from "@/components/ui/status";
import { CATEGORY_LABEL } from "@/lib/services/incidents";

export const metadata = { title: "Reports" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ range?: string; clientId?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const range = sp.range ?? "30d";
  const now = new Date();
  const from = range === "7d" ? subDays(now, 7) : range === "month" ? startOfMonth(now) : range === "90d" ? subDays(now, 90) : subDays(now, 30);
  const to = endOfDay(now);
  const [guards, clients, incidentsByCat, byClient] = await Promise.all([
    db.guard.findMany({ where: { active: true }, orderBy: { lastName: "asc" } }),
    db.client.findMany({ where: { active: true }, include: { locations: { select: { id: true } } }, orderBy: { name: "asc" } }),
    db.incident.groupBy({ by: ["category"], where: { occurredAt: { gte: from, lte: to } }, _count: { _all: true } }),
    db.shift.findMany({ where: { startAt: { gte: from, lte: to }, status: { notIn: ["CANCELLED", "SCHEDULED", "AWAITING_ARRIVAL"] } }, include: { attendance: true, location: { select: { clientId: true } } } }),
  ]);
  const perf = await Promise.all(guards.map(async (g) => ({ g, p: await guardPerformance(g.id, from, to) })));
  const clientRows = clients.map((c) => {
    const rows = byClient.filter((s) => s.location.clientId === c.id);
    const arrived = rows.filter((s) => s.attendance?.arrivalConfirmedAt).length;
    return { c, shifts: rows.length, arrived, late: rows.filter((s) => (s.attendance?.lateMinutes ?? 0) > 15).length, missed: rows.filter((s) => s.status === "MISSED" || s.attendance?.status === "NOT_REPORTED").length, pct: rows.length ? Math.round((arrived / rows.length) * 100) : 100 };
  });
  const qs = `from=${from.toISOString()}&to=${to.toISOString()}`;
  return (
    <div>
      <PageHeader title="Reports" description="Attendance and performance by guard and by client. Export any range as CSV." actions={<><Link href="/reports/location" className="inline-flex h-9 items-center rounded-[8px] border border-line bg-surface px-3.5 text-sm font-medium hover:bg-surface-2">Location report</Link><Link href="/reports/calls" className="inline-flex h-9 items-center rounded-[8px] border border-line bg-surface px-3.5 text-sm font-medium hover:bg-surface-2">Call report</Link><a href={`/api/reports/attendance.csv?${qs}`} className="inline-flex h-9 items-center rounded-[8px] border border-line bg-surface px-3.5 text-sm font-medium hover:bg-surface-2">Export attendance CSV</a></>} />
      <Segments className="mb-4" items={[{ href: "/reports?range=7d", label: "Last 7 days", active: range === "7d" }, { href: "/reports?range=30d", label: "Last 30 days", active: range === "30d" }, { href: "/reports?range=month", label: "This month", active: range === "month" }, { href: "/reports?range=90d", label: "Last 90 days", active: range === "90d" }]} />
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader title="Guard performance" description="Attendance is arrivals confirmed over shifts that have started." />
          <Table>
            <THead><tr><th>Guard</th><th>Shifts</th><th>Attendance</th><th>Completed</th><th>Late</th><th>Missed shifts</th><th>Missed checks</th><th>Incidents</th><th>Assistance</th></tr></THead>
            <TBody>
              {perf.length === 0 && <Empty colSpan={9} title="No active guards" />}
              {perf.sort((a, b) => b.p.attendancePct - a.p.attendancePct || b.p.completed - a.p.completed).map(({ g, p }) => (
                <tr key={g.id}>
                  <td><Link href={`/guards/${g.id}`} className="flex items-center gap-2.5 font-medium text-ink hover:underline"><Avatar src={g.photoUrl} name={g.firstName} size={28} />{g.firstName} {g.lastName}</Link></td>
                  <td className="tnum">{p.scheduled}</td>
                  <td><Status tone={p.attendancePct >= 90 ? "ok" : p.attendancePct >= 75 ? "warn" : "critical"}>{p.attendancePct}%</Status></td>
                  <td className="tnum">{p.completed}</td><td className="tnum">{p.late}</td><td className="tnum">{p.missed}</td><td className="tnum">{p.missedChecks}</td><td className="tnum">{p.incidents}</td><td className="tnum">{p.assistance}</td>
                </tr>
              ))}
            </TBody>
          </Table>
        </Card>
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader title="By client" />
            <Table>
              <THead><tr><th>Client</th><th>Shifts</th><th>Attendance</th><th>Late</th><th>Missed</th></tr></THead>
              <TBody>
                {clientRows.map(({ c, shifts, pct, late, missed }) => <tr key={c.id}><td className="font-medium text-ink"><Link href={`/attendance?range=custom&clientId=${c.id}`} className="hover:underline">{c.name}</Link></td><td className="tnum">{shifts}</td><td><Status tone={pct >= 90 ? "ok" : pct >= 75 ? "warn" : "critical"}>{pct}%</Status></td><td className="tnum">{late}</td><td className="tnum">{missed}</td></tr>)}
              </TBody>
            </Table>
          </Card>
          <Card>
            <CardHeader title="Incidents by category" />
            <Table>
              <THead><tr><th>Category</th><th>Count</th></tr></THead>
              <TBody>
                {incidentsByCat.length === 0 && <Empty colSpan={2} title="No incidents in range" />}
                {incidentsByCat.sort((a, b) => b._count._all - a._count._all).map((r) => <tr key={r.category}><td>{CATEGORY_LABEL[r.category]}</td><td className="tnum">{r._count._all}</td></tr>)}
              </TBody>
            </Table>
          </Card>
        </div>
      </div>
    </div>
  );
}
