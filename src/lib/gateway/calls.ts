/** Call log queries shared by the pages, the API and the CSV export. */
import { db } from "@/lib/db";
import type { CallDirection, CallStatus, Prisma } from "@prisma/client";
import { fmtDate, fmtTime } from "@/lib/time";
import { fmtCallDuration, CALL_STATUS_META } from "./call-state";

export type CallFilter = { from?: Date; to?: Date; guardId?: string; locationId?: string; clientId?: string; gatewayId?: string; status?: CallStatus; direction?: CallDirection; unknown?: boolean; q?: string };

export const callInclude = { guard: { select: { id: true, firstName: true, lastName: true, phone: true, photoUrl: true } }, location: { select: { id: true, name: true } }, client: { select: { id: true, name: true } }, gateway: { select: { id: true, deviceName: true, phoneNumber: true } }, shift: { select: { id: true, startAt: true, endAt: true, status: true } } } satisfies Prisma.CallLogInclude;
export type CallWithRelations = Prisma.CallLogGetPayload<{ include: typeof callInclude }>;

export function callsWhere(f: CallFilter): Prisma.CallLogWhereInput {
  const where: Prisma.CallLogWhereInput = {};
  if (f.from || f.to) where.startedAt = { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) };
  if (f.guardId) where.guardId = f.guardId;
  if (f.locationId) where.locationId = f.locationId;
  if (f.clientId) where.clientId = f.clientId;
  if (f.gatewayId) where.gatewayDeviceId = f.gatewayId;
  if (f.status) where.status = f.status;
  if (f.direction) where.direction = f.direction;
  if (f.unknown !== undefined) where.unknownCaller = f.unknown;
  if (f.q) where.OR = [{ normalizedPhoneNumber: { contains: f.q.replace(/\D/g, "") } }, { guard: { OR: [{ firstName: { contains: f.q, mode: "insensitive" } }, { lastName: { contains: f.q, mode: "insensitive" } }] } }];
  return where;
}

export async function callRows(f: CallFilter, take = 200, skip = 0) {
  return db.callLog.findMany({ where: callsWhere(f), include: callInclude, orderBy: { startedAt: "desc" }, take, skip });
}

export async function callMetrics(f: CallFilter) {
  const where = callsWhere(f);
  const [total, incoming, missed, answered, unknown, durations] = await Promise.all([
    db.callLog.count({ where }),
    db.callLog.count({ where: { ...where, direction: "INCOMING" } }),
    db.callLog.count({ where: { ...where, status: "MISSED" } }),
    db.callLog.count({ where: { ...where, status: { in: ["ANSWERED", "ENDED"] } } }),
    db.callLog.count({ where: { ...where, unknownCaller: true } }),
    db.callLog.aggregate({ where: { ...where, status: "ENDED", durationSeconds: { gt: 0 } }, _avg: { durationSeconds: true } }),
  ]);
  return { total, incoming, outgoing: total - incoming, missed, answered, unknown, avgDurationSeconds: Math.round(durations._avg.durationSeconds ?? 0) };
}

/** Calls that are ringing or in progress right now, newest first. */
export async function liveCalls() {
  return db.callLog.findMany({ where: { status: { in: ["RINGING", "ANSWERED"] } }, include: callInclude, orderBy: { startedAt: "desc" }, take: 20 });
}

export function toCallsCsv(rows: CallWithRelations[]): string {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["Date", "Time", "Direction", "Status", "Duration", "Phone", "Guard", "Location", "Client", "Gateway", "Shift"];
  const lines = rows.map((r) => [fmtDate(r.startedAt), fmtTime(r.startedAt), r.direction.toLowerCase(), CALL_STATUS_META[r.status].label, fmtCallDuration(r.durationSeconds), r.normalizedPhoneNumber, r.guard ? `${r.guard.firstName} ${r.guard.lastName}` : r.unknownCaller ? "Unknown caller" : "", r.location?.name ?? "", r.client?.name ?? "", r.gateway.deviceName, r.shift ? `${fmtDate(r.shift.startAt)} ${fmtTime(r.shift.startAt)}-${fmtTime(r.shift.endAt)}` : ""].map(esc).join(","));
  return [head.map(esc).join(","), ...lines].join("\n");
}
