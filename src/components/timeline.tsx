import type { CheckInType, ShiftCheckIn } from "@prisma/client";
import { Icon, type IconName } from "@/components/ui/icon";
import { fmtTime, fmtDate } from "@/lib/time";
import { cn } from "@/lib/cn";

const META: Record<CheckInType, { label: string; tone: "ok" | "warn" | "critical" | "neutral" | "info"; icon: IconName }> = {
  SHIFT_STARTED: { label: "Shift started", tone: "neutral", icon: "flag" },
  ARRIVAL_SMS_SENT: { label: "Arrival check sent", tone: "info", icon: "send" },
  ARRIVAL_REMINDER_SENT: { label: "Arrival reminder sent", tone: "warn", icon: "send" },
  ARRIVAL_CONFIRMED: { label: "Guard confirmed arrival", tone: "ok", icon: "check_circle" },
  ARRIVAL_DENIED: { label: "Guard replied NO", tone: "critical", icon: "cancel" },
  ARRIVAL_ESCALATED: { label: "Attendance not confirmed", tone: "critical", icon: "report" },
  WELFARE_SMS_SENT: { label: "Welfare check sent", tone: "info", icon: "send" },
  WELFARE_OK: { label: "Shift going well", tone: "ok", icon: "check_circle" },
  WELFARE_ASSISTANCE: { label: "Assistance requested", tone: "warn", icon: "medical_services" },
  WELFARE_INCIDENT: { label: "Incident flagged", tone: "critical", icon: "report" },
  WELFARE_MISSED: { label: "Welfare check missed", tone: "warn", icon: "schedule" },
  INCIDENT_REPORTED: { label: "Incident reported", tone: "critical", icon: "report" },
  EMERGENCY: { label: "EMERGENCY", tone: "critical", icon: "e911_emergency" },
  HANDOVER_NOTICE: { label: "Handover notice", tone: "neutral", icon: "swap_horiz" },
  COMPLETION_SMS_SENT: { label: "End-of-shift check sent", tone: "info", icon: "send" },
  COMPLETION_CONFIRMED: { label: "Completion confirmed", tone: "ok", icon: "check_circle" },
  COMPLETION_DENIED: { label: "Still on duty", tone: "warn", icon: "schedule" },
  COMPLETION_TIMEOUT: { label: "No completion reply", tone: "warn", icon: "schedule" },
  SHIFT_COMPLETED: { label: "Shift completed", tone: "ok", icon: "flag" },
  SHIFT_MISSED: { label: "Shift missed", tone: "critical", icon: "cancel" },
  SHIFT_CANCELLED: { label: "Shift cancelled", tone: "neutral", icon: "cancel" },
  ADMIN_NOTE: { label: "Note", tone: "neutral", icon: "sticky_note_2" },
  CLIENT_NOTIFIED: { label: "Client updated", tone: "ok", icon: "sticky_note_2" },
  UNRECOGNISED_REPLY: { label: "Reply not understood", tone: "warn", icon: "help" },
  SECURITY_ALERT: { label: "Security alert (app)", tone: "critical", icon: "report" },
  RUNNING_LATE: { label: "Running late (app)", tone: "warn", icon: "schedule" },
  STATUS_UPDATE: { label: "Status update (app)", tone: "info", icon: "chat" },
  GUARD_OK: { label: "Shift going well (app)", tone: "ok", icon: "check_circle" },
  ALERT_ACKNOWLEDGED: { label: "Alert acknowledged", tone: "ok", icon: "check_circle" },
  CALL_INCOMING: { label: "Incoming call from guard", tone: "info", icon: "phone_callback" },
  CALL_OUTGOING: { label: "Outgoing call to guard", tone: "info", icon: "phone_forwarded" },
  CALL_ANSWERED: { label: "Call answered", tone: "ok", icon: "phone_in_talk" },
  CALL_ENDED: { label: "Call ended", tone: "neutral", icon: "call_end" },
  CALL_MISSED: { label: "Missed call from guard", tone: "critical", icon: "phone_missed" },
  LOCATION_VERIFIED: { label: "Arrival verified by GPS", tone: "ok", icon: "verified_user" },
  LOCATION_EXCEPTION: { label: "Location exception", tone: "warn", icon: "gpp_maybe" },
  LOCATION_INSIDE: { label: "Location check · inside", tone: "ok", icon: "location_on" },
  LOCATION_EXIT: { label: "LOCATION EXIT", tone: "critical", icon: "directions_run" },
  LOCATION_OUTSIDE: { label: "Still outside the site", tone: "critical", icon: "wrong_location" },
  LOCATION_RETURNED: { label: "LOCATION RETURNED", tone: "ok", icon: "where_to_vote" },
  LOCATION_UNAVAILABLE: { label: "Location unavailable", tone: "warn", icon: "signal_cellular_off" },
  LOCATION_OVERDUE: { label: "Location verification overdue", tone: "warn", icon: "signal_cellular_off" },
};
const ring = { ok: "border-ok text-ok", warn: "border-warn text-warn", critical: "border-critical text-critical", neutral: "border-line-strong text-ink-3", info: "border-info text-info" };

type Event = ShiftCheckIn & { smsMessage?: { body: string; direction: string } | null };

export function Timeline({ events, showDates }: { events: Event[]; showDates?: boolean }) {
  if (events.length === 0) return <p className="py-6 text-center text-[13px] text-ink-3">Nothing has happened on this shift yet.</p>;
  return (
    <ol className="relative ml-2 border-l border-line">
      {events.map((e) => {
        const m = META[e.type];
        return (
          <li key={e.id} className="relative pb-5 pl-7 last:pb-0">
            <span className={cn("absolute -left-[11px] top-0 flex h-[22px] w-[22px] items-center justify-center rounded-full border-[1.5px] bg-surface", ring[m.tone])}><Icon name={m.icon} size={12} filled /></span>
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="text-[12px] font-medium text-ink-3 tnum">{showDates ? `${fmtDate(e.at)} ` : ""}{fmtTime(e.at)}</span>
              <span className={cn("text-[14px] font-medium", m.tone === "critical" ? "text-critical" : "text-ink")}>{m.label}</span>
              {e.source === "SMS" && <Icon name="chat" size={13} className="text-ink-3" aria-label="via SMS" filled />}
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
