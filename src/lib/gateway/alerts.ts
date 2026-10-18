/**
 * Guard-initiated alerts and status messages from the Android app (Phase 2, Stage 5):
 * EMERGENCY, NEED_ASSISTANCE, INCIDENT_REPORT, SECURITY_ALERT, RUNNING_LATE, STATUS_UPDATE,
 * SHIFT_OK, HANDOVER. They arrive through the same outbox and event endpoint as calls and
 * location events, keep their original time, and are acknowledged by operations in the portal;
 * the acknowledgement travels back to the phone with the next heartbeat.
 *
 * The SMS keyword flow (EMERGENCY / HELP by text) is untouched; this is the app's equivalent.
 */
import { db } from "@/lib/db";
import type { CheckInType, GatewayDevice, GuardAlertStatus, GuardAlertType, IncidentCategory, LocationState, NotificationSeverity, Severity, ShiftStatus } from "@prisma/client";
import { syncStatusFor } from "@/lib/geofence";
import { notify } from "@/lib/notifications";
import { findLiveShiftForGuard, recordEvent } from "@/lib/services/shifts";
import { createIncident } from "@/lib/services/incidents";
import { audit } from "@/lib/audit";
import { fmtTime } from "@/lib/time";
import { saneTimestamp } from "./call-state";

export const ALERT_EVENT_TYPES = ["EMERGENCY", "NEED_ASSISTANCE", "INCIDENT_REPORT", "SECURITY_ALERT", "RUNNING_LATE", "STATUS_UPDATE", "SHIFT_OK", "HANDOVER"] as const;

export type AlertMeta = {
  label: string;
  tone: "critical" | "warn" | "ok" | "info" | "neutral";
  severity: NotificationSeverity;
  /** Operations must acknowledge it; informational messages are resolved on arrival. */
  requiresAck: boolean;
  checkIn: CheckInType;
  /** Raise the shift to this status (never downgrades). */
  shiftStatus?: ShiftStatus;
  /** Open an incident of this category and severity. */
  incident?: { category: IncidentCategory; severity: Severity };
  /** What the guard reads on the phone when the alert has been received by the server. */
  guardText: string;
};

export const ALERT_META: Record<GuardAlertType, AlertMeta> = {
  EMERGENCY: { label: "EMERGENCY", tone: "critical", severity: "CRITICAL", requiresAck: true, checkIn: "EMERGENCY", shiftStatus: "CRITICAL", incident: { category: "EMERGENCY", severity: "CRITICAL" }, guardText: "Emergency alert" },
  NEED_ASSISTANCE: { label: "Needs assistance", tone: "warn", severity: "WARNING", requiresAck: true, checkIn: "WELFARE_ASSISTANCE", shiftStatus: "ASSISTANCE", guardText: "Assistance request" },
  INCIDENT_REPORT: { label: "Incident reported", tone: "critical", severity: "WARNING", requiresAck: true, checkIn: "INCIDENT_REPORTED", shiftStatus: "INCIDENT", incident: { category: "OTHER", severity: "HIGH" }, guardText: "Incident report" },
  SECURITY_ALERT: { label: "Security alert", tone: "critical", severity: "WARNING", requiresAck: true, checkIn: "SECURITY_ALERT", incident: { category: "SUSPICIOUS_ACTIVITY", severity: "HIGH" }, guardText: "Security alert" },
  RUNNING_LATE: { label: "Running late", tone: "warn", severity: "WARNING", requiresAck: true, checkIn: "RUNNING_LATE", guardText: "Running-late notice" },
  STATUS_UPDATE: { label: "Status update", tone: "info", severity: "INFO", requiresAck: false, checkIn: "STATUS_UPDATE", guardText: "Status update" },
  SHIFT_OK: { label: "Shift going well", tone: "ok", severity: "INFO", requiresAck: false, checkIn: "GUARD_OK", guardText: "Shift going well" },
  HANDOVER: { label: "Shift handover", tone: "neutral", severity: "INFO", requiresAck: false, checkIn: "HANDOVER_NOTICE", guardText: "Handover notice" },
};

