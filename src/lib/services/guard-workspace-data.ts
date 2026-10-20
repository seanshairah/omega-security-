/**
 * What the guard workspace needs to open, for the guard page and the Monitoring command centre
 * alike: the live snapshot, the first page of the activity feed, and the profile column.
 */
import { db } from "@/lib/db";
import { guardPerformance, guardLiveStatus, GUARD_STATUS_LABEL } from "@/lib/services/guards";
import { ON_SITE_STATUSES } from "@/lib/services/shifts";
import { guardSnapshot } from "@/lib/services/guard-snapshot";
import { guardActivity } from "@/lib/guard-activity";
import { CHECK_IN_META } from "@/lib/attendance/check-in";
import { fmtDate } from "@/lib/time";
import type { GuardProfile } from "@/components/guards/guard-workspace";

const LIVE_TONE = { DEPLOYED: "ok", AVAILABLE: "neutral", ON_LEAVE: "warn", SUSPENDED: "critical", INACTIVE: "muted" } as const;

export async function guardWorkspaceData(guardId: string) {
  const g = await db.guard.findUnique({ where: { id: guardId }, include: { homeLocation: true, supervisor: true } });
  if (!g) return null;
  const [perf, deployed, snapshot, activity] = await Promise.all([
    guardPerformance(guardId),
    db.shift.findFirst({ where: { guardId, status: { in: ON_SITE_STATUSES } }, include: { location: true } }),
    guardSnapshot(guardId),
    guardActivity(guardId, { since: new Date(Date.now() - 7 * 86_400_000), limit: 50 }),
  ]);
  if (!snapshot) return null;
  // Start-of-shift attendance for the shift in hand, as the server decided it.
  const checkIn = snapshot.shift ? await db.attendanceCheckIn.findUnique({ where: { shiftId: snapshot.shift.id }, select: { status: true } }) : null;
  const live = guardLiveStatus(g, Boolean(deployed));
  const profile: GuardProfile = {
    photoUrl: g.photoUrl, email: g.email, nationalId: g.nationalId, supervisor: g.supervisor?.name ?? null, homeLocation: g.homeLocation ? { id: g.homeLocation.id, name: g.homeLocation.name } : null, address: g.address,
    emergencyContact: g.emergencyContactName ? `${g.emergencyContactName} · ${g.emergencyContactPhone ?? ""}` : null,
    employment: g.employmentStatus === "ACTIVE" ? "Active" : g.employmentStatus === "ON_LEAVE" ? "On leave" : g.employmentStatus === "SUSPENDED" ? "Suspended" : "Inactive", employedSince: fmtDate(g.dateEmployed),
    notes: g.notes, watchNote: g.watched ? g.watchNote ?? "" : null, liveLabel: live === "DEPLOYED" && deployed ? `Deployed · ${deployed.location.name}` : GUARD_STATUS_LABEL[live], liveTone: LIVE_TONE[live], performance: perf,
    attendance: checkIn ? { label: CHECK_IN_META[checkIn.status].label, tone: CHECK_IN_META[checkIn.status].tone } : null,
  };
  return { guard: g, deployed, snapshot: JSON.parse(JSON.stringify(snapshot)), activity, profile };
}
