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

export const metadata = { title: "Location" };
const PATTERN: Record<string, string> = { DAY_8: "Day · 8 h", NIGHT_8: "Night · 8 h", DAY_12: "Day · 12 h", NIGHT_12: "Night · 12 h", CUSTOM: "Custom" };

export default async function LocationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const l = await db.location.findUnique({ where: { id }, include: { client: true, supervisor: true } });
  if (!l) notFound();
  const [onPost, upcoming, recent, incidents, assigned] = await Promise.all([
    db.shift.findMany({ where: { locationId: id, status: { in: ON_SITE_STATUSES } }, include: shiftInclude }),
    db.shift.findMany({ where: { locationId: id, startAt: { gte: new Date() }, status: "SCHEDULED" }, include: shiftInclude, orderBy: { startAt: "asc" }, take: 10 }),
    db.shift.findMany({ where: { locationId: id, startAt: { gte: subDays(new Date(), 14), lt: new Date() } }, include: shiftInclude, orderBy: { startAt: "desc" }, take: 30 }),
    db.incident.findMany({ where: { locationId: id }, include: { guard: true }, orderBy: { occurredAt: "desc" }, take: 10 }),
    db.guard.findMany({ where: { homeLocationId: id, active: true }, orderBy: { lastName: "asc" } }),
  ]);
  return (
    <div>
      <PageHeader title={l.name} description={`${l.client.name} · ${l.address}`} actions={can.manageLocations(user) && (
        <ButtonGroup>
          <LinkButton href={`/shifts/new?locationId=${l.id}`}>Schedule shift</LinkButton>
          <LinkButton href={`/locations/${l.id}/edit`}>Edit</LinkButton>
          {l.active ? <ConfirmButton size="md" label="Deactivate" variant="danger" title={`Deactivate ${l.name}?`} body="The site is archived. History is kept." confirmLabel="Deactivate" action={async () => { "use server"; await setLocationActive(l.id, false); }} /> : <ConfirmButton size="md" label="Reactivate" title={`Reactivate ${l.name}?`} body="" confirmLabel="Reactivate" action={async () => { "use server"; await setLocationActive(l.id, true); }} />}
        </ButtonGroup>
      )} />
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="space-y-4">
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
        <div className="space-y-4">
          <Card><CardBody className="pt-5">
            <div className="grid grid-cols-2 gap-4">
              <Meta label="Site code">{l.code}</Meta><Meta label="Type">{l.siteType ?? "—"}</Meta>
              <Meta label="Client">{l.client.name}</Meta><Meta label="Pattern">{PATTERN[l.shiftPattern]}</Meta>
              <Meta label="Required guards">{l.requiredGuards}</Meta><Meta label="Supervisor">{l.supervisor?.name ?? "—"}</Meta>
              <Meta label="Site contact" className="col-span-2">{l.contactName ?? "—"}{l.contactPhone ? ` · ${l.contactPhone}` : ""}</Meta>
              <Meta label="Status" className="col-span-2">{l.active ? <Status tone="ok">Active</Status> : <Status tone="muted">Inactive</Status>}</Meta>
            </div>
            {l.specialInstructions && <div className="mt-4 border-t border-dashed border-line pt-3"><div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">Special instructions</div><p className="mt-1 text-[13px] text-ink">{l.specialInstructions}</p></div>}
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