const SHIFT_RANK: Partial<Record<ShiftStatus, number>> = { ASSISTANCE: 1, INCIDENT: 2, CRITICAL: 3 };
const LIVE: ShiftStatus[] = ["AWAITING_ARRIVAL", "ON_DUTY", "LATE", "NOT_CONFIRMED", "ASSISTANCE", "INCIDENT", "CRITICAL"];

export type IncomingAlertEvent = {
  eventId: string;
  eventType: GuardAlertType;
  timestamp: string | Date;
  message?: string;
  shiftId?: string;
  location?: { latitude: number; longitude: number; accuracyM?: number; state?: LocationState; ageSeconds?: number };
  meta?: Record<string, unknown>;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export function validateAlertEvent(raw: Record<string, unknown>, eventId: string, eventType: string): { ok: true; event: IncomingAlertEvent } | { ok: false; error: string } {
  if (!(ALERT_EVENT_TYPES as readonly string[]).includes(eventType)) return { ok: false, error: `unknown alert type ${eventType}` };
  const message = typeof raw.message === "string" ? raw.message.trim().slice(0, 500) : undefined;
  let location: IncomingAlertEvent["location"];
  if (raw.location && typeof raw.location === "object") {
    const l = raw.location as Record<string, unknown>;
    const lat = num(l.latitude), lng = num(l.longitude);
    if (lat !== undefined && lng !== undefined) {
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return { ok: false, error: "invalid coordinates" };
      const st = l.state ?? l.locationState;
      location = { latitude: lat, longitude: lng, accuracyM: num(l.accuracyM), state: st === "INSIDE" || st === "OUTSIDE" || st === "UNKNOWN" ? st : undefined, ageSeconds: num(l.ageSeconds) };
    }
  }
  return { ok: true, event: {
    eventId, eventType: eventType as GuardAlertType,
    timestamp: typeof raw.timestamp === "string" || raw.timestamp instanceof Date ? raw.timestamp : new Date().toISOString(),
    message: message || undefined, shiftId: typeof raw.shiftId === "string" ? raw.shiftId : undefined, location,
    meta: typeof raw.meta === "object" && raw.meta ? (raw.meta as Record<string, unknown>) : undefined,
  } };
}

/** Where the guard was, in words the control room can act on. Never "outside" from a stale or vague fix. */
export function describeAlertLocation(l: IncomingAlertEvent["location"] | undefined, siteName: string | null): string {
  if (!l) return "No position available at the time of the alert";
  const age = l.ageSeconds != null && l.ageSeconds > 120 ? `, ${Math.round(l.ageSeconds / 60)} min old` : "";
  const acc = l.accuracyM != null ? ` ±${Math.round(l.accuracyM)} m` : "";
  const where = l.state === "INSIDE" ? `inside ${siteName ?? "the site"}` : l.state === "OUTSIDE" ? `outside ${siteName ?? "the site"}` : "position unverified";
  return `Last fix ${where}${acc}${age} · ${l.latitude.toFixed(5)}, ${l.longitude.toFixed(5)}`;
}

export async function applyAlertEvent(device: GatewayDevice, ev: IncomingAlertEvent, opts: { simulated?: boolean } = {}): Promise<{ outcome: string; alertId?: string }> {
  const now = new Date();
  const at = saneTimestamp(ev.timestamp, now);
  if (device.mode !== "GUARD" || !device.guardId) return { outcome: "ignored: device is not a guard phone" };
  const guard = await db.guard.findUnique({ where: { id: device.guardId }, include: { homeLocation: true } });
  if (!guard) return { outcome: "ignored: guard not found" };
  const meta = ALERT_META[ev.eventType];
  const shift = (ev.shiftId ? await db.shift.findFirst({ where: { id: ev.shiftId, guardId: guard.id }, include: { location: true, supervisor: true } }) : null) ?? (await findLiveShiftForGuard(guard.id, at));
  const site = shift?.location ?? guard.homeLocation ?? null;
  const who = `${guard.firstName} ${guard.lastName}`;
  const syncStatus = syncStatusFor(at, now);
  const late = syncStatus === "SYNCED_LATE" ? " (synced late)" : "";
  const whereText = describeAlertLocation(ev.location, site?.name ?? null);

  const alert = await db.guardAlert.create({ data: {
    eventId: ev.eventId, guardId: guard.id, gatewayDeviceId: device.id, shiftId: shift?.id ?? null, locationId: site?.id ?? null,
    type: ev.eventType, status: meta.requiresAck ? "OPEN" : "RESOLVED", requiresAck: meta.requiresAck, message: ev.message ?? null,
    latitude: ev.location?.latitude ?? null, longitude: ev.location?.longitude ?? null, accuracyM: ev.location?.accuracyM ?? null, locationState: ev.location?.state ?? null, locationAgeSeconds: ev.location?.ageSeconds ?? null,
    occurredAt: at, syncStatus, simulated: Boolean(opts.simulated), resolvedAt: meta.requiresAck ? null : now,
  } });

  // Incident for the serious ones, when we know where the guard is posted.
  let incidentId: string | undefined;
  if (meta.incident && site) {
    const inc = await createIncident({ guardId: guard.id, locationId: site.id, shiftId: shift?.id ?? null, category: meta.incident.category, severity: meta.incident.severity, source: "APP", supervisorId: shift?.supervisorId ?? guard.supervisorId, occurredAt: at, actorName: "guard app", description: `${meta.label} sent from the guard app at ${fmtTime(at)}${late}.${ev.message ? ` "${ev.message}"` : ""} ${whereText}.` });
    incidentId = inc.id;
    await db.guardAlert.update({ where: { id: alert.id }, data: { incidentId } });
  }

  // Shift: timeline line and, for the serious ones, a status that never downgrades.
  if (shift) {
    await recordEvent(shift.id, guard.id, meta.checkIn, { at, source: "APP", note: `${meta.label} from the app${late}${ev.message ? `: "${ev.message}"` : ""}. ${whereText}.` });
    if (meta.shiftStatus && LIVE.includes(shift.status) && (SHIFT_RANK[meta.shiftStatus] ?? 0) > (SHIFT_RANK[shift.status] ?? 0)) {
      await db.shift.update({ where: { id: shift.id }, data: { status: meta.shiftStatus, ...(meta.shiftStatus === "CRITICAL" ? { emergencyAt: at } : {}) } });
    }
  }

  const siteName = site?.name ?? "no site";
  const title = ev.eventType === "EMERGENCY"
    ? `EMERGENCY ALERT RECEIVED FROM ${who.toUpperCase()} — ${siteName.toUpperCase()} — ${fmtTime(at)}`
    : `${meta.label} · ${who} · ${siteName}`;
  const body = `${ev.message ? `"${ev.message}" · ` : ""}${whereText}${late}. ${meta.requiresAck ? `Acknowledge in Guard alerts; call ${guard.phone}.` : ""}${shift?.supervisor ? ` Supervisor: ${shift.supervisor.name}.` : ""}`.trim();
  await notify({ type: ev.eventType === "EMERGENCY" ? "EMERGENCY" : ev.eventType === "NEED_ASSISTANCE" ? "ASSISTANCE_REQUESTED" : ev.eventType === "INCIDENT_REPORT" ? "INCIDENT_REPORTED" : ev.eventType === "SECURITY_ALERT" ? "SECURITY_ALERT" : ev.eventType === "RUNNING_LATE" ? "RUNNING_LATE" : ev.eventType === "HANDOVER" ? "SHIFT_HANDOVER" : ev.eventType === "SHIFT_OK" ? "SHIFT_OK" : "STATUS_UPDATE", severity: meta.severity, title, body, guardId: guard.id, shiftId: shift?.id, incidentId, url: `/alerts?focus=${alert.id}` });

  return { outcome: `${meta.label}${shift ? " · on shift" : ""}${incidentId ? " · incident opened" : ""} · ${syncStatus}`, alertId: alert.id };
}

export async function acknowledgeAlert(id: string, actor: { userId: string; name: string }, note?: string) {
  const a = await db.guardAlert.findUniqueOrThrow({ where: { id }, include: { guard: true } });
  if (a.status !== "OPEN") return a;
  const now = new Date();
  const updated = await db.guardAlert.update({ where: { id }, data: { status: "ACKNOWLEDGED", acknowledgedAt: now, acknowledgedById: actor.userId, acknowledgementNote: note || null } });
  if (a.incidentId) await db.incident.updateMany({ where: { id: a.incidentId, status: "OPEN" }, data: { status: "ACKNOWLEDGED", acknowledgedAt: now } });
  if (a.shiftId) await recordEvent(a.shiftId, a.guardId, "ALERT_ACKNOWLEDGED", { source: "ADMIN", note: `${ALERT_META[a.type].label} acknowledged by ${actor.name}${note ? `: ${note}` : ""}.` });
  await audit({ userId: actor.userId, actor: actor.name, action: "ALERT_ACKNOWLEDGED", entity: "GuardAlert", entityId: id, details: { type: a.type, guard: `${a.guard.firstName} ${a.guard.lastName}`, note: note ?? null } });
  return updated;
}

export async function resolveAlert(id: string, actor: { userId: string; name: string }, note?: string) {
  const a = await db.guardAlert.findUniqueOrThrow({ where: { id }, include: { guard: true } });
  if (a.status === "RESOLVED") return a;
  const now = new Date();
  const updated = await db.guardAlert.update({ where: { id }, data: { status: "RESOLVED", resolvedAt: now, resolvedById: actor.userId, resolutionNote: note || null, ...(a.acknowledgedAt ? {} : { acknowledgedAt: now, acknowledgedById: actor.userId }) } });
  if (a.shiftId) await recordEvent(a.shiftId, a.guardId, "ADMIN_NOTE", { source: "ADMIN", note: `${ALERT_META[a.type].label} resolved by ${actor.name}${note ? `: ${note}` : ""}.` });
  await audit({ userId: actor.userId, actor: actor.name, action: "ALERT_RESOLVED", entity: "GuardAlert", entityId: id, details: { type: a.type, note: note ?? null } });
  return updated;
}

/** What the phone shows under each alert it sent: received, acknowledged by whom, resolved. */
export async function alertsForDevice(device: Pick<GatewayDevice, "id" | "guardId">, sinceHours = 48, limit = 30) {
  if (!device.guardId) return [];
  const rows = await db.guardAlert.findMany({ where: { guardId: device.guardId, occurredAt: { gte: new Date(Date.now() - sinceHours * 3600_000) } }, include: { acknowledgedBy: { select: { name: true } }, resolvedBy: { select: { name: true } } }, orderBy: { occurredAt: "desc" }, take: limit });
  return rows.map((a) => ({ eventId: a.eventId, type: a.type, status: a.status as GuardAlertStatus, receivedAt: a.receivedAt.toISOString(), acknowledgedAt: a.acknowledgedAt?.toISOString() ?? null, acknowledgedBy: a.acknowledgedBy?.name ?? null, acknowledgementNote: a.acknowledgementNote, resolvedAt: a.resolvedAt?.toISOString() ?? null, resolvedBy: a.resolvedBy?.name ?? null }));
}

export const alertInclude = { guard: { select: { id: true, firstName: true, lastName: true, guardNo: true, phone: true, photoUrl: true } }, location: { select: { id: true, name: true } }, shift: { select: { id: true, startAt: true, endAt: true, status: true } }, acknowledgedBy: { select: { name: true } }, resolvedBy: { select: { name: true } }, incident: { select: { id: true, incidentNo: true, status: true } } } as const;
