import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export async function nextGuardNo(): Promise<string> {
  const last = await db.guard.findFirst({ orderBy: { guardNo: "desc" }, select: { guardNo: true } });
  const n = last ? parseInt(last.guardNo.replace(/\D/g, ""), 10) + 1 : 1;
  return `G-${String(n).padStart(4, "0")}`;
}

/** Derived "current status" for the guard list: deployed now, available, or the HR status. */
export type GuardLiveStatus = "DEPLOYED" | "AVAILABLE" | "ON_LEAVE" | "SUSPENDED" | "INACTIVE";

export function guardLiveStatus(g: { active: boolean; employmentStatus: string }, deployed: boolean): GuardLiveStatus {
  if (!g.active || g.employmentStatus === "INACTIVE") return "INACTIVE";
  if (g.employmentStatus === "ON_LEAVE") return "ON_LEAVE";
  if (g.employmentStatus === "SUSPENDED") return "SUSPENDED";
  return deployed ? "DEPLOYED" : "AVAILABLE";
}

export const GUARD_STATUS_LABEL: Record<GuardLiveStatus, string> = {
  DEPLOYED: "Currently deployed",
  AVAILABLE: "Available",
  ON_LEAVE: "On leave",
  SUSPENDED: "Suspended",
  INACTIVE: "Inactive",
};

export type PerformanceSummary = {
  scheduled: number;
  completed: number;
  missed: number;
  late: number;
  missedChecks: number;
  incidents: number;
  assistance: number;
  attendancePct: number;
};

export async function guardPerformance(guardId: string, from?: Date, to?: Date): Promise<PerformanceSummary> {
  const where: Prisma.ShiftWhereInput = { guardId, status: { notIn: ["CANCELLED", "SCHEDULED", "AWAITING_ARRIVAL"] } };
  if (from || to) where.startAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  const shifts = await db.shift.findMany({ where, include: { attendance: true } });
  const scheduled = shifts.length;
  const completed = shifts.filter((s) => s.status === "COMPLETED").length;
  const missed = shifts.filter((s) => s.status === "MISSED" || s.attendance?.status === "NOT_REPORTED").length;
  const late = shifts.filter((s) => (s.attendance?.lateMinutes ?? 0) > 0 && s.attendance?.arrivalConfirmedAt).length;
  const missedChecks = shifts.reduce((n, s) => n + (s.attendance?.missedChecks ?? 0), 0);
  const [incidents, assistance] = await Promise.all([
    db.incident.count({ where: { guardId, category: { notIn: ["ASSISTANCE_REQUEST"] } } }),
    db.incident.count({ where: { guardId, category: "ASSISTANCE_REQUEST" } }),
  ]);
  const arrived = shifts.filter((s) => s.attendance?.arrivalConfirmedAt).length;
  const attendancePct = scheduled === 0 ? 100 : Math.round((arrived / scheduled) * 100);
  return { scheduled, completed, missed, late, missedChecks, incidents, assistance, attendancePct };
}
