import { db } from "@/lib/db";
import type { Prisma, AttendanceStatus } from "@prisma/client";
import { shiftInclude } from "./shifts";

export type AttendanceFilter = { from?: Date; to?: Date; guardId?: string; locationId?: string; clientId?: string; status?: AttendanceStatus };

export function attendanceWhere(f: AttendanceFilter): Prisma.ShiftWhereInput {
  const where: Prisma.ShiftWhereInput = { status: { notIn: ["CANCELLED"] } };
  if (f.from || f.to) where.startAt = { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) };
  if (f.guardId) where.guardId = f.guardId;
  if (f.locationId) where.locationId = f.locationId;
  if (f.clientId) where.location = { clientId: f.clientId };
  if (f.status) where.attendance = { status: f.status };
  return where;
}

export async function attendanceRows(f: AttendanceFilter, take = 500) {
  return db.shift.findMany({ where: attendanceWhere(f), include: shiftInclude, orderBy: { startAt: "desc" }, take });
}

export const ATTENDANCE_LABEL: Record<AttendanceStatus, { label: string; tone: "ok" | "warn" | "critical" | "neutral" | "muted" }> = {
  PENDING: { label: "Pending", tone: "neutral" },
  PRESENT: { label: "Present", tone: "ok" },
  LATE: { label: "Late", tone: "warn" },
  NOT_REPORTED: { label: "Not reported", tone: "critical" },
  COMPLETED: { label: "Shift completed", tone: "ok" },
  LEFT_EARLY: { label: "Left early", tone: "warn" },
  STILL_ON_DUTY: { label: "Still on duty", tone: "warn" },
  INCIDENT: { label: "Incident", tone: "critical" },
};

export function toCsv(rows: Awaited<ReturnType<typeof attendanceRows>>): string {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["Date", "Guard", "Guard no", "Client", "Location", "Scheduled start", "Scheduled end", "Duration (h)", "Arrival confirmed", "Late (min)", "Completion confirmed", "Missed checks", "Attendance", "Shift status"];
  const lines = rows.map((s) => [
    s.startAt.toISOString().slice(0, 10), `${s.guard.firstName} ${s.guard.lastName}`, s.guard.guardNo, s.location.client.name, s.location.name,
    s.startAt.toISOString(), s.endAt.toISOString(), (s.durationMinutes / 60).toFixed(1), s.attendance?.arrivalConfirmedAt?.toISOString() ?? "", s.attendance?.lateMinutes ?? 0,
    s.attendance?.completionConfirmedAt?.toISOString() ?? "", s.attendance?.missedChecks ?? 0, s.attendance?.status ?? "", s.status,
  ].map(esc).join(","));
  return [head.map(esc).join(","), ...lines].join("\n");
}
