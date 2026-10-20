import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import type { CallWithRelations } from "@/lib/gateway/calls";
import { CALL_STATUS_META, fmtCallDuration } from "@/lib/gateway/call-state";
import { Status } from "@/components/ui/status";
import { fmtTime } from "@/lib/time";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/cn";

function elapsed(from: Date, now: Date) {
  return fmtCallDuration(Math.max(0, Math.round((now.getTime() - from.getTime()) / 1000)));
}

/** The big live cards: ringing and in-progress calls, then missed calls that nobody has handled. */
export function LiveCallCards({ live, missed, now = new Date() }: { live: CallWithRelations[]; missed: CallWithRelations[]; now?: Date }) {
  if (live.length === 0 && missed.length === 0) {
    return <div className="flex items-center gap-3 rounded-[12px] border border-dashed border-line px-4 py-6 text-[13px] text-ink-2"><span className="h-2 w-2 rounded-full bg-ok" />No calls in progress and no unhandled missed calls.</div>;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {live.map((c) => {
        const ringing = c.status === "RINGING";
        return (
          <Link key={c.id} href={`/calls/${c.id}`} className={cn("block rounded-[14px] border p-4 transition-colors hover:bg-surface-2/60", ringing ? "border-info/50 bg-info-soft/40" : "border-ok/50 bg-ok-soft/40")}>
            <div className="flex items-center justify-between gap-2"><span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3"><Icon name="phone_callback" size={14} filled />{c.direction === "INCOMING" ? "Incoming call" : "Outgoing call"}</span><Status tone={ringing ? "info" : "ok"} pulse>{ringing ? (c.direction === "INCOMING" ? "Ringing" : "Dialling") : "Answered"}</Status></div>
            <p className="mt-3 text-[18px] font-semibold text-ink">{c.guard ? `${c.guard.firstName} ${c.guard.lastName}` : "Unknown caller"}</p>
            <p className="text-[13px] text-ink-2 tnum">{formatPhone(c.normalizedPhoneNumber)}</p>
            <p className="mt-2 text-[13px] text-ink-2">{c.location?.name ?? c.gateway.deviceName}</p>
            <div className="mt-3 flex items-center justify-between text-[13px] tnum"><span className="text-ink-3">{fmtTime(c.startedAt)}</span><span className="font-medium text-ink">{ringing ? `ringing ${elapsed(c.startedAt, now)}` : elapsed(c.answeredAt ?? c.startedAt, now)}</span></div>
          </Link>
        );
      })}
      {missed.map((c) => (
        <Link key={c.id} href={`/calls/${c.id}`} className={cn("block rounded-[14px] border p-4 transition-colors hover:bg-surface-2/60", c.shiftId ? "border-critical/50 bg-critical-soft/40" : "border-warn/50 bg-warn-soft/30")}>
          <div className="flex items-center justify-between gap-2"><span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">{c.unknownCaller ? <Icon name="warning" size={14} filled /> : <Icon name="phone_missed" size={14} filled />}{c.shiftId ? "Active guard missed call" : c.unknownCaller ? "Unknown caller" : "Missed call"}</span><Status tone={CALL_STATUS_META[c.status].tone}>{CALL_STATUS_META[c.status].label}</Status></div>
          <p className="mt-3 text-[18px] font-semibold text-ink">{c.guard ? `${c.guard.firstName} ${c.guard.lastName}` : "Unknown caller"}</p>
          <p className="text-[13px] text-ink-2 tnum">{formatPhone(c.normalizedPhoneNumber)}</p>
          <p className="mt-2 text-[13px] text-ink-2">{c.location?.name ?? c.gateway.deviceName}{c.shift ? ` · on shift ${fmtTime(c.shift.startAt)}–${fmtTime(c.shift.endAt)}` : ""}</p>
          <div className="mt-3 flex items-center justify-between text-[13px] tnum"><span className="text-ink-3">{fmtTime(c.startedAt)}</span>{c.guard && <span className="font-medium text-accent-strong">Call back →</span>}</div>
        </Link>
      ))}
    </div>
  );
}
