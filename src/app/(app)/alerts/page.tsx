import Link from "next/link";
import { requireUser, can } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { ALERT_META, alertInclude } from "@/lib/gateway/alerts";
import { acknowledgeAlert, resolveAlert } from "@/actions/alerts";
import { PageHeader } from "@/components/ui/page";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Table, THead, TBody, Empty } from "@/components/ui/table";
import { Avatar } from "@/components/ui/avatar";
import { Status } from "@/components/ui/status";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { AutoRefresh } from "@/components/auto-refresh";
import { fmtDateTime, ago } from "@/lib/time";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/cn";
import { subDays } from "date-fns";

export const metadata = { title: "Guard alerts" };

const STATUS_TONE = { OPEN: "critical", ACKNOWLEDGED: "warn", RESOLVED: "ok" } as const;

/**
 * Alerts and status messages sent from guard phones: emergencies, assistance, incidents, security
 * alerts, running late, status updates, shift-going-well, handovers. Open ones first. Acknowledging
 * tells the guard (on the phone) who saw it and when; resolving closes it.
 */
export default async function AlertsPage({ searchParams }: { searchParams: Promise<{ view?: string; focus?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const view = sp.view === "all" ? "all" : "open";
  const [open, recent] = await Promise.all([
    db.guardAlert.findMany({ where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } }, include: alertInclude, orderBy: [{ status: "asc" }, { occurredAt: "desc" }] }),
    view === "all" ? db.guardAlert.findMany({ where: { status: "RESOLVED", occurredAt: { gte: subDays(new Date(), 7) } }, include: alertInclude, orderBy: { occurredAt: "desc" }, take: 200 }) : Promise.resolve([]),
  ]);
  const rows = view === "all" ? [...open, ...recent] : open;
  const manage = can.manageShifts(user) || user.role === "SUPERVISOR";
  return (
    <div>
      <AutoRefresh seconds={20} />
      <PageHeader title="Guard alerts" description="Sent from the guard app. An alert raised offline arrives on reconnection, marked synced late; the time shown is when the guard pressed the button." actions={
        <div className="inline-flex rounded-[var(--radius-control)] border border-line bg-surface p-0.5">
          {([["open", "Open"], ["all", "Last 7 days"]] as const).map(([k, l]) => <Link key={k} href={`/alerts?view=${k}`} className={cn("h-8 rounded-[6px] px-3 text-[13px] font-medium leading-8", view === k ? "bg-surface-2 text-ink" : "text-ink-2 hover:text-ink")}>{l}</Link>)}
        </div>
      } />
      <Card>
        <CardHeader title={view === "open" ? `${open.length} open` : `${rows.length} alert${rows.length === 1 ? "" : "s"}`} description="Emergencies and incidents also open an incident record; status messages are informational and need no acknowledgement." />
        <Table>
          <THead><tr><th>When</th><th>Guard</th><th>Alert</th><th>Where</th><th>Status</th><th className="text-right">Actions</th></tr></THead>
          <TBody>
            {rows.length === 0 && <Empty colSpan={6} title={view === "open" ? "No open alerts" : "No alerts in the last 7 days"} />}
            {rows.map((a) => {
              const m = ALERT_META[a.type];
              const focus = sp.focus === a.id;
              return (
                <tr key={a.id} className={cn(focus && "bg-surface-2")}>
                  <td className="tnum whitespace-nowrap">{fmtDateTime(a.occurredAt)}<span className="block text-[11px] text-ink-3">{a.syncStatus === "SYNCED_LATE" ? "synced late" : ago(a.receivedAt)}{a.simulated ? " · simulated" : ""}</span></td>
                  <td><Link href={`/guards/${a.guard.id}?tab=communication`} className="flex items-center gap-2 hover:underline"><Avatar src={a.guard.photoUrl} name={a.guard.firstName} size={24} />{a.guard.firstName} {a.guard.lastName}</Link><span className="block pl-8 text-[11px] text-ink-3">{formatPhone(a.guard.phone)}</span></td>
                  <td><Status tone={m.tone === "info" || m.tone === "neutral" ? "neutral" : m.tone}>{m.label}</Status>{a.message && <span className="block max-w-[360px] text-[12.5px] text-ink-2">“{a.message}”</span>}{a.incident && <Link href={`/incidents/${a.incident.id}`} className="block text-[11px] text-ink-3 underline">{a.incident.incidentNo}</Link>}</td>
                  <td className="text-[12.5px]">{a.location ? <Link href={`/locations/${a.location.id}`} className="hover:underline">{a.location.name}</Link> : <span className="text-ink-3">no site</span>}<span className="block text-[11px] text-ink-3">{a.latitude != null ? `${a.locationState === "INSIDE" ? "inside" : a.locationState === "OUTSIDE" ? "outside" : "unverified"}${a.accuracyM != null ? ` · ±${Math.round(a.accuracyM)} m` : ""}${a.locationAgeSeconds != null && a.locationAgeSeconds > 120 ? ` · fix ${Math.round(a.locationAgeSeconds / 60)} min old` : ""}` : "no position"}{a.shift && <> · <Link href={`/shifts/${a.shift.id}`} className="underline">shift</Link></>}</span></td>
                  <td><Status tone={STATUS_TONE[a.status]}>{a.status === "OPEN" ? "Open" : a.status === "ACKNOWLEDGED" ? "Acknowledged" : "Resolved"}</Status><span className="block text-[11px] text-ink-3">{a.acknowledgedAt ? `ack ${a.acknowledgedBy?.name ?? "—"} ${ago(a.acknowledgedAt)}` : m.requiresAck ? "awaiting acknowledgement" : "informational"}{a.acknowledgementNote ? ` · ${a.acknowledgementNote}` : ""}{a.resolvedAt && a.resolvedBy ? ` · resolved by ${a.resolvedBy.name}` : ""}</span></td>
                  <td className="text-right">
                    {manage && a.status === "OPEN" && <ConfirmButton label="Acknowledge" variant="primary" title={`Acknowledge ${m.label.toLowerCase()} from ${a.guard.firstName}?`} body="The guard's phone will show your name and the time. Call the guard first if this is an emergency." withNote="Note to the guard (optional)" confirmLabel="Acknowledge" action={async (note) => { "use server"; await acknowledgeAlert(a.id, note); }} />}
                    {manage && a.status !== "RESOLVED" && <ConfirmButton label="Resolve" className="ml-1" title={`Resolve this ${m.label.toLowerCase()}?`} body="Use when the situation is handled. Incidents are closed separately." withNote="What was done" confirmLabel="Resolve" action={async (note) => { "use server"; await resolveAlert(a.id, note); }} />}
                  </td>
                </tr>
              );
            })}
          </TBody>
        </Table>
        {view === "open" && <CardBody className="border-t border-line pt-3 text-[12.5px] text-ink-3">Resolved alerts are kept; see <Link href="/alerts?view=all" className="underline">last 7 days</Link>, the guard&apos;s Communication tab, or the shift timeline.</CardBody>}
      </Card>
    </div>
  );
}
