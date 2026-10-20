import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/icon";
import { Status, type Tone } from "@/components/ui/status";
import { CHECK_IN_META, describeOutcome, type CheckInStatus } from "@/lib/attendance/check-in";
import { fmtTime } from "@/lib/time";
import { cn } from "@/lib/cn";

export type CheckInView = {
  id: string;
  shiftId: string;
  guardName: string;
  guardPhone: string;
  siteName: string;
  status: CheckInStatus;
  scheduledStartAt: Date;
  callAt: Date | null;
  gpsCapturedAt: Date | null;
  verifiedArrivalAt: Date | null;
  accuracyM: number | null;
  distanceM: number | null;
  minutesAfterStart: number | null;
  lateMinutes: number;
  graceMinutes: number;
  source: string;
  exceptionReason: string | null;
  deviceOnline: boolean | null;
  decidedBy: string | null;
  decisionReason: string | null;
};

const TONE: Record<string, Tone> = { ok: "ok", warn: "warn", critical: "critical", info: "info", neutral: "neutral", muted: "muted" };

/** One fact: a micro label over a value, so a row scans in a single pass. */
function Cell({ icon, label, value, tone }: { icon: IconName; label: string; value: React.ReactNode; tone?: "warn" | "critical" }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3"><Icon name={icon} size="xs" />{label}</div>
      <div className={cn("truncate text-[13px] tnum", tone === "critical" ? "text-critical" : tone === "warn" ? "text-warn" : "text-ink")}>{value}</div>
    </div>
  );
}

/**
 * The control-room line for one check-in. Deliberately dense: the four moments an operator compares
 * (expected, call, fix, verdict) sit on one row, with the reason underneath only when there is one.
 */
export function CheckInRow({ v, actions }: { v: CheckInView; actions?: React.ReactNode }) {
  const meta = CHECK_IN_META[v.status];
  const manual = v.source === "MANUAL";
  return (
    <div className={cn("rounded-[var(--radius-card)] border bg-surface px-3.5 py-3", meta.tone === "critical" ? "border-critical/40" : meta.tone === "warn" ? "border-warn/40" : "border-line")} data-testid="check-in-row">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Icon name={meta.icon as IconName} size="lg" filled className={cn(meta.tone === "critical" ? "text-critical" : meta.tone === "warn" ? "text-warn" : meta.tone === "ok" ? "text-ok" : "text-ink-3")} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link href={`/shifts/${v.shiftId}`} className="truncate text-[14px] font-semibold text-ink hover:underline">{v.guardName}</Link>
            <span className="truncate text-[13px] text-ink-2">{v.siteName}</span>
            <Status tone={TONE[meta.tone]}>{describeOutcome(v.status, v.minutesAfterStart != null ? { minutesAfterStart: v.minutesAfterStart, lateMinutes: v.lateMinutes } : null)}</Status>
            {manual && <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink-2"><Icon name="badge" size="xs" />By hand</span>}
            {v.deviceOnline === false && <span className="inline-flex items-center gap-1 text-[11.5px] text-ink-3"><Icon name="cloud_off" size="xs" />phone offline</span>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div>}
      </div>

      <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-dashed border-line pt-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <Cell icon="schedule" label="Scheduled" value={fmtTime(v.scheduledStartAt)} />
        <Cell icon="phone_callback" label="Call" value={v.callAt ? fmtTime(v.callAt) : "—"} />
        <Cell icon="my_location" label="GPS" value={v.gpsCapturedAt ? fmtTime(v.gpsCapturedAt) : "—"} />
        <Cell icon="verified_user" label="Arrival" value={v.verifiedArrivalAt ? fmtTime(v.verifiedArrivalAt) : "—"} tone={v.lateMinutes > 0 ? "warn" : undefined} />
        <Cell icon="distance" label="Distance" value={v.distanceM != null ? `${Math.round(v.distanceM)} m` : "—"} tone={v.status === "OUTSIDE_AREA" ? "critical" : undefined} />
        <Cell icon="radar" label="Accuracy" value={v.accuracyM != null ? `±${Math.round(v.accuracyM)} m` : "—"} />
      </div>

      {(v.exceptionReason || v.decisionReason) && (
        <p className="mt-2 text-[12.5px] text-ink-2">
          {v.decidedBy && <span className="font-medium text-ink">{v.decidedBy}: </span>}
          {v.decisionReason ?? v.exceptionReason}
        </p>
      )}
      {v.lateMinutes === 0 && v.minutesAfterStart != null && v.minutesAfterStart > 0 && v.status === "VERIFIED_WITHIN_GRACE" && (
        <p className="mt-1 text-[11.5px] text-ink-3">Within the {v.graceMinutes}-minute grace period.</p>
      )}
    </div>
  );
}
