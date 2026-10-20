import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, can } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { shiftInclude } from "@/lib/services/shifts";
import { ATTENDANCE_LABEL } from "@/lib/services/attendance";
import { CATEGORY_LABEL } from "@/lib/services/incidents";
import { Table, THead, TBody, Empty } from "@/components/ui/table";
import { Status } from "@/components/ui/status";
import { ButtonGroup, LinkButton } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { ShiftStatusLabel } from "@/components/shift-status";
import { setGuardActive } from "@/actions/guards";
import { setGuardWatched } from "@/actions/messages";
import { fmtDate, fmtTime, fmtDateTime, fmtShort } from "@/lib/time";
import { callInclude } from "@/lib/gateway/calls";
import { CallList } from "@/components/calls/call-list";
import { CommunicationHistory } from "@/components/calls/communication-history";
import { LocationEventList } from "@/components/location/location-events";
import { GuardWorkspace } from "@/components/guards/guard-workspace";
import { guardWorkspaceData } from "@/lib/services/guard-workspace-data";
import { audit } from "@/lib/audit";
import { CallGuardButton } from "@/components/calls/call-guard";
import { NotifyClientButton } from "@/components/clients/notify-client";

export const metadata = { title: "Guard" };

/**
 * Guard operations workspace. The identity bar, location state, map and live feed are client
 * components that poll two small endpoints; the detail region below renders only the active tab's
 * table on the server, so the page no longer loads every list on every request.
 */
export default async function GuardPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { tab = "shifts" } = await searchParams;
  const data = await guardWorkspaceData(id);
  if (!data) notFound();
  const { guard: g, snapshot, activity, profile } = data;
  await audit({ userId: user.id, actor: user.name, action: "LOCATION_VIEWED", entity: "Guard", entityId: id, details: { via: "workspace" } });
  const name = `${g.firstName} ${g.lastName}`;
  const tabs = [{ key: "shifts", label: "Shifts & attendance" }, { key: "incidents", label: "Incidents" }, { key: "messages", label: "SMS" }, { key: "calls", label: "Calls" }, { key: "communication", label: "Communication" }, ...(g.deviceKind === "ANDROID_GUARD" ? [{ key: "location", label: "Location events" }] : []), { key: "history", label: "Audit" }];

  // Only the active tab's rows are read.
  const [shifts, incidents, messages, calls, alerts, locEvents, auditRows] = await Promise.all([
    tab === "shifts" ? db.shift.findMany({ where: { guardId: id }, include: shiftInclude, orderBy: { startAt: "desc" }, take: 40 }) : [],
    tab === "incidents" ? db.incident.findMany({ where: { guardId: id }, include: { location: true }, orderBy: { occurredAt: "desc" }, take: 60 }) : [],
    tab === "messages" || tab === "communication" ? db.smsMessage.findMany({ where: { guardId: id }, orderBy: { createdAt: "desc" }, take: 40 }) : [],
    tab === "calls" || tab === "communication" ? db.callLog.findMany({ where: { guardId: id }, include: callInclude, orderBy: { startedAt: "desc" }, take: 60 }) : [],
    tab === "communication" ? db.guardAlert.findMany({ where: { guardId: id }, include: { acknowledgedBy: { select: { name: true } } }, orderBy: { occurredAt: "desc" }, take: 60 }) : [],
    tab === "location" ? db.locationEvent.findMany({ where: { guardId: id }, include: { shift: { select: { id: true, startAt: true, endAt: true } }, location: { select: { id: true, name: true } } }, orderBy: { occurredAt: "desc" }, take: 80 }) : [],
    tab === "history" ? db.auditLog.findMany({ where: { entity: "Guard", entityId: id }, orderBy: { createdAt: "desc" }, take: 40 }) : [],
  ]);

  // Calling and client updates are open to every role that can see the guard (a supervisor's
  // client update is a draft for approval); the rest of the row is for admins.
  const actions = (
    <ButtonGroup>
      {g.active && <CallGuardButton guardId={g.id} guardName={name} size="sm" />}
      {g.active && <NotifyClientButton guardId={g.id} size="sm" />}
      {can.manageGuards(user) && <>
      <LinkButton href={`/messages/new?guardId=${g.id}`} size="sm">Message</LinkButton>
      {g.watched
        ? <ConfirmButton size="sm" label="Stop watching" title={`Stop watching ${name}?`} body="Their events return to normal priority and they leave the Monitoring page." confirmLabel="Stop watching" action={async () => { "use server"; await setGuardWatched(g.id, false); }} />
        : <ConfirmButton size="sm" label="Watch" title={`Watch ${name} closely?`} body="They appear on the Monitoring page, every event about them is raised to at least a warning, and pushed to your devices." withNote="Why are you watching them? (shown on the Monitoring page)" confirmLabel="Start watching" action={async (note) => { "use server"; await setGuardWatched(g.id, true, note); }} />}
      <LinkButton href={`/shifts/new?guardId=${g.id}`} size="sm">Schedule shift</LinkButton>
      <LinkButton href={`/guards/${g.id}/edit`} size="sm">Edit</LinkButton>
      {g.active
        ? <ConfirmButton size="sm" label="Deactivate" variant="danger" title={`Deactivate ${name}?`} body="The guard is archived, not deleted. Future scheduled shifts are cancelled; history is kept." confirmLabel="Deactivate" action={async () => { "use server"; await setGuardActive(g.id, false); }} />
        : <ConfirmButton size="sm" label="Reactivate" title={`Reactivate ${name}?`} body="The guard becomes available for scheduling again." confirmLabel="Reactivate" action={async () => { "use server"; await setGuardActive(g.id, true); }} />}
      </>}
    </ButtonGroup>
  );

  return (
    <GuardWorkspace initial={snapshot} profile={profile} canRequest={can.manageGuards(user)} canEditSites={can.manageLocations(user)} actions={actions} tabs={tabs} tab={tab} initialActivity={activity}>
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
        <ul className="space-y-2 p-4">
          {messages.length === 0 && <Empty title="No messages yet" />}
          {messages.map((m) => (
            <li key={m.id} className={m.direction === "INBOUND" ? "flex justify-end" : "flex"}>
              <div className={`max-w-[75%] rounded-[12px] px-3.5 py-2 text-[13px] ${m.direction === "INBOUND" ? "bg-accent-soft" : "bg-surface-2"}`}><p>{m.body}</p><p className="mt-1 text-[11px] text-ink-3 tnum">{fmtDateTime(m.createdAt)} · {m.status.toLowerCase()}</p></div>
            </li>
          ))}
        </ul>
      )}
      {tab === "calls" && <CallList calls={calls} showGuard={false} emptyTitle="No calls from this guard yet" />}
      {tab === "communication" && <div className="p-4"><CommunicationHistory messages={messages} calls={calls} alerts={alerts} /></div>}
      {tab === "location" && <LocationEventList events={locEvents} showShift emptyTitle="No location events yet" />}
      {tab === "history" && (
        <Table>
          <THead><tr><th>When</th><th>Action</th><th>By</th><th>Details</th></tr></THead>
          <TBody>
            {auditRows.length === 0 && <Empty colSpan={4} title="No changes recorded" />}
            {auditRows.map((a) => <tr key={a.id}><td className="tnum">{fmtDateTime(a.createdAt)}</td><td className="font-medium">{a.action.toLowerCase().replace(/_/g, " ")}</td><td>{a.actor}</td><td className="text-ink-2">{a.details ? JSON.stringify(a.details) : ""}</td></tr>)}
          </TBody>
        </Table>
      )}
    </GuardWorkspace>
  );
}
