import Link from "next/link";
import { requireUser, can } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { ON_SITE_STATUSES } from "@/lib/services/shifts";
import { PageHeader } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Table, THead, TBody, Empty } from "@/components/ui/table";
import { Status } from "@/components/ui/status";
import { LinkButton } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { setClientActive } from "@/actions/locations";

export const metadata = { title: "Clients" };

export default async function ClientsPage() {
  const user = await requireUser();
  const clients = await db.client.findMany({ include: { locations: { include: { _count: { select: { shifts: { where: { status: { in: ON_SITE_STATUSES } } } } } } } }, orderBy: { name: "asc" } });
  return (
    <div>
      <PageHeader title="Clients" description="Each client owns one or more sites. Deployments and reports can be viewed per client." actions={can.manageLocations(user) && <LinkButton href="/clients/new" variant="primary">Add client</LinkButton>} />
      <Card>
        <Table>
          <THead><tr><th>Client</th><th>Industry</th><th>Contact</th><th>Sites</th><th>Guards on duty</th><th>Status</th><th></th></tr></THead>
          <TBody>
            {clients.length === 0 && <Empty colSpan={7} title="No clients yet" action={<LinkButton href="/clients/new" variant="primary" size="sm">Add client</LinkButton>} />}
            {clients.map((c) => {
              const onDuty = c.locations.reduce((n, l) => n + l._count.shifts, 0);
              return (
                <tr key={c.id}>
                  <td><Link href={`/clients/${c.id}`} className="font-medium text-ink hover:underline">{c.name}</Link><div className="text-[12px] text-ink-3">{c.code}</div></td>
                  <td className="text-ink-2">{c.industry ?? "—"}</td>
                  <td className="text-ink-2">{c.contactName ?? "—"}{c.contactPhone ? <span className="block text-[12px] text-ink-3 tnum">{c.contactPhone}</span> : null}</td>
                  <td><Link href={`/locations?clientId=${c.id}`} className="hover:underline">{c.locations.filter((l) => l.active).length} site{c.locations.length === 1 ? "" : "s"}</Link></td>
                  <td className="tnum">{onDuty}</td>
                  <td>{c.active ? <Status tone="ok">Active</Status> : <Status tone="muted">Inactive</Status>}</td>
                  <td className="text-right">{can.manageLocations(user) && (
                    <span className="inline-flex gap-1">
                      <LinkButton href={`/clients/${c.id}/edit`} size="sm">Edit</LinkButton>
                      {c.active ? <ConfirmButton label="Deactivate" title={`Deactivate ${c.name}?`} body="The client and its history stay on record. Its sites remain but are flagged." confirmLabel="Deactivate" variant="danger" action={async () => { "use server"; await setClientActive(c.id, false); }} /> : <ConfirmButton label="Reactivate" title={`Reactivate ${c.name}?`} body="" confirmLabel="Reactivate" action={async () => { "use server"; await setClientActive(c.id, true); }} />}
                    </span>
                  )}</td>
                </tr>
              );
            })}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
