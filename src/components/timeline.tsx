import type { CheckInType, ShiftCheckIn } from "@prisma/client";
import { CheckCircleIcon, ChatCircleDotsIcon, WarningOctagonIcon, SirenIcon, FirstAidIcon, ClockIcon, FlagIcon, XCircleIcon, NoteIcon, QuestionIcon, ArrowsLeftRightIcon, PaperPlaneTiltIcon, PhoneIncomingIcon, PhoneOutgoingIcon, PhoneCallIcon, PhoneXIcon, PhoneDisconnectIcon, MapPinIcon, MapPinLineIcon, CompassIcon, NavigationArrowIcon, CellSignalSlashIcon, ShieldCheckIcon, ShieldWarningIcon } from "@phosphor-icons/react/dist/ssr";
import { fmtTime, fmtDate } from "@/lib/time";
import { cn } from "@/lib/cn";

const META: Record<CheckInType, { label: string; tone: "ok" | "warn" | "critical" | "neutral" | "info"; icon: React.ElementType }> = {
  SHIFT_STARTED: { label: "Shift started", tone: "neutral", icon: FlagIcon },
  ARRIVAL_SMS_SENT: { label: "Arrival check sent", tone: "info", icon: PaperPlaneTiltIcon },
  ARRIVAL_REMINDER_SENT: { label: "Arrival reminder sent", tone: "warn", icon: PaperPlaneTiltIcon },
  ARRIVAL_CONFIRMED: { label: "Guard confirmed arrival", tone: "ok", icon: CheckCircleIcon },
  ARRIVAL_DENIED: { label: "Guard replied NO", tone: "critical", icon: XCircleIcon },
  ARRIVAL_ESCALATED: { label: "Attendance not confirmed", tone: "critical", icon: WarningOctagonIcon },
  WELFARE_SMS_SENT: { label: "Welfare check sent", tone: "info", icon: PaperPlaneTiltIcon },
  WELFARE_OK: { label: "Shift going well", tone: "ok", icon: CheckCircleIcon },
  WELFARE_ASSISTANCE: { label: "Assistance requested", tone: "warn", icon: FirstAidIcon },
  WELFARE_INCIDENT: { label: "Incident flagged", tone: "critical", icon: WarningOctagonIcon },
  WELFARE_MISSED: { label: "Welfare check missed", tone: "warn", icon: ClockIcon },
  INCIDENT_REPORTED: { label: "Incident reported", tone: "critical", icon: WarningOctagonIcon },
  EMERGENCY: { label: "EMERGENCY", tone: "critical", icon: SirenIcon },
  HANDOVER_NOTICE: { label: "Handover notice", tone: "neutral", icon: ArrowsLeftRightIcon },
  COMPLETION_SMS_SENT: { label: "End-of-shift check sent", tone: "info", icon: PaperPlaneTiltIcon },
  COMPLETION_CONFIRMED: { label: "Completion confirmed", tone: "ok", icon: CheckCircleIcon },
  COMPLETION_DENIED: { label: "Still on duty", tone: "warn", icon: ClockIcon },
  COMPLETION_TIMEOUT: { label: "No completion reply", tone: "warn", icon: ClockIcon },
  SHIFT_COMPLETED: { label: "Shift completed", tone: "ok", icon: FlagIcon },
  SHIFT_MISSED: { label: "Shift missed", tone: "critical", icon: XCircleIcon },
  SHIFT_CANCELLED: { label: "Shift cancelled", tone: "neutral", icon: XCircleIcon },
  ADMIN_NOTE: { label: "Note", tone: "neutral", icon: NoteIcon },
  CLIENT_NOTIFIED: { label: "Client updated", tone: "ok", icon: NoteIcon },
  UNRECOGNISED_REPLY: { label: "Reply not understood", tone: "warn", icon: QuestionIcon },
  CALL_INCOMING: { label: "Incoming call from guard", tone: "info", icon: PhoneIncomingIcon },
  CALL_OUTGOING: { label: "Outgoing call to guard", tone: "info", icon: PhoneOutgoingIcon },
  CALL_ANSWERED: { label: "Call answered", tone: "ok", icon: PhoneCallIcon },
  CALL_ENDED: { label: "Call ended", tone: "neutral", icon: PhoneDisconnectIcon },
  CALL_MISSED: { label: "Missed call from guard", tone: "critical", icon: PhoneXIcon },
  LOCATION_VERIFIED: { label: "Arrival verified by GPS", tone: "ok", icon: ShieldCheckIcon },
  LOCATION_EXCEPTION: { label: "Location exception", tone: "warn", icon: ShieldWarningIcon },
  LOCATION_INSIDE: { label: "Location check · inside", tone: "ok", icon: MapPinIcon },
  LOCATION_EXIT: { label: "LOCATION EXIT", tone: "critical", icon: NavigationArrowIcon },
  LOCATION_OUTSIDE: { label: "Still outside the site", tone: "critical", icon: MapPinLineIcon },
  LOCATION_RETURNED: { label: "LOCATION RETURNED", tone: "ok", icon: CompassIcon },
  LOCATION_UNAVAILABLE: { label: "Location unavailable", tone: "warn", icon: CellSignalSlashIcon },
  LOCATION_OVERDUE: { label: "Location verification overdue", tone: "warn", icon: CellSignalSlashIcon },
};
const ring = { ok: "border-ok text-ok", warn: "border-warn text-warn", critical: "border-critical text-critical", neutral: "border-line-strong text-ink-3", info: "border-info text-info" };

type Event = ShiftCheckIn & { smsMessage?: { body: string; direction: string } | null };

export function Timeline({ events, showDates }: { events: Event[]; showDates?: boolean }) {
  if (events.length === 0) return <p className="py-6 text-center text-[13px] text-ink-3">Nothing has happened on this shift yet.</p>;
  return (
    <ol className="relative ml-2 border-l border-line">
      {events.map((e) => {
        const m = META[e.type];
        const Icon = m.icon;
        return (
          <li key={e.id} className="relative pb-5 pl-7 last:pb-0">
            <span className={cn("absolute -left-[11px] top-0 flex h-[22px] w-[22px] items-center justify-center rounded-full border-[1.5px] bg-surface", ring[m.tone])}><Icon size={12} weight="fill" /></span>
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="text-[12px] font-medium text-ink-3 tnum">{showDates ? `${fmtDate(e.at)} ` : ""}{fmtTime(e.at)}</span>
              <span className={cn("text-[14px] font-medium", m.tone === "critical" ? "text-critical" : "text-ink")}>{m.label}</span>
              {e.source === "SMS" && <ChatCircleDotsIcon size={13} weight="fill" className="text-ink-3" aria-label="via SMS" />}
              {e.source === "ADMIN" && <span className="text-[11px] uppercase tracking-[0.06em] text-ink-3">admin</span>}
            </div>
            {e.note && <p className="mt-0.5 text-[13px] text-ink-2">{e.note}</p>}
            {e.smsMessage && (
              <p className={cn("mt-1.5 inline-block max-w-xl rounded-[10px] px-3 py-2 text-[13px]", e.smsMessage.direction === "INBOUND" ? "bg-accent-soft text-ink" : "bg-surface-2 text-ink-2")}>{e.smsMessage.body}</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
