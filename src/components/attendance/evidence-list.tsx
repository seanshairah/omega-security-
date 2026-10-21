import type { AttendanceEvidence, GatewayDevice, User } from "@prisma/client";
import { Status } from "@/components/ui/status";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Icon, type IconName } from "@/components/ui/icon";
import { evidenceLabel, FLAG_LABEL, KIND_LABEL, IS_LOCATION_EVIDENCE } from "@/lib/attendance/evidence";
import { decideAttendanceEvidence } from "@/actions/attendance-evidence";
import { fmtTime, fmtShort } from "@/lib/time";

type Row = AttendanceEvidence & { decidedBy?: Pick<User, "name"> | null; gateway?: Pick<GatewayDevice, "deviceName"> | null };

const ICON: Record<AttendanceEvidence["source"], IconName> = { CALL: "call", MISSED_CALL: "phone_missed", SMS: "sms", GPS: "my_location", NETWORK: "cell_tower", IVR: "dialpad", MANUAL: "person" };

/**
 * Every piece of attendance evidence on a shift, each labelled with where it came from. A call is
 * "Call confirmed", never "verified"; only GPS and network checks speak about location, and only
 * they say so.
 */
export function EvidenceList({ rows, canDecide }: { rows: Row[]; canDecide: boolean }) {
  if (!rows.length) return <p className="text-[13px] text-ink-3">No attendance evidence yet. Clock-ins by call, SMS replies, GPS checks and supervisors&apos; decisions appear here.</p>;
  return (
    <ul className="divide-y divide-line">
      {rows.map((e) => {
        const l = evidenceLabel(e);
        const open = e.status === "PENDING" || e.status === "PROVISIONAL";
        return (
          <li key={e.id} className="flex flex-wrap items-start gap-3 py-2.5">
            <Icon name={ICON[e.source]} size={18} className="mt-0.5 shrink-0 text-ink-3" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-[13.5px] font-medium text-ink">{KIND_LABEL[e.kind]}</span>
                <Status tone={l.tone}>{l.label}</Status>
                <span className="text-[12px] text-ink-3 tnum">{fmtShort(e.occurredAt)}{e.receivedAt.getTime() - e.occurredAt.getTime() > 10 * 60_000 ? ` · received ${fmtTime(e.receivedAt)}` : ""}</span>
              </div>
              <p className="text-[12.5px] text-ink-2">
                {e.note}{e.gateway ? ` · ${e.gateway.deviceName}` : ""}
                {!IS_LOCATION_EVIDENCE[e.source] && e.status !== "REJECTED" && <span className="text-ink-3"> · not location evidence</span>}
              </p>
              {e.flags.length > 0 && <p className="text-[12px] text-warn">{e.flags.map((f) => FLAG_LABEL[f] ?? f).join(" · ")}</p>}
              {e.decidedAt && (e.decidedBy || e.decisionNote) && <p className="text-[12px] text-ink-3">{e.status === "REJECTED" ? "Rejected" : "Confirmed"}{e.decidedBy ? ` by ${e.decidedBy.name}` : ""} {fmtShort(e.decidedAt)}{e.decisionNote ? `: ${e.decisionNote}` : ""}</p>}
            </div>
            {open && canDecide && (
              <span className="flex shrink-0 gap-1.5">
                <ConfirmButton label="Reject" variant="danger" title="Reject this record?" body={e.status === "PROVISIONAL" && e.kind === "CHECK_IN" ? "The provisional clock-in is undone and the shift shows as not confirmed." : "Nothing is applied. The record stays in the history as rejected."} withNote="Why?" confirmLabel="Reject" action={async (note) => { "use server"; await decideAttendanceEvidence(e.id, false, note); }} />
                <ConfirmButton label="Confirm" title={`Confirm this ${KIND_LABEL[e.kind].toLowerCase()}?`} body={e.status === "PENDING" ? "It is applied to the shift now, at the time of the call, and recorded as confirmed by you." : "It stays applied and is no longer provisional."} withNote="How was it confirmed? (for example: called the guard back)" confirmLabel="Confirm" action={async (note) => { "use server"; await decideAttendanceEvidence(e.id, true, note); }} />
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
