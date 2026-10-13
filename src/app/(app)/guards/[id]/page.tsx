import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, can } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { guardPerformance, guardLiveStatus, GUARD_STATUS_LABEL } from "@/lib/services/guards";
import { ON_SITE_STATUSES, shiftInclude } from "@/lib/services/shifts";
import { ATTENDANCE_LABEL } from "@/lib/services/attendance";
import { CATEGORY_LABEL } from "@/lib/services/incidents";
import { PageHeader, Meta } from "@/components/ui/page";
import { Card, CardBody } from "@/components/ui/card";
import { Table, THead, TBody, Empty } from "@/components/ui/table";
import { Avatar } from "@/components/ui/avatar";
import { Status } from "@/components/ui/status";
import { ButtonGroup, LinkButton } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { ShiftStatusLabel } from "@/components/shift-status";
import { setGuardActive } from "@/actions/guards";
import { setGuardWatched } from "@/actions/messages";
import { fmtDate, fmtTime, fmtDateTime, fmtShort } from "@/lib/time";
import { formatPhone } from "@/lib/phone";

export const metadata = { title: "Guard" };

export default async function GuardPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { tab = "shifts" } = await searchParams;
  const g = await db.guard.findUnique({ where: { id }, include: { homeLocation: true, supervisor: true } });
  if (!g) notFound();
  const [perf, shifts, incidents, deployed, messages, auditRows] = await Promise.all([
    guardPerformance(id),
    db.shift.findMany({ where: { guardId: id }, include: shiftInclude, orderBy: { startAt: "desc" }, take: 40 }),
    db.incident.findMany({ where: { guardId: id }, include: { location: true }, orderBy: { occurredAt: "desc" } }),
    db.shift.findFirst({ where: { guardId: id, status: { in: ON_SITE_STATUSES } }, include: { location: true } }),
    db.smsMessage.findMany({ where: { guardId: id }, orderBy: { createdAt: "desc" }, take: 30 }),
    db.auditLog.findMany({ where: { entity: "Guard", entityId: id }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  const name = `${g.firstName} ${g.lastName}`;
  const live = guardLiveStatus(g, Boolean(deployed));
  const tone = { DEPLOYED: "ok", AVAILABLE: "neutral", ON_LEAVE: "warn", SUSPENDED: "critical", INACTIVE: "muted" } as const;
  const tabs = [["shifts", "Shifts & attendance"], ["incidents", `Incidents (${incidents.length})`], ["messages", "Messages"], ["history", "History"]];

  return (
    <div>
      <PageHeader title={name} description={`${g.guardNo} · ${formatPhone(g.phone)}`} actions={can.manageGuards(user) && (
        <ButtonGroup>
          <LinkButton href={`/messages/new?guardId=${g.id}`}>Message</LinkButton>
          {g.watched
            ? <ConfirmButton size="md" label="Stop watching" title={`Stop watching ${name}?`} body="Their events return to normal priority and they leave the Monitoring page." confirmLabel="Stop watching" action={async () => { "use server"; await setGuardWatched(g.id, false); }} />
            : <ConfirmButton size="md" label="Watch" title={`Watch ${name} closely?`} body="They appear on the Monitoring page, every event about them is raised to at least a warning, and pushed to your devices." withNote="Why are you watching them? (shown on the Monitoring page)" confirmLabel="Start watching" action={async (note) => { "use server"; await setGuardWatched(g.id, true, note); }} />}
          <LinkButton href={`/shifts/new?guardId=${g.id}`}>Schedule shift</LinkButton>
          <LinkButton href={`/guards/${g.id}/edit`}>Edit</LinkButton>
          {g.active
            ? <ConfirmButton size="md" label="Deactivate" variant="danger" title={`Deactivate ${name}?`} body="The guard is archived, not deleted. Future scheduled shifts are cancelled; history is kept." confirmLabel="Deactivate" action={async () => { "use server"; await setGuardActive(g.id, false); }} />
            : <ConfirmButton size="md" label="Reactivate" title={`Reactivate ${name}?`} body="The guard becomes available for scheduling again." confirmLabel="Reactivate" action={async () => { "use server"; await setGuardActive(g.id, true); }} />}
        </ButtonGroup>
      )} />

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Card>
            <CardBody className="pt-5">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
                <Meta label="Attendance"><span className="text-[20px] font-semibold tnum">{perf.attendancePct}%</span></Meta>
                <Meta label="Completed"><span className="text-[20px] font-semibold tnum">{perf.completed}</span></Meta>
                <Meta label="Late arrivals"><span className="text-[20px] font-semibold tnum">{perf.late}</span></Meta>
                <Meta label="Missed shifts"><span className="text-[20px] font-semibold tnum">{perf.missed}</span></Meta>
                <Meta label="Missed checks"><span className="text-[20px] font-semibold tnum">{perf.missedChecks}</span></Meta>
                <Meta label="Incidents"><span className="text-[20px] font-semibold tnum">{perf.incidents}</span></Meta>
                <Meta label="Assistance"><span className="text-[20px] font-semibold tnum">{perf.assistance}</span></Meta>
              </div>
            </CardBody>
          </Card>

          <Card>
            <div className="flex gap-1 border-b border-line px-3 pt-2">
              {tabs.map(([k, l]) => <Link key={k} href={`/guards/${g.id}?tab=${k}`} className={`-mb-px border-b-2 px-3 py-2.5 text-[13px] font-medium ${tab === k ? "border-accent text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}>{l}</Link>)}
            </div>
            {tab === "shifts" && (
              <Table>
                <THead><tr><th>Date</th><th>Location</th><th>Hours</th><th>Arrival</th><th>Completion</th><th>Attendance</th><th>Status</th></tr></THead>
                <TBody>
                  {shifts.length === 0 && <Empty colSpan={7} title="No shifts yet" />}
                  {shifts.map((s) => (
                    <tr key={s.id}>
                      <td className="tnum"><Link href={`/shifts/${s.id}`} className="font-medium text-ink hover:underline">{fmtDate(s.startAt)}</Link></td>
                      <td>{s.location.name}</td>
                      <td className="tnum">{fmtTime(s.startAt)}–{fmtTime(s.endAt)}</td>
                      <td className="tnum">{s.attendance?.arrivalConfirmedAt ? `${fmtTime(s.attendance.arrivalConfirmedAt)}${s.attendance.lateMinutes > 15 ? ` · +${s.attendance.lateMinutes} min` : ""}` : "—"}</td>
                      <td className="tnum">{s.attendance?.completionConfirmedAt ? fmtTime(s.attendance.completionConfirmedAt) : "—"}</td>
                      <td>{s.attendance ? <Status tone={ATTENDANCE_LABEL[s.attendance.status].tone}>{ATTENDANCE_LABEL[s.attendance.status].label}</Status> : "—"}</td>
                      <td><ShiftStatusLabel status={s.status} /></td>
                    </tr>
                  ))}
                </TBody>
              </Table>
            )}
            {tab === "incidents" && (
              <Table>
                <THead><tr><th>Incident</th><th>When</th><th>Location</th><th>Category</th><th>Severity</th><th>Status</th></tr></THead>
                <TBody>
                  {incidents.length === 0 && <Empty colSpan={6} title="No incidents involving this guard" />}
                  {incidents.map((i) => (
                    <tr key={i.id}>
                      <td><Link href={`/incidents/${i.id}`} className="font-medium text-ink hover:underline">{i.incidentNo}</Link><p className="max-w-md truncate text-[12px] text-ink-3">{i.description}</p></td>
                      <td className="tnum">{fmtShort(i.occurredAt)}</td><td>{i.location.name}</td><td>{CATEGORY_LABEL[i.category]}</td>
                      <td><Status tone={i.severity === "CRITICAL" || i.severity === "HIGH" ? "critical" : i.severity === "MEDIUM" ? "warn" : "neutral"}>{i.severity.toLowerCase()}</Status></td>
                      <td><Status tone={i.status === "OPEN" ? "critical" : i.status === "ACKNOWLEDGED" ? "warn" : "ok"}>{i.status.toLowerCase()}</Status></td>
                    </tr>
                  ))}
                </TBody>
              </Table>
            )}
            {tab === "messages" && (
              <CardBody>
                <ul className="space-y-2">
                  {messages.length === 0 && <Empty title="No messages yet" />}
                  {messages.map((m) => (
                    <li key={m.id} className={m.direction === "INBOUND" ? "flex justify-end" : "flex"}>
                      <div className={`max-w-[75%] rounded-[12px] px-3.5 py-2 text-[13px] ${m.direction === "INBOUND" ? "bg-accent-soft" : "bg-surface-2"}`}><p>{m.body}</p><p className="mt-1 text-[11px] text-ink-3 tnum">{fmtDateTime(m.createdAt)} · {m.status.toLowerCase()}</p></div>
                    </li>
                  ))}
                </ul>
              </CardBody>
            )}
            {tab === "history" && (
              <Table>
                <THead><tr><th>When</th><th>Action</th><th>By</th><th>Details</th></tr></THead>
                <TBody>
                  {auditRows.length === 0 && <Empty colSpan={4} title="No changes recorded" />}
                  {auditRows.map((a) => <tr key={a.id}><td className="tnum">{fmtDateTime(a.createdAt)}</td><td className="font-medium">{a.action.toLowerCase().replace(/_/g, " ")}</td><td>{a.actor}</td><td className="text-ink-2">{a.details ? JSON.stringify(a.details) : ""}</td></tr>)}
                </TBody>
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardBody className="pt-5">
              <div className="flex items-center gap-3"><Avatar src={g.photoUrl} name={name} size={56} /><div><p className="font-semibold text-ink">{name}</p><Status tone={tone[live]}>{live === "DEPLOYED" && deployed ? `Deployed · ${deployed.location.name}` : GUARD_STATUS_LABEL[live]}</Status></div></div>
              {g.watched && <div className="mt-4 rounded-[10px] border border-warn/40 bg-warn-soft px-3 py-2 text-[13px] text-[#8a5e05]"><span className="font-semibold">Being watched</span>{g.watchNote ? ` · ${g.watchNote}` : ""}. <Link href="/monitoring" className="underline">Open monitoring</Link></div>}
              <div className="mt-5 grid grid-cols-2 gap-4">
                <Meta label="Phone"><a href={`tel:${g.phone}`} className="underline">{formatPhone(g.phone)}</a></Meta>
                <Meta label="Email">{g.email ? <a href={`mailto:${g.email}`} className="underline">{g.email}</a> : "—"}</Meta>
                <Meta label="National ID">{g.nationalId}</Meta>
                <Meta label="Gender">{g.gender === "MALE" ? "Male" : g.gender === "FEMALE" ? "Female" : "Other"}</Meta>
                <Meta label="Date of birth">{fmtDate(g.dateOfBirth)}</Meta>
                <Meta label="Employed since">{fmtDate(g.dateEmployed)}</Meta>
                <Meta label="Employment">{g.employmentStatus === "ACTIVE" ? "Active" : g.employmentStatus === "ON_LEAVE" ? "On leave" : g.employmentStatus === "SUSPENDED" ? "Suspended" : "Inactive"}</Meta>
                <Meta label="Supervisor">{g.supervisor?.name ?? "—"}</Meta>
                <Meta label="Usual location">{g.homeLocation ? <Link href={`/locations/${g.homeLocation.id}`} className="hover:underline">{g.homeLocation.name}</Link> : "—"}</Meta>
                <Meta label="Address" className="col-span-2">{g.address ?? "—"}</Meta>
                <Meta label="Emergency contact" className="col-span-2">{g.emergencyContactName ? `${g.emergencyContactName} · ${g.emergencyContactPhone ?? ""}` : "—"}</Meta>
              </div>
              {g.notes && <p className="mt-4 border-t border-dashed border-line pt-3 text-[13px] text-ink-2">{g.notes}</p>}
              {!g.active && <p className="mt-3 text-[12px] text-critical">Deactivated {fmtDate(g.deactivatedAt)}.</p>}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
