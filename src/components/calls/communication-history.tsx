import Link from "next/link";
import { ChatTextIcon, PhoneIncomingIcon, PhoneOutgoingIcon, PhoneXIcon, PhoneDisconnectIcon, PhoneCallIcon, SirenIcon, CheckCircleIcon } from "@phosphor-icons/react/dist/ssr";
import type { GuardAlert } from "@prisma/client";
import { ALERT_META } from "@/lib/gateway/alerts";
import type { SmsMessage } from "@prisma/client";
import type { CallWithRelations } from "@/lib/gateway/calls";
import { fmtCallDuration } from "@/lib/gateway/call-state";
import { fmtDate, fmtTime } from "@/lib/time";
import { cn } from "@/lib/cn";

type Entry = { at: Date; kind: "SMS" | "CALL" | "APP"; icon: React.ElementType; tone: "ok" | "warn" | "critical" | "neutral" | "info"; title: string; detail?: string; href?: string };

/**
 * One list of every SMS and call with a guard, newest first. SMS comes from the existing
 * message log; calls from the gateway. Each call contributes its start and, when finished,
 * its end so the list reads like the operational story.
 */
export type AlertRow = GuardAlert & { acknowledgedBy?: { name: string } | null };

export function CommunicationHistory({ messages, calls, alerts = [] }: { messages: SmsMessage[]; calls: CallWithRelations[]; alerts?: AlertRow[] }) {
  const entries: Entry[] = [];
  for (const a of alerts) {
    const m = ALERT_META[a.type];
    entries.push({ at: a.occurredAt, kind: "APP", icon: SirenIcon, tone: m.tone === "info" || m.tone === "neutral" ? "info" : m.tone, title: `${m.label} sent from the app${a.syncStatus === "SYNCED_LATE" ? " (synced late)" : ""}`, detail: `${a.message ? `“${a.message}” · ` : ""}${a.latitude != null ? `${a.locationState === "INSIDE" ? "inside" : a.locationState === "OUTSIDE" ? "outside" : "position unverified"}${a.accuracyM != null ? ` ±${Math.round(a.accuracyM)} m` : ""}` : "no position"}`, href: `/alerts?focus=${a.id}` });
    if (a.acknowledgedAt) entries.push({ at: a.acknowledgedAt, kind: "APP", icon: CheckCircleIcon, tone: "ok", title: `${m.label} acknowledged by ${a.acknowledgedBy?.name ?? "operations"}`, detail: a.acknowledgementNote ?? undefined, href: `/alerts?focus=${a.id}` });
  }
  for (const m of messages) {
    entries.push({ at: m.createdAt, kind: "SMS", icon: ChatTextIcon, tone: m.direction === "INBOUND" ? "ok" : m.status === "FAILED" ? "critical" : "info", title: m.direction === "INBOUND" ? `${m.type === "GENERAL" ? "Message" : m.type.toLowerCase().replace(/_/g, " ")} received: “${m.body.slice(0, 80)}${m.body.length > 80 ? "…" : ""}”` : `${m.channel === "SMS" ? "SMS" : m.channel.toLowerCase()} sent${m.status === "FAILED" ? " (failed)" : ""}`, detail: m.direction === "OUTBOUND" ? m.body : undefined, href: `/sms?guardId=${m.guardId}` });
  }
  for (const c of calls) {
    const inc = c.direction === "INCOMING";
    entries.push({ at: c.startedAt, kind: "CALL", icon: inc ? PhoneIncomingIcon : PhoneOutgoingIcon, tone: c.status === "MISSED" ? "critical" : "info", title: `${inc ? "Incoming" : "Outgoing"} call · ${c.gateway.deviceName}${c.status === "MISSED" ? " · missed" : c.status === "RINGING" ? " · ringing" : ""}`, href: `/calls/${c.id}` });
    if (c.status === "ENDED" && c.endedAt) entries.push({ at: c.endedAt, kind: "CALL", icon: PhoneDisconnectIcon, tone: "neutral", title: `Call ended · ${fmtCallDuration(c.durationSeconds)}`, href: `/calls/${c.id}` });
    else if (c.status === "ANSWERED" && c.answeredAt) entries.push({ at: c.answeredAt, kind: "CALL", icon: PhoneCallIcon, tone: "ok", title: "Call answered · in progress", href: `/calls/${c.id}` });
    else if (c.status === "MISSED" && c.endedAt && c.endedAt.getTime() !== c.startedAt.getTime()) entries.push({ at: c.endedAt, kind: "CALL", icon: PhoneXIcon, tone: "critical", title: "Call not answered", href: `/calls/${c.id}` });
  }
  entries.sort((a, b) => b.at.getTime() - a.at.getTime());
  if (entries.length === 0) return <p className="py-6 text-center text-[13px] text-ink-3">No messages, calls or app alerts with this guard yet.</p>;
  const ring = { ok: "border-ok text-ok", warn: "border-warn text-warn", critical: "border-critical text-critical", neutral: "border-line-strong text-ink-3", info: "border-info text-info" };
  let lastDay = "";
  return (
    <ol className="relative ml-2 border-l border-line">
      {entries.map((e, i) => {
        const day = fmtDate(e.at);
        const showDay = day !== lastDay;
        lastDay = day;
        const Icon = e.icon;
        return (
          <li key={i} className="relative pb-4 pl-6 last:pb-0">
            {showDay && <div className="mb-2 -ml-6 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">{day}</div>}
            <span className={cn("absolute -left-[9px] flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 bg-surface", ring[e.tone])}><Icon size={10} weight="fill" /></span>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="text-[12px] tnum text-ink-3">{fmtTime(e.at)}</span>
              <span className={cn("rounded-[4px] px-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em]", e.kind === "SMS" ? "bg-surface-2 text-ink-2" : "bg-info-soft text-[#3a50ad]")}>{e.kind}</span>
              {e.href ? <Link href={e.href} className="text-[13px] font-medium text-ink hover:underline">{e.title}</Link> : <span className="text-[13px] font-medium text-ink">{e.title}</span>}
            </div>
            {e.detail && <p className="mt-0.5 max-w-xl text-[12.5px] text-ink-2">{e.detail}</p>}
          </li>
        );
      })}
    </ol>
  );
}
