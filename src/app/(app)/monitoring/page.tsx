import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { requireUser, can } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { shiftInclude, LIVE_STATUSES, STATUS_META } from "@/lib/services/shifts";
import { PageHeader } from "@/components/ui/page";
import { Card, CardBody } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Status } from "@/components/ui/status";
import { LinkButton } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { ShiftStatusLabel } from "@/components/shift-status";
import { Timeline } from "@/components/timeline";
import { AutoRefresh } from "@/components/auto-refresh";
import { setGuardWatched } from "@/actions/messages";
import { fmtTime, fmtDate, ago } from "@/lib/time";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/cn";

export const metadata = { title: "Monitoring" };

export default async function MonitoringPage() {
  const user = await requireUser();
  const guards = await db.guard.findMany({ where: { watched: true }, include: { homeLocation: true, supervisor: true }, orderBy: { watchedAt: "desc" } });
  const ids = guards.map((g) => g.id);
  const [live, lastMsgs, lastShifts, events] = await Promise.all([
    db.shift.findMany({ where: { guardId: { in: ids }, status: { in: LIVE_STATUSES } }, include: shiftInclude }),
    db.smsMessage.findMany({ where: { guardId: { in: ids } }, orderBy: { createdAt: "desc" }, distinct: ["guardId"] }),
    db.shift.findMany({ where: { guardId: { in: ids }, status: { notIn: ["CANCELLED"] } }, orderBy: { startAt: "desc" }, distinct: ["guardId"], include: shiftInclude }),
    db.shiftCheckIn.findMany({ where: { guardId: { in: ids } }, include: { smsMessage: { select: { body: true, direction: true } } }, orderBy: [{ at: "desc" }], take: 200 }),
  ]);
  const watchers = await db.user.findMany({ where: { id: { in: guards.map((g) => g.watchedById).filter((x): x is string => Boolean(x)) } } });

  return (
    <div>
      <AutoRefresh seconds={30} />
      <PageHeader title="Monitoring" description="Every event for these guards is highlighted here and pushed to your devices." actions={can.sendSms(user) && guards.length > 0 && <LinkButton href="/messages/new" variant="primary">Message watched guards</LinkButton>} />
      {guards.length === 0 ? (
        <Card><CardBody className="flex flex-col items-center py-14 text-center"><span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-ink-3"><Icon name="visibility" size={20} filled /></span><p className="text-[14px] font-medium text-ink">Nobody is being watched</p><p className="mt-1 max-w-md text-[13px] text-ink-2">Open a guard and choose Watch to pin them here. Use it for a new recruit, a guard on a warning, or a sensitive site.</p><LinkButton href="/guards" className="mt-4" size="sm">Go to guards</LinkButton></CardBody></Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {guards.map((g) => {
            const shift = live.find((s) => s.guardId === g.id) ?? null;
            const last = lastShifts.find((s) => s.guardId === g.id) ?? null;
            const msg = lastMsgs.find((m) => m.guardId === g.id) ?? null;
            const ev = events.filter((e) => e.guardId === g.id).slice(0, 6).reverse();
            const name = `${g.firstName} ${g.lastName}`;
            const tone = shift ? STATUS_META[shift.status].tone : "neutral";
            return (
              <Card key={g.id} className={cn(shift?.status === "CRITICAL" && "border-critical")}>
                <CardBody className="pt-5">
                  <div className="flex items-start gap-3">
                    <Avatar src={g.photoUrl} name={name} size={48} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <Link href={`/guards/${g.id}`} className="text-[16px] font-semibold text-ink hover:underline">{name}</Link>
                        {shift ? <ShiftStatusLabel status={shift.status} /> : <Status tone="neutral">Off duty</Status>}
                      </div>
                      <p className="text-[13px] text-ink-2">{g.guardNo} · <a href={`tel:${g.phone}`} className="underline">{formatPhone(g.phone)}</a>{g.homeLocation ? ` · ${g.homeLocation.name}` : ""}</p>
                      {g.watchNote && <p className="mt-1 text-[13px] text-ink">{g.watchNote}</p>}
                      <p className="mt-0.5 text-[12px] text-ink-3">Watched since {fmtDate(g.watchedAt)} by {watchers.find((w) => w.id === g.watchedById)?.name ?? "—"}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <LinkButton href={`/messages/new?guardId=${g.id}`} size="sm">Message</LinkButton>
                      {can.manageGuards(user) && <ConfirmButton label="Stop watching" title={`Stop watching ${name}?`} body="Their events return to normal priority." confirmLabel="Stop watching" action={async () => { "use server"; await setGuardWatched(g.id, false); }} />}
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 rounded-[12px] bg-surface-2 p-3 text-[13px] sm:grid-cols-4">
                    <div><div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">Current shift</div><div className="mt-0.5 text-ink">{shift ? <Link href={`/shifts/${shift.id}`} className="hover:underline">{shift.location.name} · {fmtTime(shift.startAt)}–{fmtTime(shift.endAt)}</Link> : last ? `Last: ${fmtDate(last.startAt)} ${last.location.name}` : "None"}</div></div>
                    <div><div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">Arrival</div><div className="mt-0.5"><Status tone={shift?.attendance?.arrivalConfirmedAt ? "ok" : shift ? "critical" : "muted"}>{shift?.attendance?.arrivalConfirmedAt ? fmtTime(shift.attendance.arrivalConfirmedAt) : shift ? "Not confirmed" : "—"}</Status></div></div>
                    <div><div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">Awaiting reply</div><div className="mt-0.5 text-ink">{shift && shift.pendingPrompt !== "NONE" ? shift.pendingPrompt.toLowerCase().replace("_", " ") : "Nothing"}</div></div>
                    <div><div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">Last message</div><div className="mt-0.5 truncate text-ink" title={msg?.body}>{msg ? `${msg.direction === "INBOUND" ? "Guard: " : ""}${msg.body.slice(0, 40)}${msg.body.length > 40 ? "…" : ""}` : "—"}</div><div className="text-[11px] text-ink-3">{msg ? ago(msg.createdAt) : ""}</div></div>
                  </div>

                  <div className="mt-4">
                    <div className="mb-2 flex items-center justify-between"><span className={cn("text-[11px] font-semibold uppercase tracking-[0.06em]", tone === "critical" ? "text-critical" : "text-ink-3")}>Recent activity</span>{shift && <Link href={`/shifts/${shift.id}`} className="inline-flex items-center gap-1 text-[12px] font-medium text-accent-strong hover:underline">Full timeline <Icon name="chevron_right" size={11} filled /></Link>}</div>
                    <Timeline events={ev} showDates />
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
