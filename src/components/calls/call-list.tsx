import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import type { CallWithRelations } from "@/lib/gateway/calls";
import { CALL_STATUS_META, fmtCallDuration } from "@/lib/gateway/call-state";
import { Table, THead, TBody, Empty } from "@/components/ui/table";
import { Rows, CardRow } from "@/components/ui/rows";
import { Status } from "@/components/ui/status";
import { Avatar } from "@/components/ui/avatar";
import { fmtDate, fmtTime } from "@/lib/time";
import { formatPhone } from "@/lib/phone";

export function CallerName({ c }: { c: CallWithRelations }) {
  if (c.guard) return <Link href={`/guards/${c.guard.id}`} className="font-medium text-ink hover:underline">{c.guard.firstName} {c.guard.lastName}</Link>;
  return <span className="font-medium text-[#8a5e05]">Unknown caller</span>;
}

export function CallStatusBadge({ c }: { c: CallWithRelations }) {
  const m = CALL_STATUS_META[c.status];
  return <Status tone={m.tone} pulse={c.status === "RINGING"}>{c.status === "RINGING" && c.direction === "OUTGOING" ? "Dialling" : m.label}</Status>;
}

/** Responsive call table used by the calls page, gateway page and guard profile. */
export function CallList({ calls, showGuard = true, showGateway = true, emptyTitle = "No calls yet" }: { calls: CallWithRelations[]; showGuard?: boolean; showGateway?: boolean; emptyTitle?: string }) {
  return (
    <Rows
      table={
        <Table>
          <THead><tr><th>When</th>{showGuard && <th>Caller</th>}<th>Number</th><th>Direction</th><th>Status</th><th>Duration</th><th>Location</th>{showGateway && <th>Gateway</th>}<th>Shift</th></tr></THead>
          <TBody>
            {calls.length === 0 && <Empty colSpan={9} title={emptyTitle} />}
            {calls.map((c) => (
              <tr key={c.id} className={c.status === "MISSED" && c.shiftId ? "bg-critical-soft/40" : ""}>
                <td className="tnum"><Link href={`/calls/${c.id}`} className="font-medium text-ink hover:underline">{fmtDate(c.startedAt)}</Link><span className="block text-[12px] text-ink-3">{fmtTime(c.startedAt)}</span></td>
                {showGuard && <td><span className="flex items-center gap-2">{c.guard && <Avatar src={c.guard.photoUrl} name={c.guard.firstName} size={24} />}<CallerName c={c} /></span></td>}
                <td className="tnum text-ink-2">{formatPhone(c.normalizedPhoneNumber)}</td>
                <td className="text-ink-2"><span className="inline-flex items-center gap-1">{c.direction === "INCOMING" ? <Icon name="phone_callback" size={14} filled /> : <Icon name="phone_forwarded" size={14} filled />}{c.direction === "INCOMING" ? "Incoming" : "Outgoing"}</span></td>
                <td><CallStatusBadge c={c} /></td>
                <td className="tnum">{c.status === "ENDED" ? fmtCallDuration(c.durationSeconds) : "—"}</td>
                <td className="text-ink-2">{c.location ? <Link href={`/locations/${c.location.id}`} className="hover:underline">{c.location.name}</Link> : "—"}</td>
                {showGateway && <td className="text-ink-2"><Link href={`/gateways/${c.gateway.id}`} className="hover:underline">{c.gateway.deviceName}</Link></td>}
                <td className="tnum text-ink-2">{c.shift ? <Link href={`/shifts/${c.shift.id}`} className="hover:underline">{fmtTime(c.shift.startAt)}–{fmtTime(c.shift.endAt)}</Link> : "—"}</td>
              </tr>
            ))}
          </TBody>
        </Table>
      }
      cards={
        <div>
          {calls.length === 0 && <p className="px-4 py-8 text-center text-[13px] text-ink-3">{emptyTitle}</p>}
          {calls.map((c) => (
            <CardRow key={c.id} href={`/calls/${c.id}`} tone={c.status === "MISSED" && c.shiftId ? "critical" : undefined} title={c.guard ? `${c.guard.firstName} ${c.guard.lastName}` : "Unknown caller"} subtitle={`${formatPhone(c.normalizedPhoneNumber)} · ${c.direction === "INCOMING" ? "incoming" : "outgoing"}`} right={<CallStatusBadge c={c} />} meta={[{ label: "When", value: `${fmtDate(c.startedAt)} ${fmtTime(c.startedAt)}` }, { label: "Duration", value: c.status === "ENDED" ? fmtCallDuration(c.durationSeconds) : "—" }, { label: "Location", value: c.location?.name ?? "—" }, { label: "Gateway", value: c.gateway.deviceName }]} />
          ))}
        </div>
      }
    />
  );
}
