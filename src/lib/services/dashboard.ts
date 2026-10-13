import { db } from "@/lib/db";
import { addHours, startOfHour, subDays, startOfDay, addDays, format } from "date-fns";
import { ON_SITE_STATUSES, shiftInclude } from "./shifts";

export async function todayOverview() {
  const now = new Date();
  const dayStart = startOfDay(now);
  const dayEnd = addDays(dayStart, 1);
  const todayShifts = { startAt: { gte: dayStart, lt: dayEnd } };
  const [scheduledToday, onDuty, arrivedToday, notReported, late, activeShifts, completedToday, incidents, assistance, missedChecks, totalGuards] = await Promise.all([
    db.shift.count({ where: { ...todayShifts, status: { not: "CANCELLED" } } }),
    db.shift.count({ where: { status: { in: ON_SITE_STATUSES } } }),
    db.attendance.count({ where: { arrivalConfirmedAt: { gte: dayStart } } }),
    db.shift.count({ where: { status: { in: ["NOT_CONFIRMED", "MISSED"] }, startAt: { gte: subDays(now, 1) } } }),
    db.shift.count({ where: { OR: [{ status: "LATE" }, { attendance: { lateMinutes: { gt: 15 }, arrivalConfirmedAt: { gte: dayStart } } }] } }),
    db.shift.count({ where: { status: { in: ["AWAITING_ARRIVAL", "LATE", "NOT_CONFIRMED", ...ON_SITE_STATUSES] } } }),
    db.shift.count({ where: { status: "COMPLETED", endAt: { gte: dayStart } } }),
    db.incident.count({ where: { status: { in: ["OPEN", "ACKNOWLEDGED"] }, category: { not: "ASSISTANCE_REQUEST" } } }),
    db.shift.count({ where: { status: "ASSISTANCE" } }),
    db.welfareCheck.count({ where: { response: "NO_RESPONSE", sentAt: { gte: dayStart } } }),
    db.guard.count({ where: { active: true } }),
  ]);
  return { scheduledToday, onDuty, arrivedToday, notReported, late, activeShifts, completedToday, incidents, assistance, missedChecks, totalGuards };
}

/** Daily series for KPI sparklines: last 7 days. */
export async function dailySeries() {
  const now = new Date();
  const days = Array.from({ length: 7 }, (_, i) => startOfDay(subDays(now, 6 - i)));
  const onDuty: number[] = [];
  const notReported: number[] = [];
  const incidents: number[] = [];
  const completed: number[] = [];
  for (const d of days) {
    const next = addDays(d, 1);
    const [a, b, c, e] = await Promise.all([
      db.attendance.count({ where: { arrivalConfirmedAt: { gte: d, lt: next } } }),
      db.shift.count({ where: { startAt: { gte: d, lt: next }, OR: [{ status: "MISSED" }, { status: "NOT_CONFIRMED" }, { attendance: { status: "NOT_REPORTED" } }] } }),
      db.incident.count({ where: { occurredAt: { gte: d, lt: next } } }),
      db.shift.count({ where: { status: "COMPLETED", endAt: { gte: d, lt: next } } }),
    ]);
    onDuty.push(a); notReported.push(b); incidents.push(c); completed.push(e);
  }
  return { onDuty, notReported, incidents, completed };
}

export type TrendPoint = { label: string; sent: number; replies: number; confirmations: number };

/** Hourly (12h/24h) or daily (7d) message activity. */
export async function activityTrend(range: "12h" | "24h" | "7d"): Promise<TrendPoint[]> {
  const now = new Date();
  const buckets: { from: Date; to: Date; label: string }[] = [];
  if (range === "7d") {
    for (let i = 6; i >= 0; i--) { const from = startOfDay(subDays(now, i)); buckets.push({ from, to: addDays(from, 1), label: format(from, "EEE") }); }
  } else {
    const n = range === "12h" ? 12 : 24;
    for (let i = n - 1; i >= 0; i--) { const from = startOfHour(addHours(now, -i)); buckets.push({ from, to: addHours(from, 1), label: format(from, "h a") }); }
  }
  const from = buckets[0].from;
  const msgs = await db.smsMessage.findMany({ where: { createdAt: { gte: from } }, select: { createdAt: true, direction: true, interpretedAs: true } });
  return buckets.map((b) => {
    const inB = msgs.filter((m) => m.createdAt >= b.from && m.createdAt < b.to);
    return {
      label: b.label,
      sent: inB.filter((m) => m.direction === "OUTBOUND").length,
      replies: inB.filter((m) => m.direction === "INBOUND").length,
      confirmations: inB.filter((m) => m.direction === "INBOUND" && (m.interpretedAs === "YES" || m.interpretedAs === "WELL")).length,
    };
  });
}

/** Attendance rate for the last 24 hours of shifts that have started. */
export async function attendanceRate() {
  const now = new Date();
  const since = subDays(now, 1);
  const shifts = await db.shift.findMany({ where: { startAt: { gte: since, lte: now }, status: { not: "CANCELLED" } }, include: { attendance: true } });
  const started = shifts.filter((s) => s.status !== "SCHEDULED");
  const arrived = started.filter((s) => s.attendance?.arrivalConfirmedAt).length;
  const onTime = started.filter((s) => s.attendance?.arrivalConfirmedAt && (s.attendance.lateMinutes ?? 0) <= 15).length;
  const pct = started.length === 0 ? 100 : Math.round((arrived / started.length) * 100);
  const prevShifts = await db.shift.findMany({ where: { startAt: { gte: subDays(now, 8), lt: since }, status: { not: "CANCELLED" } }, include: { attendance: true } });
  const prevArrived = prevShifts.filter((s) => s.attendance?.arrivalConfirmedAt).length;
  const prevPct = prevShifts.length === 0 ? pct : Math.round((prevArrived / prevShifts.length) * 100);
  return { pct, started: started.length, arrived, onTime, delta: pct - prevPct };
}

export async function needsAttention() {
  return db.shift.findMany({ where: { status: { in: ["CRITICAL", "INCIDENT", "ASSISTANCE", "NOT_CONFIRMED", "LATE"] } }, include: shiftInclude, orderBy: [{ status: "asc" }, { startAt: "asc" }], take: 6 });
}
