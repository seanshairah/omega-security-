/**
 * Attendance evidence: one row per fact about a guard's attendance on a shift, with where it came
 * from. The labels below are the only words the portal uses for them, so a call is never shown as
 * location and a simulated check never as a real one.
 */
import type { AttendanceEvidence, EvidenceKind, EvidenceSource, EvidenceStatus } from "@prisma/client";
import { db } from "@/lib/db";

export type EvidenceTone = "ok" | "warn" | "critical" | "info" | "neutral" | "muted";

/** What a confirmed piece of evidence from each source may be called. */
export const SOURCE_LABEL: Record<EvidenceSource, string> = {
  GPS: "GPS verified",
  NETWORK: "Network verified",
  CALL: "Call confirmed",
  MISSED_CALL: "Missed call",
  SMS: "SMS confirmed",
  IVR: "IVR response confirmed",
  MANUAL: "Manually verified",
};

export const KIND_LABEL: Record<EvidenceKind, string> = { CHECK_IN: "Clock-in", WELFARE: "Welfare", CHECK_OUT: "Clock-out", PRESENCE: "Presence" };

/** Does this source say anything about where the guard was? Only GPS and network checks do. */
export const IS_LOCATION_EVIDENCE: Record<EvidenceSource, boolean> = { GPS: true, NETWORK: true, CALL: false, MISSED_CALL: false, SMS: false, IVR: false, MANUAL: false };

const SIMULATED_WORD: Record<EvidenceSource, string> = { GPS: "GPS", NETWORK: "network check", CALL: "call", MISSED_CALL: "missed call", SMS: "SMS", IVR: "IVR response", MANUAL: "confirmation" };

export function evidenceLabel(e: Pick<AttendanceEvidence, "source" | "status"> & { flags?: string[] }): { label: string; tone: EvidenceTone } {
  // A simulated record is never shown with a verified label.
  if (e.flags?.includes("SIMULATED")) return { label: `Simulated ${SIMULATED_WORD[e.source]} · not real evidence`, tone: "muted" };
  if (e.status === "PENDING") return { label: e.source === "MISSED_CALL" ? "Missed call · pending" : "Attendance pending", tone: "warn" };
  if (e.status === "REJECTED") return { label: `${SOURCE_LABEL[e.source]} · rejected`, tone: "muted" };
  if (e.status === "PROVISIONAL") return { label: `${e.source === "MISSED_CALL" ? "Missed call" : SOURCE_LABEL[e.source]} · provisional`, tone: "info" };
  return { label: e.source === "MISSED_CALL" ? "Missed call confirmed" : SOURCE_LABEL[e.source], tone: e.source === "GPS" || e.source === "NETWORK" || e.source === "MANUAL" ? "ok" : "info" };
}

export const FLAG_LABEL: Record<string, string> = {
  WRONG_GATEWAY: "called another gateway",
  LATE_SYNC: "reached the server late",
  SHORT_CALL: "very short call",
  SHIFT_CLOSED: "shift already closed",
  AMBIGUOUS: "matches more than one shift",
  MISSED_CALL: "not answered",
  NO_CHECK_IN: "no clock-in",
  LATE_CHECK_IN: "after the clock-in window",
  SMS_CONFIRM_SENT: "SMS sent asking to confirm",
  SIMULATED: "simulated, not real evidence",
  OPERATOR_CALLED: "operator called the guard",
  GPS_REQUESTED: "verifying by GPS on the guard's phone",
};

export type NewEvidence = {
  shiftId: string; guardId: string; kind: EvidenceKind; source: EvidenceSource; status: EvidenceStatus;
  occurredAt: Date; dedupeKey: string; callLogId?: string | null; smsMessageId?: string | null; gatewayDeviceId?: string | null;
  flags?: string[]; note?: string | null; decidedById?: string | null; decidedAt?: Date | null;
};

/** Store one piece of evidence. A second call with the same key stores nothing and says so. */
export async function recordEvidence(e: NewEvidence): Promise<{ evidence: AttendanceEvidence; created: boolean }> {
  const { count } = await db.attendanceEvidence.createMany({
    data: [{ ...e, flags: e.flags ?? [], callLogId: e.callLogId ?? null, smsMessageId: e.smsMessageId ?? null, gatewayDeviceId: e.gatewayDeviceId ?? null, note: e.note ?? null, decidedById: e.decidedById ?? null, decidedAt: e.decidedAt ?? null }],
    skipDuplicates: true,
  });
  const evidence = (await db.attendanceEvidence.findUnique({ where: { dedupeKey: e.dedupeKey } }))!;
  return { evidence, created: count === 1 };
}

/**
 * Something else settled what a pending call was waiting for (the guard replied YES, a GPS check
 * verified them). The pending call rows for that shift and kind are marked confirmed by it.
 */
export async function settlePendingCalls(shiftId: string, kind: EvidenceKind, how: string, at = new Date()): Promise<number> {
  const r = await db.attendanceEvidence.updateMany({
    where: { shiftId, kind, status: "PENDING", source: { in: ["CALL", "MISSED_CALL"] } },
    data: { status: "CONFIRMED", decidedAt: at, decisionNote: how },
  });
  return r.count;
}
