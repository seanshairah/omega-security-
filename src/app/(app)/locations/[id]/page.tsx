import Link from "next/link";
import { notFound } from "next/navigation";
import { subDays } from "date-fns";
import { requireUser, can } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { shiftInclude, ON_SITE_STATUSES } from "@/lib/services/shifts";
import { CATEGORY_LABEL } from "@/lib/services/incidents";
import { PageHeader, Meta } from "@/components/ui/page";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Table, THead, TBody, Empty } from "@/components/ui/table";
import { Avatar } from "@/components/ui/avatar";
import { Status } from "@/components/ui/status";
import { ButtonGroup, LinkButton } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { ShiftStatusLabel } from "@/components/shift-status";
import { setLocationActive } from "@/actions/locations";
import { fmtDate, fmtTime, fmtShort } from "@/lib/time";
import { clientPhoneFor } from "@/lib/sms/client-updates";
import { SiteMap } from "@/components/map/site-map";
import { EmptyState } from "@/components/workspace/panel";
import { COORDINATES_SOURCE_META } from "@/lib/site-config";
import { NotifyClientButton, ClientNotificationList } from "@/components/clients/notify-client";
import { notificationHistory } from "@/lib/client-notifications/service";

export const metadata = { title: "Location" };
const PATTERN: Record<string, string> = { DAY_8: "Day · 8 h", NIGHT_8: "Night · 8 h", DAY_12: "Day · 12 h", NIGHT_12: "Night · 12 h", CUSTOM: "Custom" };

