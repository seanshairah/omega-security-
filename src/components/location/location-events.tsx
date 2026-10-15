import Link from "next/link";
import type { LocationEvent } from "@prisma/client";
import { Status } from "@/components/ui/status";
import { Table, THead, TBody, Empty } from "@/components/ui/table";
import { Rows, CardRow } from "@/components/ui/rows";
import { fmtDate, fmtTime } from "@/lib/time";
import { LOCATION_STATE_META } from "@/lib/geofence";

export const EVENT_LABEL: Record<LocationEvent["eventType"], { label: string; tone: "ok" | "warn" | "critical" | "neutral" | "info" | "muted" }> = {
  SHIFT_STARTED: { label: "Monitoring started", tone: "info" },
  LOCATION_CHECK: { label: "Location check", tone: "neutral" },
  LOCATION_EXIT: { label: "LOCATION EXIT", tone: "critical" },
  LOCATION_OUTSIDE: { label: "Outside", tone: "critical" },
  LOCATION_RETURNED: { label: "LOCATION RETURNED", tone: "ok" },
  LOCATION_UNAVAILABLE: { label: "Location unavailable", tone: "warn" },
  LOCATION_VERIFICATION_OVERDUE: { label: "Verification overdue", tone: "warn" },
  LOCATION_CALL: { label: "Location at call", tone: "info" },
};

export function SyncBadge({ s }: { s: LocationEvent["syncStatus"] }) {
  if (s === "LIVE") return <span className="rounded-[4px] bg-ok-soft px-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[#1e7a5e]">live</span>;
  if (s === "SYNCED") return <span className="rounded-[4px] bg-surface-2 px-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-2">synced</span>;
  return <span className="rounded-[4px] bg-info-soft px-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[#3a50ad]">synced late</span>;
}

export function StateBadge({ s }: { s: LocationEvent["locationState"] }) {
  const m = LOCATION_STATE_META[s];
  return <Status tone={m.tone}>{m.label}</Status>;
}

export function LocationEventList({ events, showShift = false, emptyTitle = "No location events" }: { events: (LocationEvent & { shift?: { id: string; startAt: Date; endAt: Date } | null; location?: { id: string; name: string } | null })[]; showShift?: boolean; emptyTitle?: string }) {
  return (
    <Rows
      table={
        <Table>
          <THead><tr><th>When</th><th>Event</th><th>State</th><th>Distance</th><th>Accuracy</th><th>Sync</th>{showShift && <th>Shift</th>}<th>Detail</th></tr></THead>
          <TBody>
            {events.length === 0 && <Empty colSpan={8} title={emptyTitle} body="Location events come from the guard's phone during a shift: arrival, periodic checks, exits and returns." />}
            {events.map((e) => (
              <tr key={e.id} className={e.eventType === "LOCATION_EXIT" ? "bg-critical-soft/40" : ""}>
                <td className="tnum">{fmtDate(e.occurredAt)}<span className="block text-[12px] text-ink-3">{fmtTime(e.occurredAt)}</span></td>
                <td><Status tone={EVENT_LABEL[e.eventType].tone}>{EVENT_LABEL[e.eventType].label}</Status></td>
                <td><StateBadge s={e.locationState} /></td>
                <td className="tnum">{e.distanceM != null ? `${Math.round(e.distanceM)} m` : "—"}{e.geofenceRadiusM ? <span className="block text-[12px] text-ink-3">fence {e.geofenceRadiusM} m</span> : null}</td>
                <td className="tnum">{e.accuracyM != null ? `±${Math.round(e.accuracyM)} m` : "—"}{e.mock && <span className="block text-[12px] text-critical">mock provider</span>}</td>
                <td><SyncBadge s={e.syncStatus} /></td>
                {showShift && <td className="tnum text-ink-2">{e.shift ? <Link href={`/shifts/${e.shift.id}`} className="hover:underline">{fmtDate(e.shift.startAt)} {fmtTime(e.shift.startAt)}</Link> : "—"}</td>}
                <td className="text-[12.5px] text-ink-2">{e.reason ? e.reason.replace(/_/g, " ") : e.durationOutsideSeconds != null ? `${Math.round(e.durationOutsideSeconds / 60)} min outside` : e.provider ?? ""}{e.simulated ? " · simulated" : ""}</td>
              </tr>
            ))}
          </TBody>
        </Table>
      }
      cards={
        <div>
          {events.length === 0 && <p className="px-4 py-8 text-center text-[13px] text-ink-3">{emptyTitle}</p>}
          {events.map((e) => <CardRow key={e.id} tone={e.eventType === "LOCATION_EXIT" ? "critical" : undefined} title={EVENT_LABEL[e.eventType].label} subtitle={`${fmtDate(e.occurredAt)} ${fmtTime(e.occurredAt)}`} right={<SyncBadge s={e.syncStatus} />} meta={[{ label: "State", value: LOCATION_STATE_META[e.locationState].label }, { label: "Distance", value: e.distanceM != null ? `${Math.round(e.distanceM)} m` : "—" }, { label: "Accuracy", value: e.accuracyM != null ? `±${Math.round(e.accuracyM)} m` : "—" }, { label: "Detail", value: e.reason?.replace(/_/g, " ") ?? (e.durationOutsideSeconds != null ? `${Math.round(e.durationOutsideSeconds / 60)} min outside` : "—") }]} />)}
        </div>
      }
    />
  );
}
