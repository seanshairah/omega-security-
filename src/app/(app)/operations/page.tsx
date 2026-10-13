import Link from "next/link";
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr";
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
import { fmtTime, ago } from "@/lib/time";
import { cn } from "@/lib/cn";

export const metadata = { title: "Active operations" };

export default async function OperationsPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  await requireUser();
  const { f = "all" } = await searchParams;
  const all = await db.shift.findMany({ where: { OR: [{ status: { in: LIVE_STATUSES } }, { status: "SCHEDULED", startAt: { lte: new Date(Date.now() + 3 * 3600_000) } }] }, include: { ...shiftInclude, welfareChecks: { orderBy: { sentAt: "desc" }, take: 1 } }, orderBy: [{ startAt: "asc" }] });
  const groups = {
    all: all,
    attention: all.filter((s) => ["LATE", "NOT_CONFIRMED", "ASSISTANCE", "INCIDENT", "CRITICAL"].includes(s.status)),
    onduty: all.filter((s) => s.status === "ON_DUTY"),
    upcoming: all.filter((s) => s.status === "SCHEDULED" || s.status === "AWAITING_ARRIVAL"),
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
      <PageHeader title="Active operations" description="Every live shift, refreshed as guards reply. Click a row for the full timeline." actions={<LinkButton href="/shifts/new" variant="primary">New shift</LinkButton>} />
      <Segments className="mb-4" items={[
        { href: "/operations", label: "All", count: groups.all.length, active: f === "all" },
        { href: "/operations?f=attention", label: "Needs attention", count: groups.attention.length, active: f === "attention", tone: "critical" },
        { href: "/operations?f=onduty", label: "On duty", count: groups.onduty.length, active: f === "onduty", tone: "ok" },
        { href: "/operations?f=upcoming", label: "Starting soon", count: groups.upcoming.length, active: f === "upcoming", tone: "neutral" },
      ]} />
      <Card>
        <Table>
          <THead><tr><th>Guard</th><th>Location</th><th>Shift</th><th>Arrival</th><th>Mid-shift</th><th>Status</th><th>Last update</th><th></th></tr></THead>
          <TBody>
            {rows.length === 0 && <Empty colSpan={8} title="No shifts here" body="Shifts appear as they start. Create one or wait for the next scheduled start." />}
            {rows.map((s) => (
              <tr key={s.id} className={cn(s.status === "CRITICAL" && "bg-critical-soft/40")}>
                <td>
                  <Link href={`/guards/${s.guardId}`} className="flex items-center gap-3">
                    <Avatar src={s.guard.photoUrl} name={`${s.guard.firstName} ${s.guard.lastName}`} size={32} />
                    <div><div className="font-medium text-ink">{s.guard.firstName} {s.guard.lastName}</div><div className="text-[12px] text-ink-3">{s.guard.guardNo}</div></div>
                  </Link>
                </td>
                <td><div className="text-ink">{s.location.name}</div><div className="text-[12px] text-ink-3">{s.location.client.name}</div></td>
                <td className="tnum text-ink">{fmtTime(s.startAt)}–{fmtTime(s.endAt)}</td>
                <td className="tnum">{s.attendance?.arrivalConfirmedAt ? <Status tone={(s.attendance.lateMinutes ?? 0) > 15 ? "warn" : "ok"}>{fmtTime(s.attendance.arrivalConfirmedAt)}{(s.attendance.lateMinutes ?? 0) > 15 ? ` · ${s.attendance.lateMinutes} min late` : ""}</Status> : s.status === "SCHEDULED" ? <span className="text-ink-3">—</span> : <Status tone={s.status === "AWAITING_ARRIVAL" ? "neutral" : "critical"}>Not confirmed</Status>}</td>
                <td>{welfare(s)}</td>
                <td><ShiftStatusLabel status={s.status} /></td>
                <td className="text-ink-3">{ago(s.updatedAt)}</td>
                <td className="text-right"><Link href={`/shifts/${s.id}`} className="inline-flex items-center gap-1 text-[13px] font-medium text-ink-2 hover:text-ink">Timeline <CaretRightIcon size={12} weight="bold" /></Link></td>
              </tr>
            ))}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