export default async function LocationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const l = await db.location.findUnique({ where: { id }, include: { client: true, supervisor: true } });
  if (!l) notFound();
  const [onPost, upcoming, recent, incidents, assigned, messages] = await Promise.all([
    db.shift.findMany({ where: { locationId: id, status: { in: ON_SITE_STATUSES } }, include: shiftInclude }),
    db.shift.findMany({ where: { locationId: id, startAt: { gte: new Date() }, status: "SCHEDULED" }, include: shiftInclude, orderBy: { startAt: "asc" }, take: 10 }),
    db.shift.findMany({ where: { locationId: id, startAt: { gte: subDays(new Date(), 14), lt: new Date() } }, include: shiftInclude, orderBy: { startAt: "desc" }, take: 30 }),
    db.incident.findMany({ where: { locationId: id }, include: { guard: true }, orderBy: { occurredAt: "desc" }, take: 10 }),
    db.guard.findMany({ where: { homeLocationId: id, active: true }, orderBy: { lastName: "asc" } }),
    notificationHistory({ locationId: id }, 15),
  ]);
  const drafts = messages.filter((m) => m.status === "PENDING_APPROVAL").length;
  return (
    <div>
      <PageHeader title={l.name} description={`${l.client.name} · ${l.address}`} actions={(
        <ButtonGroup>
          <NotifyClientButton locationId={l.id} />
          {can.manageLocations(user) && <>
          <LinkButton href={`/shifts/new?locationId=${l.id}`}>Schedule shift</LinkButton>
          <LinkButton href={`/locations/${l.id}/edit`}>Edit</LinkButton>
          {l.active ? <ConfirmButton size="md" label="Deactivate" variant="danger" title={`Deactivate ${l.name}?`} body="The site is archived. History is kept." confirmLabel="Deactivate" action={async () => { "use server"; await setLocationActive(l.id, false); }} /> : <ConfirmButton size="md" label="Reactivate" title={`Reactivate ${l.name}?`} body="" confirmLabel="Reactivate" action={async () => { "use server"; await setLocationActive(l.id, true); }} />}
          </>}
        </ButtonGroup>
      )} />
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader title="On post now" description={`${onPost.length} of ${l.requiredGuards} required`} action={<Status tone={onPost.length >= l.requiredGuards ? "ok" : onPost.length ? "warn" : "critical"}>{onPost.length >= l.requiredGuards ? "Fully covered" : onPost.length ? "Under-covered" : "No cover"}</Status>} />
            <CardBody className="pt-3">
              {onPost.length === 0 ? <p className="text-[13px] text-ink-3">Nobody has confirmed arrival at this site right now.</p> : (
                <ul className="divide-y divide-line">
                  {onPost.map((s) => (
                    <li key={s.id} className="flex items-center gap-3 py-3">
                      <Avatar src={s.guard.photoUrl} name={s.guard.firstName} size={32} />
                      <div className="flex-1"><Link href={`/shifts/${s.id}`} className="font-medium text-ink hover:underline">{s.guard.firstName} {s.guard.lastName}</Link><p className="text-[12px] text-ink-3 tnum">{fmtTime(s.startAt)}–{fmtTime(s.endAt)} · arrived {fmtTime(s.attendance?.arrivalConfirmedAt)}</p></div>
                      <ShiftStatusLabel status={s.status} />
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Upcoming shifts" />
            <Table>
              <THead><tr><th>Date</th><th>Guard</th><th>Hours</th><th>Status</th></tr></THead>
              <TBody>
                {upcoming.length === 0 && <Empty colSpan={4} title="Nothing scheduled" action={<LinkButton href={`/shifts/new?locationId=${l.id}`} size="sm" variant="primary">Schedule shift</LinkButton>} />}
                {upcoming.map((s) => <tr key={s.id}><td className="tnum"><Link href={`/shifts/${s.id}`} className="font-medium hover:underline">{fmtDate(s.startAt)}</Link></td><td>{s.guard.firstName} {s.guard.lastName}</td><td className="tnum">{fmtTime(s.startAt)}–{fmtTime(s.endAt)}</td><td><ShiftStatusLabel status={s.status} /></td></tr>)}
              </TBody>
            </Table>
          </Card>
          <div id="client-messages" className="scroll-mt-20">
            <Card>
              <CardHeader title="Messages to the client" description={drafts ? `${drafts} awaiting approval. Nothing is sent until approved.` : "What was sent to the client about this site, and whether it arrived."} action={<Link href={`/clients/${l.clientId}`} className="text-[13px] font-medium text-accent hover:underline">All for {l.client.name}</Link>} />
              <ClientNotificationList items={messages} role={user.role} showSite={false} empty="No messages to the client about this site yet." />
            </Card>
          </div>
          <Card>
            <CardHeader title="Last 14 days" />
            <Table>
              <THead><tr><th>Date</th><th>Guard</th><th>Hours</th><th>Arrival</th><th>Status</th></tr></THead>
              <TBody>
                {recent.length === 0 && <Empty colSpan={5} title="No recent shifts" />}
                {recent.map((s) => <tr key={s.id}><td className="tnum"><Link href={`/shifts/${s.id}`} className="font-medium hover:underline">{fmtDate(s.startAt)}</Link></td><td>{s.guard.firstName} {s.guard.lastName}</td><td className="tnum">{fmtTime(s.startAt)}–{fmtTime(s.endAt)}</td><td className="tnum">{s.attendance?.arrivalConfirmedAt ? fmtTime(s.attendance.arrivalConfirmedAt) : "—"}</td><td><ShiftStatusLabel status={s.status} /></td></tr>)}
              </TBody>
            </Table>
          </Card>
        </div>
        <div className="min-w-0 space-y-4">
          <Card><CardBody className="pt-5">
            <div className="grid grid-cols-2 gap-4">
              <Meta label="Site code">{l.code}</Meta><Meta label="Type">{l.siteType ?? "—"}</Meta>
              <Meta label="Client"><Link href={`/clients/${l.clientId}`} className="hover:underline">{l.client.name}</Link></Meta><Meta label="Pattern">{PATTERN[l.shiftPattern]}</Meta>
              <Meta label="Required guards">{l.requiredGuards}</Meta><Meta label="Supervisor">{l.supervisor?.name ?? "—"}</Meta>
              <Meta label="Geofence" className="col-span-2">{l.latitude != null && l.longitude != null ? <span className="tnum">{l.geofenceRadiusM} m radius · {l.latitude.toFixed(5)}, {l.longitude.toFixed(5)} · config v{l.configVersion}{l.coordinatesSource && <> · <Status tone={COORDINATES_SOURCE_META[l.coordinatesSource].tone}>{COORDINATES_SOURCE_META[l.coordinatesSource].label}</Status></>}{l.coordinatesSource === "TEST" && <span className="block text-warn">{COORDINATES_SOURCE_META.TEST.description} <Link href={`/locations/${l.id}/edit`} className="underline">Place it on the map</Link>.</span>}</span> : <span className="text-warn">No coordinates: GPS verification is off for this site. <Link href={`/locations/${l.id}/edit`} className="underline">Place it on the map</Link>.</span>}</Meta>
              <Meta label="Site contact" className="col-span-2">{l.contactName ?? "—"}{l.contactPhone ? ` · ${l.contactPhone}` : ""}</Meta>
              <Meta label="Status" className="col-span-2">{l.active ? <Status tone="ok">Active</Status> : <Status tone="muted">Inactive</Status>}</Meta>
              <Meta label="Client updates" className="col-span-2">{l.clientUpdates ? <span>{[l.notifyClientArrival && "arrival", l.notifyClientWelfare && "all well", l.notifyClientCompletion && "shift ended", l.notifyClientLate && "late", l.notifyClientAbsent && "missed check-in", l.notifyClientOutside && "away from post (approval)", l.notifyClientEmergency && "emergency (approval)"].filter(Boolean).join(", ") || "none selected"} · to {clientPhoneFor(l) ?? <span className="text-critical">no number set</span>}{l.clientUpdateEmail ? ` and ${l.clientUpdateEmail}` : ""}</span> : <span className="text-ink-3">Off</span>}</Meta>
            </div>
            {l.specialInstructions && <div className="mt-4 border-t border-dashed border-line pt-3"><div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">Special instructions</div><p className="mt-1 text-[13px] text-ink">{l.specialInstructions}</p></div>}
          </CardBody></Card>
          <Card><CardHeader title="Site and geofence" /><CardBody>
            {l.latitude != null && l.longitude != null
              ? <SiteMap site={{ lat: l.latitude, lng: l.longitude, radiusM: l.geofenceRadiusM, name: l.name }} points={[]} height={240} />
              : <EmptyState icon="pin_drop" title="No site centre set" detail="GPS verification stays off for this site until it has coordinates. SMS attendance checks are unaffected." action={<LinkButton href={`/locations/${l.id}/edit`} variant="primary" size="sm">Set the site centre</LinkButton>} />}
          </CardBody></Card>
          <Card>
            <CardHeader title="Assigned guards" description="Guards whose usual site is here." />
            <CardBody className="pt-3">
              {assigned.length === 0 ? <p className="text-[13px] text-ink-3">None assigned.</p> : <ul className="space-y-2">{assigned.map((g) => <li key={g.id}><Link href={`/guards/${g.id}`} className="flex items-center gap-2 text-[13px] hover:underline"><Avatar src={g.photoUrl} name={g.firstName} size={24} />{g.firstName} {g.lastName}</Link></li>)}</ul>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Recent incidents" />
            <CardBody className="pt-3">
              {incidents.length === 0 ? <p className="text-[13px] text-ink-3">No incidents recorded.</p> : <ul className="divide-y divide-line">{incidents.map((i) => <li key={i.id} className="py-2.5"><Link href={`/incidents/${i.id}`} className="text-[13px] font-medium text-ink hover:underline">{i.incidentNo} · {CATEGORY_LABEL[i.category]}</Link><p className="text-[12px] text-ink-3">{fmtShort(i.occurredAt)} · {i.guard.firstName} {i.guard.lastName} · {i.status.toLowerCase()}</p></li>)}</ul>}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
