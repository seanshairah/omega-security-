import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, can } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { PageHeader, Meta } from "@/components/ui/page";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Status } from "@/components/ui/status";
import { ButtonGroup, LinkButton } from "@/components/ui/button";
import { ClientNotificationList } from "@/components/clients/notify-client";
import { notificationHistory } from "@/lib/client-notifications/service";

export const metadata = { title: "Client" };

/** A client: its sites, and every message sent to it, with drafts waiting for approval first. */
export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { status } = await searchParams;
  const c = await db.client.findUnique({ where: { id }, include: { locations: { orderBy: { name: "asc" }, select: { id: true, name: true, active: true, clientUpdates: true } } } });
  if (!c) notFound();
  const [pending, history] = await Promise.all([
    notificationHistory({ clientId: id, status: "PENDING_APPROVAL" }, 50),
    notificationHistory({ clientId: id, ...(status === "FAILED" ? { status: "FAILED" as const } : {}) }, 100),
  ]);
  const rest = history.filter((n) => n.status !== "PENDING_APPROVAL");
  return (
    <div>
      <PageHeader title={c.name} description={`${c.code}${c.industry ? ` · ${c.industry}` : ""}`} actions={can.manageLocations(user) && (
        <ButtonGroup><LinkButton href={`/clients/${c.id}/edit`}>Edit</LinkButton></ButtonGroup>
      )} />
      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-4">
          {pending.length > 0 && (
            <Card className="border-warn/50">
              <CardHeader title="Awaiting approval" description="Drafted by a rule or a supervisor. Nothing has been sent." />
              <ClientNotificationList items={pending} role={user.role} />
            </Card>
          )}
          <Card>
            <CardHeader
              title="Messages to the client"
              description="Every update sent about this client's sites, newest first. Sent means the provider accepted it; delivered means the provider reported delivery."
              action={<span className="flex gap-3 text-[13px] font-medium">
                <Link href={`/clients/${c.id}`} className={status === "FAILED" ? "text-accent hover:underline" : "text-ink"}>All</Link>
                <Link href={`/clients/${c.id}?status=FAILED`} className={status === "FAILED" ? "text-ink" : "text-accent hover:underline"}>Failed</Link>
              </span>}
            />
            <ClientNotificationList items={rest} role={user.role} empty={status === "FAILED" ? "No failed messages." : "No messages to this client yet."} />
          </Card>
        </div>
        <div className="min-w-0 space-y-4">
          <Card><CardBody className="pt-5">
            <div className="grid grid-cols-2 gap-4">
              <Meta label="Contact" className="col-span-2">{c.contactName ?? "—"}</Meta>
              <Meta label="Phone">{c.contactPhone ?? "—"}</Meta>
              <Meta label="Email">{c.contactEmail ?? "—"}</Meta>
              <Meta label="Status" className="col-span-2">{c.active ? <Status tone="ok">Active</Status> : <Status tone="muted">Inactive</Status>}</Meta>
            </div>
          </CardBody></Card>
          <Card>
            <CardHeader title="Sites" description="Message rules are set on each site." />
            <CardBody className="pt-3">
              {c.locations.length === 0 ? <p className="text-[13px] text-ink-3">No sites yet.</p> : (
                <ul className="divide-y divide-line">
                  {c.locations.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-3 py-2.5">
                      <Link href={`/locations/${l.id}`} className="min-w-0 truncate text-[13px] font-medium text-ink hover:underline">{l.name}</Link>
                      <span className="flex shrink-0 gap-2">{!l.active && <Status tone="muted">Inactive</Status>}<Status tone={l.clientUpdates ? "ok" : "muted"}>{l.clientUpdates ? "Updates on" : "Updates off"}</Status></span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
