import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, can } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { shiftInclude, STATUS_META, CLOSED_STATUSES } from "@/lib/services/shifts";
import { PageHeader, Meta } from "@/components/ui/page";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Timeline } from "@/components/timeline";
import { ShiftStatusLabel } from "@/components/shift-status";
import { Avatar } from "@/components/ui/avatar";
import { Status } from "@/components/ui/status";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { ButtonGroup, LinkButton } from "@/components/ui/button";
import { cancelShift, manualArrival, manualComplete, addShiftNote } from "@/actions/shifts";
import { fmtTime, fmtDate, fmtDuration, fmtDateTime } from "@/lib/time";
import { formatPhone } from "@/lib/phone";
import { ATTENDANCE_LABEL } from "@/lib/services/attendance";
import { addMinutes } from "date-fns";
import { SimulatorInline } from "@/components/simulator-inline";
import { CATEGORY_LABEL } from "@/lib/services/incidents";

export const metadata = { title: "Shift" };

export default async function ShiftPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const s = await db.shift.findUnique({ where: { id }, include: { ...shiftInclude, checkIns: { include: { smsMessage: { select: { body: true, direction: true } } }, orderBy: [{ at: "asc" }, { id: "asc" }] }, welfareChecks: { orderBy: { sentAt: "asc" } }, incidents: { orderBy: { occurredAt: "desc" } }, smsMessages: { orderBy: { createdAt: "asc" } } } });
  if (!s) notFound();
  const guardName = `${s.guard.firstName} ${s.guard.lastName}`;
  const live = !CLOSED_STATUSES.includes(s.status);
  const midpoint = addMinutes(s.startAt, s.durationMinutes / 2);
  const [outgoing, incoming] = await Promise.all([
    db.shift.findFirst({ where: { locationId: s.locationId, id: { not: s.id }, endAt: { gte: addMinutes(s.startAt, -90), lte: addMinutes(s.startAt, 90) }, status: { not: "CANCELLED" } }, include: { guard: true, attendance: true } }),
    db.shift.findFirst({ where: { locationId: s.locationId, id: { not: s.id }, startAt: { gte: addMinutes(s.endAt, -90), lte: addMinutes(s.endAt, 90) }, status: { not: "CANCELLED" } }, include: { guard: true, attendance: true } }),
  ]);
  const att = s.attendance ? ATTENDANCE_LABEL[s.attendance.status] : null;

  return (
    <div>
      <PageHeader title={`${guardName} · ${s.location.name}`} description={`${fmtDate(s.startAt)} · ${fmtTime(s.startAt)}–${fmtTime(s.endAt)} · ${fmtDuration(s.durationMinutes)}`} actions={
        can.manageShifts(user) && live && (
          <ButtonGroup>
            {!s.attendance?.arrivalConfirmedAt && <ConfirmButton size="md" label="Confirm arrival manually" title="Confirm arrival manually?" body={`Record ${guardName} as on post now, for example after a phone call.`} withNote="How was this confirmed?" confirmLabel="Confirm arrival" action={async (note) => { "use server"; await manualArrival(s.id, note); }} />}
            {s.attendance?.arrivalConfirmedAt && <ConfirmButton size="md" label="Mark completed" title="Mark this shift completed?" body="Use when the guard confirmed by phone or radio rather than SMS." withNote="Note" confirmLabel="Mark completed" action={async (note) => { "use server"; await manualComplete(s.id, note); }} />}
            <ConfirmButton size="md" label="Cancel shift" variant="danger" title="Cancel this shift?" body="The guard will no longer receive checks for it. This is recorded on the timeline." withNote="Reason" confirmLabel="Cancel shift" action={async (note) => { "use server"; await cancelShift(s.id, note); }} />
          </ButtonGroup>
        )
      } />

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Timeline" description="Every automated check, reply and decision on this shift, in order." action={<ShiftStatusLabel status={s.status} />} />
            <CardBody><Timeline events={s.checkIns} showDates={s.durationMinutes > 12 * 60} /></CardBody>
            {live && can.simulate(user) && (
              <div className="border-t border-dashed border-line px-5 py-4">
                <SimulatorInline guardId={s.guardId} guardName={guardName} pending={s.pendingPrompt} />
              </div>
            )}
            <div className="border-t border-line px-5 py-4">
              <form action={async (fd) => { "use server"; const n = String(fd.get("note") ?? "").trim(); if (n) await addShiftNote(s.id, n); }} className="flex gap-2">
                <input name="note" placeholder="Add a note to the timeline" className="h-9 flex-1 rounded-[8px] border border-line px-3 text-sm placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20" />
                <button className="h-9 rounded-[8px] border border-line bg-surface px-3 text-[13px] font-medium hover:bg-surface-2">Add note</button>
              </form>
            </div>
          </Card>

          {s.incidents.length > 0 && (
            <Card>
              <CardHeader title="Incidents on this shift" />
              <CardBody className="pt-3">
                <ul className="divide-y divide-line">
                  {s.incidents.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-4 py-3">
                      <div className="min-w-0"><Link href={`/incidents/${i.id}`} className="font-medium text-ink hover:underline">{i.incidentNo} · {CATEGORY_LABEL[i.category]}</Link><p className="truncate text-[13px] text-ink-2">{i.description}</p></div>
                      <Status tone={i.status === "RESOLVED" || i.status === "CLOSED" ? "ok" : i.severity === "CRITICAL" ? "critical" : "warn"}>{i.status.toLowerCase()}</Status>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Messages" description={`${s.smsMessages.length} SMS on this shift`} action={<Link href={`/sms?shiftId=${s.id}`} className="text-[13px] font-medium text-accent-strong hover:underline">Open in SMS logs</Link>} />
            <CardBody className="pt-3">
              <ul className="space-y-2">
                {s.smsMessages.map((m) => (
                  <li key={m.id} className={m.direction === "INBOUND" ? "flex justify-end" : "flex"}>
                    <div className={`max-w-[80%] rounded-[12px] px-3.5 py-2 text-[13px] ${m.direction === "INBOUND" ? "bg-accent-soft text-ink" : "bg-surface-2 text-ink"}`}>
                      <p>{m.body}</p>
                      <p className="mt-1 text-[11px] text-ink-3 tnum">{fmtTime(m.createdAt)} · {m.type.toLowerCase().replace("_", " ")} · {m.status.toLowerCase()}{m.interpretedAs ? ` · read as ${m.interpretedAs}` : ""}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardBody className="pt-5">
              <Link href={`/guards/${s.guardId}`} className="flex items-center gap-3">
                <Avatar src={s.guard.photoUrl} name={guardName} size={44} />
                <div><p className="font-semibold text-ink">{guardName}</p><p className="text-[13px] text-ink-2">{s.guard.guardNo} · {formatPhone(s.guard.phone)}</p></div>
              </Link>
              <div className="mt-5 grid grid-cols-2 gap-4">
                <Meta label="Location"><Link href={`/locations/${s.locationId}`} className="hover:underline">{s.location.name}</Link></Meta>
                <Meta label="Client">{s.location.client.name}</Meta>
                <Meta label="Supervisor">{s.supervisor?.name ?? "—"}</Meta>
                <Meta label="Attendance">{att ? <Status tone={att.tone}>{att.label}</Status> : "—"}</Meta>
                <Meta label="Arrival">{s.attendance?.arrivalConfirmedAt ? `${fmtTime(s.attendance.arrivalConfirmedAt)}${s.attendance.lateMinutes ? ` (${s.attendance.lateMinutes} min late)` : ""}` : "Not confirmed"}</Meta>
                <Meta label="Completion">{s.attendance?.completionConfirmedAt ? fmtTime(s.attendance.completionConfirmedAt) : s.completionTimedOutAt ? "Unconfirmed" : "—"}</Meta>
                <Meta label="Welfare check">{s.welfareSmsSentAt ? `Sent ${fmtTime(s.welfareSmsSentAt)}` : `Due ${fmtTime(midpoint)}`}</Meta>
                <Meta label="Missed checks">{s.attendance?.missedChecks ?? 0}</Meta>
                <Meta label="Awaiting reply">{s.pendingPrompt === "NONE" ? "Nothing" : s.pendingPrompt.toLowerCase().replace("_", " ")}</Meta>
                <Meta label="Status">{STATUS_META[s.status].label}</Meta>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Handover" />
            <CardBody className="pt-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-[10px] border border-line p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">Outgoing</div>
                  <p className="mt-1 text-[14px] font-medium text-ink">{outgoing ? `${outgoing.guard.firstName} ${outgoing.guard.lastName}` : "—"}</p>
                  <p className="text-[12px] text-ink-2">{outgoing ? `ends ${fmtTime(outgoing.endAt)}` : "No preceding shift"}</p>
                </div>
                <div className="rounded-[10px] border border-line p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">Incoming</div>
                  <p className="mt-1 text-[14px] font-medium text-ink">{incoming ? `${incoming.guard.firstName} ${incoming.guard.lastName}` : "—"}</p>
                  <p className="text-[12px] text-ink-2">{incoming ? `takes over ${fmtTime(incoming.startAt)}` : "No relief scheduled"}</p>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between text-[13px]">
                <span className="text-ink-2">Handover status</span>
                {incoming?.attendance?.arrivalConfirmedAt && s.attendance?.completionConfirmedAt ? <Status tone="ok">Completed</Status> : s.handoverSmsSentAt ? <Status tone="neutral">Notified {fmtTime(s.handoverSmsSentAt)}</Status> : <Status tone="neutral">Pending</Status>}
              </div>
              {!incoming && can.manageShifts(user) && live && <LinkButton href={`/shifts/new?locationId=${s.locationId}&date=${s.endAt.toISOString().slice(0, 10)}`} size="sm" className="mt-3 w-full">Schedule relief</LinkButton>}
            </CardBody>
          </Card>

          {(s.instructions || s.notes) && (
            <Card>
              <CardHeader title="Instructions" />
              <CardBody className="space-y-3 pt-3 text-[13px]">
                {s.instructions && <p className="text-ink">{s.instructions}</p>}
                {s.notes && <p className="border-t border-dashed border-line pt-3 text-ink-2"><span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">Internal</span><br />{s.notes}</p>}
              </CardBody>
            </Card>
          )}
          <p className="px-1 text-[12px] text-ink-3">Created {fmtDateTime(s.createdAt)}{s.recurrenceId ? " from a recurring pattern" : ""}.</p>
        </div>
      </div>
    </div>
  );
}
