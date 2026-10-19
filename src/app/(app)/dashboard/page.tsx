import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { requireUser } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { todayOverview, dailySeries, activityTrend, attendanceRate, needsAttention } from "@/lib/services/dashboard";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { Gauge } from "@/components/dashboard/gauge";
import { SendMessage } from "@/components/dashboard/send-message";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Status } from "@/components/ui/status";
import { STATUS_META, ON_SITE_STATUSES } from "@/lib/services/shifts";
import { fmtTime } from "@/lib/time";
import { subDays } from "date-fns";
import { liveCalls, callInclude } from "@/lib/gateway/calls";
import { LiveCallCards } from "@/components/calls/live-calls";
import { getSettingNumber } from "@/lib/settings";
import { effectiveStatus } from "@/lib/gateway/service";
import { cn } from "@/lib/cn";
import { ALERT_META, alertInclude } from "@/lib/gateway/alerts";
import { ago } from "@/lib/time";

export const metadata = { title: "Overview" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const range = (["12h", "24h", "7d"].includes(sp.range ?? "") ? sp.range : "12h") as "12h" | "24h" | "7d";
  const [o, series, trend, rate, attention, onDutyGuards, live, missedCalls, gateways, offlineMinutes] = await Promise.all([
    todayOverview(), dailySeries(), activityTrend(range), attendanceRate(), needsAttention(),
    db.shift.findMany({ where: { status: { in: [...ON_SITE_STATUSES, "LATE", "NOT_CONFIRMED", "AWAITING_ARRIVAL"] } }, include: { guard: true }, orderBy: { guard: { lastName: "asc" } } }),
    liveCalls(),
    db.callLog.findMany({ where: { status: "MISSED", direction: "INCOMING", note: null, guardId: { not: null }, startedAt: { gte: subDays(new Date(), 1) } }, include: callInclude, orderBy: { startedAt: "desc" }, take: 6 }),
    db.gatewayDevice.findMany({ where: { status: { notIn: ["REVOKED"] } }, select: { id: true, deviceName: true, status: true, lastSeenAt: true, activationStatus: true } }),
    getSettingNumber("gateway.offlineMinutes"),
  ]);
  const openAlerts = await db.guardAlert.findMany({ where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } }, include: alertInclude, orderBy: [{ status: "asc" }, { occurredAt: "desc" }], take: 6 });
  const gatewayOnline = gateways.filter((g) => effectiveStatus(g, offlineMinutes) === "ONLINE").length;
  const showCalls = gateways.length > 0 || live.length > 0 || missedCalls.length > 0;
  const last = (a: number[]) => a[a.length - 1] - a[a.length - 2];
  const posture = rate.pct >= 85 ? { word: "Strong", tone: "ok" as const, line: "Guards are reporting for duty on time." } : rate.pct >= 60 ? { word: "Watch", tone: "warn" as const, line: "Several guards have not confirmed arrival." } : { word: "Weak", tone: "critical" as const, line: "Attendance is well below target. Call the sites." };

  const icon = (s: string) => s === "CRITICAL" ? "e911_emergency" : s === "ASSISTANCE" ? "medical_services" : s === "INCIDENT" ? "report" : s === "NOT_CONFIRMED" ? "person_off" : "timer";

  return (
    <div className="min-w-0 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Guards on duty" description={`Confirmed on post right now across ${o.activeShifts} active shifts.`} value={o.onDuty} delta={last(series.onDuty)} series={series.onDuty} tone="ok" />
        <KpiCard title="Not reported" description="Shifts in the last 24 hours with no arrival confirmed after escalation." value={o.notReported} delta={last(series.notReported)} deltaGoodWhen="down" series={series.notReported} tone={o.notReported > 0 ? "critical" : "neutral"} />
        <KpiCard title="Open incidents" description={`Incidents awaiting resolution, plus ${o.assistance} assistance request${o.assistance === 1 ? "" : "s"}.`} value={o.incidents} delta={last(series.incidents)} deltaGoodWhen="down" series={series.incidents} tone={o.incidents > 0 ? "critical" : "neutral"} />
        <KpiCard title="Completed today" description={`Shifts confirmed complete since midnight. ${o.scheduledToday} scheduled today.`} value={o.completedToday} delta={last(series.completed)} series={series.completed} tone="ok" />
      </div>

      {openAlerts.length > 0 && (
        <Card className="border-critical/40">
          <CardHeader title={<><Icon name="e911_emergency" className="mr-1 inline h-4 w-4 text-critical" filled />Guard alerts from phones · {openAlerts.length} open</>} description="Sent through the guard app. Acknowledge so the guard sees who is handling it." action={<Link href="/alerts" className="text-[13px] font-medium text-accent hover:underline">Open alerts <Icon name="chevron_right" className="inline h-3 w-3" /></Link>} />
          <CardBody className="pt-2">
            <ul className="divide-y divide-line">
              {openAlerts.map((a) => { const m = ALERT_META[a.type]; return (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0"><Link href={`/alerts?focus=${a.id}`} className="font-medium text-ink hover:underline"><Status tone={m.tone === "info" || m.tone === "neutral" ? "neutral" : m.tone}>{m.label}</Status> · {a.guard.firstName} {a.guard.lastName}{a.location ? ` · ${a.location.name}` : ""}</Link>{a.message && <p className="truncate text-[12.5px] text-ink-2">“{a.message}”</p>}</div>
                  <span className="whitespace-nowrap text-[12px] text-ink-3">{ago(a.occurredAt)}{a.status === "ACKNOWLEDGED" ? " · acknowledged" : ""}</span>
                </li>
              ); })}
            </ul>
          </CardBody>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader
            title="Operations activity"
            description="Automated checks sent, replies received and confirmations, by hour."
            action={
              <div className="inline-flex rounded-[var(--radius-control)] border border-line bg-surface p-0.5">
                {(["12h", "24h", "7d"] as const).map((r) => (
                  <Link key={r} href={`/dashboard?range=${r}`} className={cn("h-7 rounded-[6px] px-2.5 text-[12.5px] font-medium leading-7", range === r ? "bg-surface-2 text-ink" : "text-ink-2 hover:text-ink")}>{r === "7d" ? "Last 7 days" : `Last ${r.replace("h", " hours")}`}</Link>
                ))}
              </div>
            }
          />
          <CardBody><TrendChart data={trend} /></CardBody>
        </Card>

        <Card>
          <CardHeader title={<>Attendance rate · {rate.pct}</>} description="Shifts started in the last 24 hours with arrival confirmed." />
          <CardBody className="flex flex-col items-center">
            <Gauge value={rate.pct} />
            <div className="mt-2 flex w-full items-end justify-between">
              <span className="text-[22px] font-semibold text-ink">{posture.word}</span>
              <span className={cn("text-[13px] font-medium tnum", rate.delta > 0 ? "text-ok" : rate.delta < 0 ? "text-critical" : "text-ink-3")}>{rate.delta > 0 ? "↑" : rate.delta < 0 ? "↓" : ""} {Math.abs(rate.delta)} pts <span className="font-normal text-ink-3">vs last 7 days</span></span>
            </div>
            <p className="mt-1 w-full text-[13px] text-ink-2">{posture.line} {rate.arrived} of {rate.started} arrived, {rate.onTime} on time.</p>
          </CardBody>
        </Card>
      </div>

      {showCalls && (
        <Card className={missedCalls.some((c) => c.shiftId) ? "border-critical" : ""}>
          <CardHeader title={missedCalls.some((c) => c.shiftId) ? "Active guard missed call" : "Calls"} description={`${gatewayOnline} of ${gateways.length} gateway phone${gateways.length === 1 ? "" : "s"} online. Ringing and in-progress calls, then missed calls from the last 24 hours that nobody has handled.`} action={<Link href="/calls" className="inline-flex items-center gap-1 text-[13px] font-medium text-accent-strong hover:underline">All calls <Icon name="chevron_right" size={12} filled /></Link>} />
          <CardBody className="pt-3"><LiveCallCards live={live} missed={missedCalls} /></CardBody>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_480px]">
        <Card>
          <CardHeader title="Needs attention" action={<Link href="/operations" className="inline-flex items-center gap-1 text-[13px] font-medium text-accent-strong hover:underline">View all <Icon name="chevron_right" size={12} filled /></Link>} />
          <CardBody className="pt-3">
            {attention.length === 0 ? (
              <div className="flex items-center gap-3 rounded-[12px] border border-dashed border-line px-4 py-6 text-[13px] text-ink-2"><span className="h-2 w-2 rounded-full bg-ok" />Every live shift is in order. Nothing needs you right now.</div>
            ) : (
              <ul className="divide-y divide-line">
                {attention.map((s) => {
                  const meta = STATUS_META[s.status];
                  return (
                    <li key={s.id}>
                      <Link href={`/shifts/${s.id}`} className="flex items-center gap-4 py-3.5 hover:bg-surface-2/60 -mx-2 px-2 rounded-[10px]">
                        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-line", s.status === "CRITICAL" ? "bg-critical-soft text-critical" : "bg-surface text-ink-2")}><Icon name={icon(s.status)} size={18} filled /></span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] font-medium text-ink">{s.guard.firstName} {s.guard.lastName} · {s.location.name}</p>
                          <p className="truncate text-[13px] text-ink-2">{fmtTime(s.startAt)}–{fmtTime(s.endAt)} · {s.attendance?.arrivalConfirmedAt ? `arrived ${fmtTime(s.attendance.arrivalConfirmedAt)}` : "arrival not confirmed"}</p>
                        </div>
                        <Status tone={meta.tone} pulse={s.status === "CRITICAL"}>{meta.label}</Status>
                        <Icon name="chevron_right" size={14} className="text-ink-3" filled />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="mt-3 flex items-center gap-2 border-t border-dashed border-line pt-3 text-[12.5px] text-ink-3">
              <Icon name="calendar_today" size={14} filled /> {o.scheduledToday} shifts scheduled today · {o.late} late · {o.missedChecks} missed welfare check{o.missedChecks === 1 ? "" : "s"} · {o.totalGuards} active guards
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Send a message" description={`Signed as ${user.name}`} action={<Link href="/messages/new" className="inline-flex items-center gap-1 text-[13px] font-medium text-accent-strong hover:underline">Compose · groups, WhatsApp, email <Icon name="chevron_right" size={12} filled /></Link>} />
          <CardBody>
            <SendMessage guards={onDutyGuards.map((s) => ({ id: s.guardId, name: `${s.guard.firstName} ${s.guard.lastName}`, status: STATUS_META[s.status].label }))} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
