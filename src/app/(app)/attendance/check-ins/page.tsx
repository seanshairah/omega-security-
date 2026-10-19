import Link from "next/link";
import { requireUser, can } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { PageHeader, Segments, Explainer } from "@/components/ui/page";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState, MetricStrip } from "@/components/workspace/panel";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { AutoRefresh } from "@/components/auto-refresh";
import { CheckInRow, type CheckInView } from "@/components/attendance/check-in-card";
import { decideCheckIn, retryCheckInFix } from "@/actions/check-ins";
import { EXCEPTION_STATUSES, VERIFIED_STATUSES, type CheckInStatus } from "@/lib/attendance/check-in";
import { effectiveStatus } from "@/lib/gateway/service";
import { getSettingNumber } from "@/lib/settings";
import type { Prisma } from "@prisma/client";

export const metadata = { title: "Check-ins" };

const VIEWS = [
  { key: "open", label: "Needs attention" },
  { key: "late", label: "Late arrivals" },
  { key: "verified", label: "Verified" },
  { key: "all", label: "All" },
] as const;

export default async function CheckInsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const view = (VIEWS.find((v) => v.key === sp.view)?.key ?? "open") as (typeof VIEWS)[number]["key"];
  const supervise = can.manageShifts(user);
  const offlineMinutes = await getSettingNumber("gateway.offlineMinutes");

  const where: Prisma.AttendanceCheckInWhereInput =
    view === "open" ? { status: { in: [...EXCEPTION_STATUSES, "CALL_RECEIVED", "GPS_PENDING"] as CheckInStatus[] as never } }
    : view === "late" ? { status: "VERIFIED_LATE" }
    : view === "verified" ? { status: { in: VERIFIED_STATUSES as never } }
    : {};

  const rows = await db.attendanceCheckIn.findMany({
    where, orderBy: { scheduledStartAt: "desc" }, take: 100,
    include: { shift: { include: { location: true } }, guard: true, gatewayDevice: true, decidedBy: { select: { name: true } } },
  });

  const now = new Date();
  const views: CheckInView[] = rows.map((r) => ({
    id: r.id, shiftId: r.shiftId,
    guardName: `${r.guard.firstName} ${r.guard.lastName}`, guardPhone: r.guard.phone,
    siteName: r.shift.location.name,
    status: r.status as CheckInStatus,
    scheduledStartAt: r.scheduledStartAt, callAt: r.callAt, gpsCapturedAt: r.gpsCapturedAt, verifiedArrivalAt: r.verifiedArrivalAt,
    accuracyM: r.accuracyM, distanceM: r.distanceM, minutesAfterStart: r.minutesAfterStart, lateMinutes: r.lateMinutes, graceMinutes: r.graceMinutes,
    source: r.source, exceptionReason: r.exceptionReason,
    deviceOnline: r.gatewayDevice ? effectiveStatus(r.gatewayDevice, offlineMinutes, now) === "ONLINE" : null,
    decidedBy: r.decidedBy?.name ?? null, decisionReason: r.decisionReason,
  }));

  const counts = await db.attendanceCheckIn.groupBy({ by: ["status"], _count: { _all: true } });
  const n = (s: CheckInStatus[]) => counts.filter((c) => s.includes(c.status as CheckInStatus)).reduce((t, c) => t + c._count._all, 0);

  return (
    <div className="w-full">
      <AutoRefresh seconds={30} />
      <PageHeader
        title="Shift check-ins"
        description="A guard rings in at the start of a shift and their phone is asked for a fresh GPS fix. Attendance is recorded only when the fix places them on site."
        actions={<Link href="/settings#checkin" className="inline-flex items-center gap-1 text-[13px] font-medium text-accent-strong hover:underline"><Icon name="tune" size="sm" />Check-in settings</Link>}
      />

      <MetricStrip className="mb-4" items={[
        { label: "Needs attention", value: n([...EXCEPTION_STATUSES]), tone: n([...EXCEPTION_STATUSES]) > 0 ? "critical" : "neutral" },
        { label: "Awaiting", value: n(["AWAITING", "CALL_RECEIVED", "GPS_PENDING"]), sub: "call or fix outstanding" },
        { label: "Late arrivals", value: n(["VERIFIED_LATE"]), tone: "warn" },
        { label: "Verified", value: n([...VERIFIED_STATUSES]), tone: "ok" },
      ]} />

      <Segments className="mb-3" items={VIEWS.map((v) => ({ href: `/attendance/check-ins?view=${v.key}`, label: v.label, active: v.key === view }))} />

      <Explainer title="How a check-in is decided" className="mb-3">
        <p>A call from the guard&apos;s own registered phone, inside the check-in window, is a check-in attempt. The call alone is never attendance.</p>
        <p>The system then asks that phone for a fresh fix and compares it with the site&apos;s geofence, allowing for the reported accuracy. A fix whose accuracy circle straddles the fence is reported as uncertain rather than approved.</p>
        <p>The arrival time is when the fix was captured, not when the server processed it. Late minutes are counted beyond the grace period, which a site or a single shift can override.</p>
      </Explainer>

      {views.length === 0 ? (
        <Card><CardBody><EmptyState icon="check_circle" title={view === "open" ? "Nothing needs attention" : "Nothing here yet"} detail={view === "open" ? "Every check-in has either been verified or is still inside its window." : "Check-ins appear here once shifts with the feature enabled reach their start time."} /></CardBody></Card>
      ) : (
        <div className="space-y-2">
          {views.map((v) => (
            <CheckInRow key={v.id} v={v} actions={supervise && (
              <>
                {["CALL_RECEIVED", "GPS_PENDING", "LOCATION_UNAVAILABLE", "LOCATION_UNCERTAIN", "OUTSIDE_AREA", "MISSED", "MANUAL_REVIEW"].includes(v.status) && (
                  <form action={async () => { "use server"; await retryCheckInFix(v.id); }}>
                    <Button type="submit" size="sm" variant="secondary"><Icon name="my_location" size="sm" />Request fix</Button>
                  </form>
                )}
                {!["MANUALLY_APPROVED", "MANUALLY_REJECTED"].includes(v.status) && (
                  <>
                    <ConfirmButton size="sm" label="Approve" title="Approve this attendance by hand?" body={`This records ${v.guardName} as present on the strength of your judgement, not GPS. The shift keeps the evidence that was actually received.`} withNote="Why are you approving this?" confirmLabel="Approve attendance" action={async (note) => { "use server"; await decideCheckIn(v.id, "APPROVE", note); }} />
                    <ConfirmButton size="sm" variant="danger" label="Reject" title="Reject this attendance?" body={`This records ${v.guardName} as not reported for this shift.`} withNote="Why are you rejecting this?" confirmLabel="Reject attendance" action={async (note) => { "use server"; await decideCheckIn(v.id, "REJECT", note); }} />
                  </>
                )}
              </>
            )} />
          ))}
        </div>
      )}
    </div>
  );
}
