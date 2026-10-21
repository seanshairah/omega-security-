import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, can } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { shiftInclude, STATUS_META, CLOSED_STATUSES } from "@/lib/services/shifts";
import { PageHeader, Meta } from "@/components/ui/page";
import { CallGuardButton } from "@/components/calls/call-guard";
import { NotifyClientButton } from "@/components/clients/notify-client";
import { EvidenceList } from "@/components/attendance/evidence-list";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Timeline } from "@/components/timeline";
import { ShiftStatusLabel } from "@/components/shift-status";
import { Avatar } from "@/components/ui/avatar";
import { Status } from "@/components/ui/status";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { ButtonGroup, LinkButton } from "@/components/ui/button";
import { cancelShift, deleteShift, manualArrival, manualComplete, addShiftNote, updateShiftGeofence } from "@/actions/shifts";
import { editPolicy, deletePolicy, DELETE_EXPLAINER } from "@/lib/shift-edit";
import { CheckInRow, type CheckInView } from "@/components/attendance/check-in-card";
import type { CheckInStatus } from "@/lib/attendance/check-in";
import { shiftTraceCounts } from "@/lib/services/shifts";
import { effectiveGeofence, COORDINATES_SOURCE_META } from "@/lib/site-config";
import { GeofenceOverrideSection } from "@/components/map/site-picker";
import { ActionForm } from "@/components/ui/action-form";
import { fmtTime, fmtDate, fmtDuration, fmtDateTime } from "@/lib/time";
import { formatPhone } from "@/lib/phone";
import { ATTENDANCE_LABEL } from "@/lib/services/attendance";
import { addMinutes } from "date-fns";
import { SimulatorInline } from "@/components/simulator-inline";
import { CATEGORY_LABEL } from "@/lib/services/incidents";
import { SiteMap } from "@/components/map/site-map";
import { LocationEventList, SyncBadge } from "@/components/location/location-events";
import { LOCATION_STATE_META, freshness } from "@/lib/geofence";
import { WELFARE_CALL_LABEL, hasSchedule } from "@/lib/welfare/welfare-rules";
import { NETWORK_RESULT_META, NETWORK_TRIGGER_LABEL } from "@/lib/network-location/router-rules";
import { requestNetworkCheck } from "@/actions/network-location";

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
  const androidGuard = s.guard.deviceKind === "ANDROID_GUARD";
  const locEvents = androidGuard ? await db.locationEvent.findMany({ where: { shiftId: s.id }, orderBy: { occurredAt: "asc" } }) : [];
  const latestFix = [...locEvents].reverse().find((e) => e.latitude != null) ?? null;
  const exits = locEvents.filter((e) => e.eventType === "LOCATION_EXIT").length;
  const outsideSeconds = locEvents.filter((e) => e.eventType === "LOCATION_RETURNED").reduce((n, e) => n + (e.durationOutsideSeconds ?? 0), 0);
  const verification = s.attendance?.locationVerification ?? "NOT_APPLICABLE";
  const fence = effectiveGeofence(s, s.location);
  // The call check-in for this shift, when the feature has opened one.
  const checkInRow = await db.attendanceCheckIn.findUnique({ where: { shiftId: s.id }, include: { gatewayDevice: true, decidedBy: { select: { name: true } } } });
  const evidenceRows = await db.attendanceEvidence.findMany({ where: { shiftId: s.id }, include: { decidedBy: { select: { name: true } } }, orderBy: { occurredAt: "asc" } });
  const evidenceGateways = await db.gatewayDevice.findMany({ where: { id: { in: [...new Set(evidenceRows.map((e) => e.gatewayDeviceId).filter((x): x is string => Boolean(x)))] } }, select: { id: true, deviceName: true } });
  const evidence = evidenceRows.map((e) => ({ ...e, gateway: evidenceGateways.find((g) => g.id === e.gatewayDeviceId) ?? null }));
  const pendingEvidence = evidence.filter((e) => e.status === "PENDING" || e.status === "PROVISIONAL").length;
  const scheduledChecks = s.welfareChecks.filter((w) => w.scheduleKey);
  const networkChecks = await db.networkLocationCheck.findMany({ where: { shiftId: s.id }, orderBy: { requestedAt: "desc" }, take: 20 });
  const networkPossible = s.guard.networkLocationEligible && s.location.networkVerifyEnabled;
  const checkIn: CheckInView | null = checkInRow ? {
    id: checkInRow.id, shiftId: s.id, guardName, guardPhone: s.guard.phone, siteName: s.location.name,
    status: checkInRow.status as CheckInStatus, scheduledStartAt: checkInRow.scheduledStartAt,
    callAt: checkInRow.callAt, gpsCapturedAt: checkInRow.gpsCapturedAt, verifiedArrivalAt: checkInRow.verifiedArrivalAt,
    accuracyM: checkInRow.accuracyM, distanceM: checkInRow.distanceM, minutesAfterStart: checkInRow.minutesAfterStart,
    lateMinutes: checkInRow.lateMinutes, graceMinutes: checkInRow.graceMinutes, source: checkInRow.source,
    exceptionReason: checkInRow.exceptionReason, deviceOnline: null,
    decidedBy: checkInRow.decidedBy?.name ?? null, decisionReason: checkInRow.decisionReason,
  } : null;
  // What an operator may still change on this shift, and whether it can be removed outright.
  const edit = editPolicy({ status: s.status, arrivalConfirmedAt: s.attendance?.arrivalConfirmedAt ?? null, arrivalSmsSentAt: s.arrivalSmsSentAt });
  const del = can.manageShifts(user) ? deletePolicy({ status: s.status, arrivalConfirmedAt: s.attendance?.arrivalConfirmedAt ?? null }, await shiftTraceCounts(s.id)) : { canDelete: false, reason: null };
  const VERIFY: Record<string, { label: string; tone: "ok" | "warn" | "muted" | "neutral" }> = { NOT_APPLICABLE: { label: androidGuard ? "Awaiting SMS confirmation and a GPS fix" : "Not applicable (feature phone)", tone: "neutral" }, VERIFIED: { label: "ARRIVAL VERIFIED · SMS + GPS inside", tone: "ok" }, EXCEPTION: { label: "LOCATION EXCEPTION · SMS yes, GPS outside", tone: "warn" }, UNAVAILABLE: { label: "Location unavailable at arrival", tone: "muted" } };

  return (
    <div>
      <PageHeader title={`${guardName} · ${s.location.name}`} description={`${fmtDate(s.startAt)} · ${fmtTime(s.startAt)}–${fmtTime(s.endAt)} · ${fmtDuration(s.durationMinutes)}`} actions={
        (live || (can.manageShifts(user) && del.canDelete)) && (
          <ButtonGroup>
            {live && <CallGuardButton guardId={s.guardId} guardName={guardName} shiftId={s.id} />}
            {live && <NotifyClientButton shiftId={s.id} />}
            {can.manageShifts(user) && live && edit.canEdit && <LinkButton href={`/shifts/${s.id}/edit`} size="md">Edit</LinkButton>}
            {can.manageShifts(user) && live && !s.attendance?.arrivalConfirmedAt && <ConfirmButton size="md" label="Confirm arrival manually" title="Confirm arrival manually?" body={`Record ${guardName} as on post now, for example after a phone call.`} withNote="How was this confirmed?" confirmLabel="Confirm arrival" action={async (note) => { "use server"; await manualArrival(s.id, note); }} />}
            {can.manageShifts(user) && live && s.attendance?.arrivalConfirmedAt && <ConfirmButton size="md" label="Mark completed" title="Mark this shift completed?" body="Use when the guard confirmed by phone or radio rather than SMS." withNote="Note" confirmLabel="Mark completed" action={async (note) => { "use server"; await manualComplete(s.id, note); }} />}
            {can.manageShifts(user) && live && <ConfirmButton size="md" label="Cancel shift" variant="danger" title="Cancel this shift?" body="The guard will no longer receive checks for it. This is recorded on the timeline." withNote="Reason" confirmLabel="Cancel shift" action={async (note) => { "use server"; await cancelShift(s.id, note); }} />}
            {can.manageShifts(user) && del.canDelete && <ConfirmButton size="md" label="Delete" variant="danger" title="Delete this shift?" body={DELETE_EXPLAINER} confirmLabel="Delete permanently" action={async () => { "use server"; await deleteShift(s.id); }} />}
          </ButtonGroup>
        )
      } />

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-4">
          {checkIn && <CheckInRow v={checkIn} />}
          {androidGuard && (
            <Card>
              <CardHeader title="Location" description={`Shift-aware monitoring from the guard's phone. ${exits} exit${exits === 1 ? "" : "s"}${outsideSeconds ? `, ${Math.round(outsideSeconds / 60)} min outside in total` : ""}. GPS is approximate; every point carries its accuracy.`} action={latestFix ? <span className="flex items-center gap-2"><Status tone={freshness(latestFix.occurredAt, new Date(), latestFix.syncStatus).tone}>{freshness(latestFix.occurredAt, new Date(), latestFix.syncStatus).label}</Status><Status tone={LOCATION_STATE_META[latestFix.locationState].tone}>{LOCATION_STATE_META[latestFix.locationState].label}</Status></span> : <Status tone="muted">No fix yet</Status>} />
              <CardBody>
                {fence ? (
                  <SiteMap site={{ lat: fence.fence.latitude, lng: fence.fence.longitude, radiusM: fence.fence.radiusM, name: fence.source === "SHIFT_OVERRIDE" ? `${s.location.name} (shift override)` : s.location.name }} points={locEvents.filter((e) => e.latitude != null).map((e) => ({ lat: e.latitude!, lng: e.longitude!, label: `${e.eventType.replace(/_/g, " ").toLowerCase()} · ${e.locationState.toLowerCase()}`, kind: e === latestFix ? ("latest" as const) : e.eventType === "LOCATION_EXIT" ? ("exit" as const) : e.eventType === "LOCATION_RETURNED" ? ("return" as const) : e.eventType === "LOCATION_CALL" ? ("call" as const) : ("check" as const), at: fmtDateTime(e.occurredAt), freshness: e.syncStatus === "SYNCED_LATE" ? "SYNCED LATE" : e === latestFix ? freshness(e.occurredAt).label : undefined }))} height={280} />
                ) : <p className="text-[13px] text-warn">{s.location.name} has no coordinates, so the phone cannot judge inside or outside. <Link href={`/locations/${s.locationId}/edit`} className="underline">Add them on the site</Link>.</p>}
                <p className="mt-3 text-[12.5px] text-ink-3 tnum">Fence in force: {fence ? <>{fence.source === "SHIFT_OVERRIDE" ? "shift override" : "site default"} · {fence.fence.latitude.toFixed(5)}, {fence.fence.longitude.toFixed(5)} · {fence.fence.radiusM} m · config v{s.location.configVersion}.{s.configVersion}{s.location.coordinatesSource === "TEST" && fence.source === "SITE" ? <> · <Status tone="warn">TEST coordinates</Status></> : null}{s.geofenceNote ? ` · ${s.geofenceNote}` : ""}</> : "none"}.</p>
                {latestFix && <p className="mt-3 text-[12.5px] text-ink-3">Latest fix {fmtDateTime(latestFix.occurredAt)} <SyncBadge s={latestFix.syncStatus} /> · {latestFix.distanceM != null ? `${Math.round(latestFix.distanceM)} m from the centre` : "distance unknown"}{latestFix.accuracyM != null ? ` · ±${Math.round(latestFix.accuracyM)} m` : ""}.</p>}
              </CardBody>
              <LocationEventList events={[...locEvents].reverse()} emptyTitle="No location events on this shift yet" />
            </Card>
          )}
          {live && can.manageShifts(user) && (
            <Card>
              <CardHeader title="Geofence for this shift" description={`Site default: ${s.location.latitude != null ? `${s.location.latitude.toFixed(5)}, ${s.location.longitude!.toFixed(5)} · ${s.location.geofenceRadiusM} m${s.location.coordinatesSource ? ` · ${COORDINATES_SOURCE_META[s.location.coordinatesSource].label.toLowerCase()}` : ""}` : "no coordinates"}. Changing this raises the shift's config version; the guard's phone applies it within one heartbeat.`} />
              <CardBody>
                <ActionForm action={updateShiftGeofence.bind(null, s.id)} submitLabel="Save geofence" successMessage="Geofence saved. The phone picks it up on its next heartbeat.">
                  <GeofenceOverrideSection initial={{ enabled: s.geofenceLatitude != null, lat: s.geofenceLatitude, lng: s.geofenceLongitude, radiusM: s.geofenceRadiusM, note: s.geofenceNote }} mapsKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY} siteRadius={s.location.geofenceRadiusM} siteName={s.location.name} />
                </ActionForm>
              </CardBody>
            </Card>
          )}
          <div id="attendance-evidence" className="scroll-mt-20">
            <Card className={pendingEvidence ? "border-warn/50" : ""}>
              <CardHeader title="Attendance evidence" description={pendingEvidence ? `${pendingEvidence} to confirm. Nothing pending is applied until someone confirms it.` : "Each clock-in, welfare check and clock-out, and where it came from. Calls and SMS are communication, not location."} />
              <CardBody className="pt-1"><EvidenceList rows={evidence} canDecide={can.manageShifts(user)} /></CardBody>
            </Card>
          </div>
          {scheduledChecks.length > 0 && (
            <Card>
              <CardHeader title="Welfare checks" description="Scheduled for this site. An answered call is not a response: only a key press, a reply or a person confirming settles a check." />
              <CardBody className="pt-1">
                <ul className="divide-y divide-line">
                  {scheduledChecks.map((w) => {
                    const st = welfareState(w);
                    return (
                      <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                        <span className="text-ink">Due {fmtTime(w.dueAt ?? w.sentAt)} <span className="text-ink-3">· {WELFARE_CHANNEL_LABEL[w.channel]}{w.attempts > 1 ? ` · ${w.attempts} tries` : ""}{w.smsFallbackAt ? " · then SMS" : ""}{w.provider === "simulated" ? " · simulated" : ""}</span></span>
                        <Status tone={st.tone}>{st.label}</Status>
                      </li>
                    );
                  })}
                </ul>
              </CardBody>
            </Card>
          )}
          {(networkChecks.length > 0 || networkPossible) && (
            <Card>
              <CardHeader
                title="Network location checks"
                description="From the guard's mobile network, not GPS. Approximate, and stored apart from the GPS history. Attendance does not wait for them."
                action={networkPossible && live && can.manageShifts(user) ? <ConfirmButton label="Check by network" title="Ask the mobile network?" body="One request to the guard's network, if consent, the shift window, the cooldown and the monthly limit allow it. The operator may charge for it." confirmLabel="Ask the network" action={async () => { "use server"; await requestNetworkCheck(s.id); }} /> : undefined}
              />
              <CardBody className="pt-1">
                {networkChecks.length === 0 ? <p className="py-2 text-sm text-ink-3">No network checks on this shift.</p> : (
                  <ul className="divide-y divide-line">
                    {networkChecks.map((c) => (
                      <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                        <span className="text-ink">{fmtTime(c.requestedAt)} <span className="text-ink-3">· {NETWORK_TRIGGER_LABEL[c.trigger]} · {c.requestSent ? c.provider : "not sent"}{c.areaRadiusM ? ` · ${c.areaRadiusM.toLocaleString("en-GB")} m area` : ""}{c.reason ? ` · ${c.reason}` : ""}</span></span>
                        <Status tone={c.simulated ? "muted" : NETWORK_RESULT_META[c.result].tone}>{c.simulated ? `Simulated · ${NETWORK_RESULT_META[c.result].label}` : NETWORK_RESULT_META[c.result].label}</Status>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Timeline" description="Every automated check, reply, call and location event on this shift, in order." action={<ShiftStatusLabel status={s.status} />} />
            <CardBody><Timeline events={s.checkIns} showDates={s.durationMinutes > 12 * 60} /></CardBody>
            {live && can.simulate(user) && (
              <div className="border-t border-dashed border-line px-5 py-4">
                <SimulatorInline guardId={s.guardId} guardName={guardName} pending={s.pendingPrompt} />
              </div>
            )}
            <div className="border-t border-line px-5 py-4">
              <form action={async (fd) => { "use server"; const n = String(fd.get("note") ?? "").trim(); if (n) await addShiftNote(s.id, n); }} className="flex gap-2">
                <input name="note" placeholder="Add a note to the timeline" className="h-9 min-w-0 flex-1 rounded-[8px] border border-line px-3 text-sm placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20" />
                <button className="h-9 whitespace-nowrap rounded-[8px] border border-line bg-surface px-3 text-[13px] font-medium hover:bg-surface-2">Add note</button>
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

        <div className="min-w-0 space-y-4">
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
                <Meta label="Welfare check">{hasSchedule({ times: s.location.welfareTimes, intervalMinutes: s.location.welfareIntervalMinutes }) ? (s.location.welfareTimes ? `At ${s.location.welfareTimes}` : `Every ${s.location.welfareIntervalMinutes} min`) : s.welfareSmsSentAt ? `Sent ${fmtTime(s.welfareSmsSentAt)}` : `Due ${fmtTime(midpoint)}`}</Meta>
                <Meta label="Missed checks">{s.attendance?.missedChecks ?? 0}</Meta>
                <Meta label="Awaiting reply">{s.pendingPrompt === "NONE" ? "Nothing" : s.pendingPrompt.toLowerCase().replace("_", " ")}</Meta>
                <Meta label="Status">{STATUS_META[s.status].label}</Meta>
                <Meta label="GPS verification" className="col-span-2"><Status tone={VERIFY[verification].tone}>{VERIFY[verification].label}</Status></Meta>
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

const WELFARE_CHANNEL_LABEL = { SMS: "SMS", VOICE: "automated call", GATEWAY_CALL: "operations phone" } as const;

/** A settled response wins over what the call did; an open check shows the call's state. */
function welfareState(w: { response: string; callStatus: keyof typeof WELFARE_CALL_LABEL | null; escalatedAt: Date | null }) {
  if (w.response === "WELL") return { label: "Well", tone: "ok" as const };
  if (w.response === "ASSISTANCE") return { label: "Needs assistance", tone: "warn" as const };
  if (w.response === "INCIDENT") return { label: "Emergency", tone: "critical" as const };
  if (w.response === "NO_RESPONSE") return { label: w.escalatedAt ? "No response · escalated" : "No response", tone: "critical" as const };
  return w.callStatus ? WELFARE_CALL_LABEL[w.callStatus] : { label: "Waiting for a reply", tone: "info" as const };
}
