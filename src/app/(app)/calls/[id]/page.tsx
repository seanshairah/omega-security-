import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, can } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { callInclude } from "@/lib/gateway/calls";
import { CALL_STATUS_META, fmtCallDuration } from "@/lib/gateway/call-state";
import { markCallHandled, resolveCallerAction } from "@/actions/gateways";
import { PageHeader, Meta } from "@/components/ui/page";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Status } from "@/components/ui/status";
import { Avatar } from "@/components/ui/avatar";
import { ButtonGroup, LinkButton } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { LinkCaller } from "@/components/calls/link-caller";
import { Timeline } from "@/components/timeline";
import { fmtDateTime, fmtTime, fmtDate } from "@/lib/time";
import { formatPhone } from "@/lib/phone";

export const metadata = { title: "Call" };

export default async function CallPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const c = await db.callLog.findUnique({ where: { id }, include: { ...callInclude, shift: { include: { checkIns: { include: { smsMessage: { select: { body: true, direction: true } } }, orderBy: [{ at: "asc" }, { id: "asc" }] } } } } });
  if (!c) notFound();
  const [events, sameNumber, guards] = await Promise.all([
    db.gatewayEvent.findMany({ where: { gatewayDeviceId: c.gatewayDeviceId, callId: c.callId }, orderBy: { occurredAt: "asc" } }),
    db.callLog.count({ where: { normalizedPhoneNumber: c.normalizedPhoneNumber, id: { not: c.id } } }),
    c.unknownCaller ? db.guard.findMany({ where: { active: true }, orderBy: { lastName: "asc" }, select: { id: true, firstName: true, lastName: true } }) : Promise.resolve([]),
  ]);
  const meta = CALL_STATUS_META[c.status];
  const who = c.guard ? `${c.guard.firstName} ${c.guard.lastName}` : "Unknown caller";
  const missedActive = c.status === "MISSED" && Boolean(c.shiftId);
  return (
    <div>
      <PageHeader title={`${who} · ${fmtDate(c.startedAt)} ${fmtTime(c.startedAt)}`} description={`${c.direction === "INCOMING" ? "Incoming call to" : "Outgoing call from"} ${c.gateway.deviceName}${c.simulated ? " · simulated" : ""}`} actions={
        <ButtonGroup>
          {c.guard && <a href={`tel:${c.guard.phone}`} className="inline-flex h-9 items-center rounded-[8px] bg-accent px-3.5 text-sm font-medium text-white hover:bg-accent-strong">Call {c.guard.firstName} back</a>}
          {c.status === "MISSED" && !c.note && can.manageIncidents(user) && <ConfirmButton size="md" label="Mark handled" title="Mark this missed call as handled?" body="Record that someone called the guard back or otherwise dealt with it. The alert is cleared." withNote="What was done?" confirmLabel="Mark handled" action={async (note) => { "use server"; await markCallHandled(c.id, note); }} />}
          {c.shift && <LinkButton href={`/shifts/${c.shift.id}`}>Open shift</LinkButton>}
          <LinkButton href={`/gateways/${c.gateway.id}`}>Gateway</LinkButton>
        </ButtonGroup>
      } />
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-4">
          <Card className={missedActive ? "border-critical" : c.unknownCaller && !c.unknownResolution ? "border-warn" : ""}>
            <CardHeader title={missedActive ? "Active guard missed call" : c.unknownCaller ? "Unknown caller" : meta.label} description={missedActive ? "This guard was on duty when the call was missed. Call them back." : c.unknownCaller ? "The number is not a registered guard. Nothing was assigned automatically." : undefined} action={<Status tone={meta.tone} pulse={c.status === "RINGING" || c.status === "ANSWERED"}>{meta.label}</Status>} />
            <CardBody>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Meta label="Started">{fmtDateTime(c.startedAt)}</Meta>
                <Meta label="Answered">{c.answeredAt ? fmtTime(c.answeredAt) : "—"}</Meta>
                <Meta label="Ended">{c.endedAt ? fmtTime(c.endedAt) : "—"}</Meta>
                <Meta label="Duration"><span className="text-[20px] font-semibold tnum">{c.status === "ENDED" ? fmtCallDuration(c.durationSeconds) : "—"}</span></Meta>
              </div>
              {c.note && <p className="mt-4 border-t border-dashed border-line pt-3 text-[13px] text-ink-2"><span className="font-semibold text-ink">Handled.</span> {c.note}</p>}
              {c.unknownResolution && <p className="mt-4 border-t border-dashed border-line pt-3 text-[13px] text-ink-2">Number marked as <span className="font-semibold">{c.unknownResolution.toLowerCase()}</span>.</p>}
            </CardBody>
          </Card>
          {c.unknownCaller && can.manageGuards(user) && !c.unknownResolution && (
            <Card>
              <CardHeader title="What is this number?" description={`${formatPhone(c.normalizedPhoneNumber)} has called ${sameNumber + 1} time${sameNumber ? "s" : ""}. Choose what to do; it applies to every unlinked call from this number.`} />
              <CardBody>
                <LinkCaller callId={c.id} guards={guards} phone={c.normalizedPhoneNumber} />
                <div className="mt-3 flex flex-wrap gap-2">
                  <LinkButton href={`/guards/new?phone=${encodeURIComponent(c.normalizedPhoneNumber)}`} size="sm">Add as new guard</LinkButton>
                  <ConfirmButton label="Ignore" title="Ignore this number?" body="Calls from it are kept but no longer flagged." confirmLabel="Ignore" action={async () => { "use server"; await resolveCallerAction(c.id, "IGNORED"); }} />
                  <ConfirmButton label="Block / report" variant="danger" title="Mark this number as blocked?" body="It is flagged as blocked in the call log for the control room. The phone itself does not reject calls; add it to the phone's block list if needed." confirmLabel="Mark blocked" action={async () => { "use server"; await resolveCallerAction(c.id, "BLOCKED"); }} />
                </div>
              </CardBody>
            </Card>
          )}
          {c.shift && (
            <Card>
              <CardHeader title="Shift timeline" description={`${fmtDate(c.shift.startAt)} · ${fmtTime(c.shift.startAt)}–${fmtTime(c.shift.endAt)} · the call is recorded here with the SMS checks`} />
              <CardBody><Timeline events={c.shift.checkIns} /></CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Events from the phone" description="Raw events, deduplicated by their event id. What the reducer made of each one is on the right." />
            <CardBody className="pt-2">
              <ul className="divide-y divide-line text-[13px]">
                {events.map((e) => <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2"><span><span className="tnum text-ink-3">{fmtTime(e.occurredAt)}</span> <span className="font-medium text-ink">{e.eventType}</span></span><span className="text-ink-2">{e.outcome ?? "—"}</span></li>)}
              </ul>
            </CardBody>
          </Card>
        </div>
        <div className="min-w-0 space-y-4">
          <Card><CardBody className="pt-5">
            <div className="flex items-center gap-3">{c.guard ? <Avatar src={c.guard.photoUrl} name={c.guard.firstName} size={44} /> : <span className="flex h-11 w-11 items-center justify-center rounded-full bg-warn-soft text-[#8a5e05]">?</span>}<div>{c.guard ? <Link href={`/guards/${c.guard.id}`} className="font-semibold text-ink hover:underline">{who}</Link> : <p className="font-semibold text-ink">{who}</p>}<p className="text-[13px] text-ink-2 tnum">{formatPhone(c.normalizedPhoneNumber)}</p></div></div>
            <div className="mt-5 grid grid-cols-2 gap-4">
              <Meta label="Gateway"><Link href={`/gateways/${c.gateway.id}`} className="hover:underline">{c.gateway.deviceName}</Link></Meta>
              <Meta label="Gateway number">{formatPhone(c.gateway.phoneNumber)}</Meta>
              <Meta label="Location">{c.location ? <Link href={`/locations/${c.location.id}`} className="hover:underline">{c.location.name}</Link> : "—"}</Meta>
              <Meta label="Client">{c.client?.name ?? "—"}</Meta>
              <Meta label="Shift" className="col-span-2">{c.shift ? <Link href={`/shifts/${c.shift.id}`} className="hover:underline">{fmtDate(c.shift.startAt)} {fmtTime(c.shift.startAt)}–{fmtTime(c.shift.endAt)}</Link> : "No live shift at the time of the call"}</Meta>
              <Meta label="Call id" className="col-span-2"><code className="break-all text-[11px]">{c.callId}</code></Meta>
            </div>
            <p className="mt-4 border-t border-dashed border-line pt-3 text-[12px] text-ink-3">A call proves this number reached the gateway phone. It does not prove the guard was physically on site.</p>
          </CardBody></Card>
        </div>
      </div>
    </div>
  );
}
