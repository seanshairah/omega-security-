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
import { fmtDate, fmtDateTime } from "@/lib/time";
import { LOCATION_STATE_META } from "@/lib/geofence";
import { NETWORK_RESULT_META } from "@/lib/network-location/router-rules";
import type { GuardProfile } from "@/components/guards/guard-workspace";

const LIVE_TONE = { DEPLOYED: "ok", AVAILABLE: "neutral", ON_LEAVE: "warn", SUSPENDED: "critical", INACTIVE: "muted" } as const;

export async function guardWorkspaceData(guardId: string) {
  const g = await db.guard.findUnique({ where: { id: guardId }, include: { homeLocation: true, supervisor: true, assignedGateway: { select: { deviceName: true } } } });
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
  // The latest of each kind of evidence, so a supervisor sees how this guard was last heard from.
  const [lastCall, lastSms, lastGps, lastNetwork, lastWelfare] = await Promise.all([
    db.callLog.findFirst({ where: { guardId, direction: "INCOMING" }, orderBy: { startedAt: "desc" }, select: { startedAt: true, status: true } }),
    db.smsMessage.findFirst({ where: { guardId, direction: "INBOUND" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    db.locationEvent.findFirst({ where: { guardId, latitude: { not: null } }, orderBy: { occurredAt: "desc" }, select: { occurredAt: true, locationState: true } }),
    db.networkLocationCheck.findFirst({ where: { guardId }, orderBy: { requestedAt: "desc" }, select: { requestedAt: true, result: true, simulated: true } }),
    deployed ? db.welfareCheck.findFirst({ where: { shiftId: deployed.id }, orderBy: { sentAt: "desc" }, select: { response: true, sentAt: true, escalatedAt: true } }) : Promise.resolve(null),
  ]);
  const when = (d: Date | null | undefined) => (d ? fmtDateTime(d) : null);
  const live = guardLiveStatus(g, Boolean(deployed));
  const profile: GuardProfile = {
    photoUrl: g.photoUrl, email: g.email, nationalId: g.nationalId, supervisor: g.supervisor?.name ?? null, homeLocation: g.homeLocation ? { id: g.homeLocation.id, name: g.homeLocation.name } : null, address: g.address,
    emergencyContact: g.emergencyContactName ? `${g.emergencyContactName} · ${g.emergencyContactPhone ?? ""}` : null,
    employment: g.employmentStatus === "ACTIVE" ? "Active" : g.employmentStatus === "ON_LEAVE" ? "On leave" : g.employmentStatus === "SUSPENDED" ? "Suspended" : "Inactive", employedSince: fmtDate(g.dateEmployed),
    notes: g.notes, watchNote: g.watched ? g.watchNote ?? "" : null, liveLabel: live === "DEPLOYED" && deployed ? `Deployed · ${deployed.location.name}` : GUARD_STATUS_LABEL[live], liveTone: LIVE_TONE[live], performance: perf,
    attendance: checkIn ? { label: CHECK_IN_META[checkIn.status].label, tone: CHECK_IN_META[checkIn.status].tone } : null,
    phoneProfile: {
      type: { BASIC: "Basic phone", ANDROID: "Android", OTHER: "Other phone", UNKNOWN: "Phone type not set" }[g.phoneType],
      operator: { ECONET: "Econet", NETONE: "NetOne", TELECEL: "Telecel", OTHER: "other network", UNKNOWN: "network not set" }[g.mobileOperator],
      verified: Boolean(g.phoneVerifiedAt),
      attendsBy: [g.deviceKind === "ANDROID_GUARD" ? "guard app" : null, g.callAttendanceEnabled ? "calls" : null, g.smsAttendanceEnabled ? "SMS" : null].filter(Boolean).join(", ") || "nothing enabled",
      gateway: g.assignedGateway?.deviceName ?? null,
      alternates: g.alternatePhones.length,
      lastCall: when(lastCall?.startedAt),
      lastSms: when(lastSms?.createdAt),
      lastGps: lastGps ? `${when(lastGps.occurredAt)} · ${LOCATION_STATE_META[lastGps.locationState].label.toLowerCase()}` : null,
      lastNetwork: lastNetwork ? `${when(lastNetwork.requestedAt)} · ${lastNetwork.simulated ? "simulated · " : ""}${NETWORK_RESULT_META[lastNetwork.result].label.replace(/^Network: /, "").toLowerCase()}` : null,
      welfare: lastWelfare ? (lastWelfare.response === "PENDING" ? "Waiting for a reply" : lastWelfare.response === "WELL" ? "Well" : lastWelfare.response === "NO_RESPONSE" ? (lastWelfare.escalatedAt ? "Missed, escalated" : "Missed") : lastWelfare.response === "ASSISTANCE" ? "Needs assistance" : "Incident") : null,
    },
  };
  return { guard: g, deployed, snapshot: JSON.parse(JSON.stringify(snapshot)), activity, profile };
}
