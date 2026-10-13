import Link from "next/link";
import { requireUser, can } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { ON_SITE_STATUSES } from "@/lib/services/shifts";
import { PageHeader, Segments } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Table, THead, TBody, Empty } from "@/components/ui/table";
import { Status } from "@/components/ui/status";
import { LinkButton } from "@/components/ui/button";

export const metadata = { title: "Locations" };
const PATTERN: Record<string, string> = { DAY_8: "Day · 8 h", NIGHT_8: "Night · 8 h", DAY_12: "Day · 12 h", NIGHT_12: "Night · 12 h", CUSTOM: "Custom" };

export default async function LocationsPage({ searchParams }: { searchParams: Promise<{ clientId?: string; f?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const [locations, clients] = await Promise.all([
    db.location.findMany({ where: { ...(sp.clientId ? { clientId: sp.clientId } : {}), ...(sp.f === "all" ? {} : { active: true }) }, include: { client: true, supervisor: true, shifts: { where: { status: { in: ON_SITE_STATUSES } }, include: { guard: true } } }, orderBy: [{ client: { name: "asc" } }, { name: "asc" }] }),
    db.client.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <div>
      <PageHeader title="Locations" description="Every site under contract, with who is on post right now." actions={can.manageLocations(user) && <LinkButton href="/locations/new" variant="primary">Add location</LinkButton>} />
      <Segments className="mb-4" items={[{ href: "/locations", label: "All clients", active: !sp.clientId }, ...clients.map((c) => ({ href: `/locations?clientId=${c.id}`, label: c.name, active: sp.clientId === c.id }))]} />
      <Card>
        <Table>
          <THead><tr><th>Site</th><th>Client</th><th>Pattern</th><th>Cover</th><th>On post now</th><th>Supervisor</th><th>Status</th></tr></THead>
          <TBody>
            {locations.length === 0 && <Empty colSpan={7} title="No locations" action={<LinkButton href="/locations/new" variant="primary" size="sm">Add location</LinkButton>} />}
            {locations.map((l) => {
              const cover = l.shifts.length >= l.requiredGuards ? "ok" : l.shifts.length > 0 ? "warn" : "neutral";
              return (
                <tr key={l.id}>
                  <td><Link href={`/locations/${l.id}`} className="font-medium text-ink hover:underline">{l.name}</Link><div className="text-[12px] text-ink-3">{l.code} · {l.siteType ?? "Site"}</div></td>
                  <td className="text-ink-2">{l.client.name}</td>
                  <td className="text-ink-2">{PATTERN[l.shiftPattern]}</td>
                  <td><Status tone={cover}>{l.shifts.length} of {l.requiredGuards}</Status></td>
                  <td className="text-ink-2">{l.shifts.length ? l.shifts.map((s) => `${s.guard.firstName} ${s.guard.lastName}`).join(", ") : "—"}</td>
                  <td className="text-ink-2">{l.supervisor?.name ?? "—"}</td>
                  <td>{l.active ? <Status tone="ok">Active</Status> : <Status tone="muted">Inactive</Status>}</td>
                </tr>
              );
            })}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
