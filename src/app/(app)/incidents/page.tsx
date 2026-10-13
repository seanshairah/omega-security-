import Link from "next/link";
import { requireUser } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { CATEGORY_LABEL, sevTone, statusTone } from "@/lib/services/incidents";
import { PageHeader, Segments } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Table, THead, TBody, Empty } from "@/components/ui/table";
import { Status } from "@/components/ui/status";
import { LinkButton } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { fmtShort } from "@/lib/time";
import { Rows, CardRow } from "@/components/ui/rows";

export const metadata = { title: "Incidents" };

export default async function IncidentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const f = sp.f ?? "open";
  const where: Prisma.IncidentWhereInput = {};
  if (f === "open") where.status = { in: ["OPEN", "ACKNOWLEDGED"] };
  if (f === "resolved") where.status = { in: ["RESOLVED", "CLOSED"] };
  if (f === "critical") where.severity = "CRITICAL";
  if (sp.category) where.category = sp.category as never;
  if (sp.locationId) where.locationId = sp.locationId;
  const [rows, locations, counts] = await Promise.all([
    db.incident.findMany({ where, include: { guard: true, location: { include: { client: true } }, supervisor: true }, orderBy: { occurredAt: "desc" }, take: 200 }),
    db.location.findMany({ orderBy: { name: "asc" } }),
    Promise.all([db.incident.count({ where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } } }), db.incident.count({ where: { severity: "CRITICAL" } }), db.incident.count()]),
  ]);
  return (
    <div>
      <PageHeader title="Incidents" description="Everything guards reported by SMS, plus incidents logged by supervisors." actions={<LinkButton href="/incidents/new" variant="primary">Log incident</LinkButton>} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segments items={[{ href: "/incidents", label: "Open", count: counts[0], active: f === "open", tone: "critical" }, { href: "/incidents?f=resolved", label: "Resolved", active: f === "resolved", tone: "ok" }, { href: "/incidents?f=critical", label: "Critical", count: counts[1], active: f === "critical" }, { href: "/incidents?f=all", label: "All", count: counts[2], active: f === "all" }]} />
        <form className="flex items-center gap-2">
          <input type="hidden" name="f" value={f} />
          <Select name="category" defaultValue={sp.category ?? ""} className="w-48"><option value="">Any category</option>{Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          <Select name="locationId" defaultValue={sp.locationId ?? ""} className="w-52"><option value="">All locations</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
          <button className="h-9 rounded-[8px] border border-line bg-surface px-3 text-[13px] font-medium hover:bg-surface-2">Filter</button>
        </form>
      </div>
      <Card>
        <Rows cards={
          rows.length === 0 ? <Empty title="No incidents" /> : rows.map((i) => (
            <CardRow key={i.id} href={`/incidents/${i.id}`} tone={i.category === "EMERGENCY" && (i.status === "OPEN" || i.status === "ACKNOWLEDGED") ? "critical" : undefined}
              title={`${i.incidentNo} · ${CATEGORY_LABEL[i.category]}`} subtitle={i.description} right={<Status tone={statusTone(i.status)}>{i.status.toLowerCase()}</Status>}
              meta={[{ label: "When", value: fmtShort(i.occurredAt) }, { label: "Severity", value: <Status tone={sevTone(i.severity)}>{i.severity.toLowerCase()}</Status> }, { label: "Guard", value: `${i.guard.firstName} ${i.guard.lastName}` }, { label: "Location", value: i.location.name }]} />
          ))
        } table={
        <Table>
          <THead><tr><th>Incident</th><th>When</th><th>Guard</th><th>Location</th><th>Category</th><th>Severity</th><th>Supervisor</th><th>Status</th></tr></THead>
          <TBody>
            {rows.length === 0 && <Empty colSpan={8} title="No incidents" body={f === "open" ? "Nothing is open. Resolved incidents are under the Resolved tab." : undefined} />}
            {rows.map((i) => (
              <tr key={i.id} className={i.category === "EMERGENCY" && (i.status === "OPEN" || i.status === "ACKNOWLEDGED") ? "bg-critical-soft/40" : ""}>
                <td><Link href={`/incidents/${i.id}`} className="font-medium text-ink hover:underline">{i.incidentNo}</Link><p className="max-w-sm truncate text-[12px] text-ink-3">{i.description}</p></td>
                <td className="tnum">{fmtShort(i.occurredAt)}</td>
                <td><Link href={`/guards/${i.guardId}`} className="hover:underline">{i.guard.firstName} {i.guard.lastName}</Link></td>
                <td><div>{i.location.name}</div><div className="text-[12px] text-ink-3">{i.location.client.name}</div></td>
                <td>{CATEGORY_LABEL[i.category]}</td>
                <td><Status tone={sevTone(i.severity)}>{i.severity.toLowerCase()}</Status></td>
                <td className="text-ink-2">{i.supervisor?.name ?? "—"}</td>
                <td><Status tone={statusTone(i.status)}>{i.status.toLowerCase()}</Status></td>
              </tr>
            ))}
          </TBody>
        </Table>
        } />
      </Card>
    </div>
  );
}
