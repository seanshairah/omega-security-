import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, can } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { CATEGORY_LABEL, sevTone, statusTone } from "@/lib/services/incidents";
import { PageHeader, Meta } from "@/components/ui/page";
import { CallGuardButton } from "@/components/calls/call-guard";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Status } from "@/components/ui/status";
import { Avatar } from "@/components/ui/avatar";
import { ButtonGroup, Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { ActionForm } from "@/components/ui/action-form";
import { Field, Textarea } from "@/components/ui/form";
import { Timeline } from "@/components/timeline";
import { acknowledgeIncident, resolveIncident, closeIncident } from "@/actions/incidents";
import { fmtDateTime, fmtTime, fmtDate } from "@/lib/time";
import { NotifyClientButton, ClientNotificationList } from "@/components/clients/notify-client";
import { notificationHistory } from "@/lib/client-notifications/service";
import { formatPhone } from "@/lib/phone";

export const metadata = { title: "Incident" };

export default async function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const i = await db.incident.findUnique({ where: { id }, include: { guard: true, location: { include: { client: true } }, supervisor: true, shift: { include: { checkIns: { include: { smsMessage: { select: { body: true, direction: true } } }, orderBy: [{ at: "asc" }, { id: "asc" }] } } } } });
  if (!i) notFound();
  const open = i.status === "OPEN" || i.status === "ACKNOWLEDGED";
  const urgent = i.category === "EMERGENCY" || i.severity === "CRITICAL";
  const clientMessages = await notificationHistory({ incidentId: i.id }, 20);
  return (
    <div>
      <PageHeader title={`${i.incidentNo} · ${CATEGORY_LABEL[i.category]}`} description={`${i.location.name} · ${fmtDateTime(i.occurredAt)} · reported ${i.source === "SMS" ? "by SMS" : i.source === "EMERGENCY" ? "by EMERGENCY SMS" : "by an administrator"}`} actions={can.manageIncidents(user) && (
        <ButtonGroup>
          {i.guard && i.guard.active && <CallGuardButton guardId={i.guard.id} guardName={`${i.guard.firstName} ${i.guard.lastName}`} shiftId={i.shiftId} incidentId={i.id} />}
          {i.status === "OPEN" && <form action={async () => { "use server"; await acknowledgeIncident(i.id); }}><Button type="submit">Acknowledge</Button></form>}
          {i.status === "RESOLVED" && can.manageGuards(user) && <ConfirmButton size="md" label="Close" title="Close this incident?" body="Closed incidents are final. They stay in reports." confirmLabel="Close" action={async () => { "use server"; await closeIncident(i.id); }} />}
          {i.shiftId && <Link href={`/shifts/${i.shiftId}`} className="inline-flex h-9 items-center px-3.5 text-sm font-medium hover:bg-surface-2">Open shift</Link>}
        </ButtonGroup>
      )} />
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-4">
          <Card className={i.category === "EMERGENCY" && open ? "border-critical" : ""}>
            <CardHeader title="Description" action={<span className="flex items-center gap-3"><Status tone={sevTone(i.severity)}>{i.severity.toLowerCase()}</Status><Status tone={statusTone(i.status)} pulse={i.category === "EMERGENCY" && i.status === "OPEN"}>{i.status.toLowerCase()}</Status></span>} />
            <CardBody><p className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink">{i.description}</p></CardBody>
          </Card>
          {open && can.manageIncidents(user) && (
            <Card>
              <CardHeader title="Resolve" description="Record what was done. The resolution time is stamped when you save." />
              <CardBody>
                <ActionForm action={resolveIncident.bind(null, i.id)} submitLabel="Mark resolved" successMessage="Incident resolved.">
                  <Field label="Resolution notes" required><Textarea name="resolutionNotes" required placeholder="Who attended, what was found, what happens next" /></Field>
                </ActionForm>
              </CardBody>
            </Card>
          )}
          <Card className={urgent && !i.clientNotifiedAt ? "border-critical/40" : ""}>
            <CardHeader
              title="Messages to the client"
              description={i.clientNotifiedAt ? `Client notified ${fmtDateTime(i.clientNotifiedAt)}.` : urgent ? `${i.location.client.name} has not been told about this ${i.category === "EMERGENCY" ? "emergency" : "incident"}. Only the super admin can send it; anyone else saves a draft for approval.` : `Nothing sent to ${i.location.client.name} about this incident.`}
              action={<NotifyClientButton incidentId={i.id} size="sm" variant={urgent && !i.clientNotifiedAt ? "primary" : "secondary"} />}
            />
            <ClientNotificationList items={clientMessages} role={user.role} showSite={false} empty="No messages about this incident yet." />
          </Card>
          {!open && (
            <Card>
              <CardHeader title="Resolution" description={`Resolved ${fmtDateTime(i.resolvedAt)} by ${i.supervisor?.name ?? "—"}`} />
              <CardBody><p className="whitespace-pre-wrap text-[14px] text-ink">{i.resolutionNotes ?? "No notes recorded."}</p></CardBody>
            </Card>
          )}
          {i.shift && (
            <Card>
              <CardHeader title="Shift timeline" description={`${fmtDate(i.shift.startAt)} · ${fmtTime(i.shift.startAt)}–${fmtTime(i.shift.endAt)}`} />
              <CardBody><Timeline events={i.shift.checkIns} /></CardBody>
            </Card>
          )}
        </div>
        <div className="min-w-0 space-y-4">
          <Card><CardBody className="pt-5">
            <div className="flex items-center gap-3"><Avatar src={i.guard.photoUrl} name={i.guard.firstName} size={44} /><div><Link href={`/guards/${i.guardId}`} className="font-semibold text-ink hover:underline">{i.guard.firstName} {i.guard.lastName}</Link><p className="text-[13px] text-ink-2">{i.guard.guardNo} · <a href={`tel:${i.guard.phone}`} className="underline">{formatPhone(i.guard.phone)}</a></p></div></div>
            <div className="mt-5 grid grid-cols-2 gap-4">
              <Meta label="Location"><Link href={`/locations/${i.locationId}`} className="hover:underline">{i.location.name}</Link></Meta>
              <Meta label="Client">{i.location.client.name}</Meta>
              <Meta label="Occurred">{fmtDateTime(i.occurredAt)}</Meta>
              <Meta label="Logged">{fmtDateTime(i.createdAt)}</Meta>
              <Meta label="Supervisor">{i.supervisor?.name ?? "Unassigned"}</Meta>
              <Meta label="Acknowledged">{i.acknowledgedAt ? fmtDateTime(i.acknowledgedAt) : "Not yet"}</Meta>
              <Meta label="Resolved">{i.resolvedAt ? fmtDateTime(i.resolvedAt) : "—"}</Meta>
              <Meta label="Client notified">{i.clientNotifiedAt ? fmtDateTime(i.clientNotifiedAt) : "No"}</Meta>
              <Meta label="Site contact">{i.location.contactName ?? "—"}{i.location.contactPhone ? ` · ${i.location.contactPhone}` : ""}</Meta>
            </div>
          </CardBody></Card>
        </div>
      </div>
    </div>
  );
}
