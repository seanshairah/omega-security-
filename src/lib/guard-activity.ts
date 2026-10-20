/**
 * The guard's operational timeline, merged from the tables that already hold the facts: location
 * events, guard alerts, calls, SMS, shift check-ins, location requests, device online/offline
 * audit rows, start-of-shift attendance, calls requested from the portal, incidents and messages
 * to the client. Newest first, cursor-paged by time so the workspace never renders hundreds of rows.
 */
import { db } from "@/lib/db";
import { ALERT_META } from "@/lib/gateway/alerts";
import { fmtCallDuration } from "@/lib/gateway/call-state";
import { REQUEST_STATUS_META } from "@/lib/location-request-state";
import { CHECK_IN_META } from "@/lib/attendance/check-in";
import { CALL_META } from "@/lib/call-request-state";
import { NOTIFY_STATUS, NOTIFY_TYPES } from "@/lib/client-notifications/policy";

import { ACTIVITY_CATEGORIES, type ActivityCategory, type ActivityItem, type ActivitySeverity } from "@/lib/guard-activity-types";
export { ACTIVITY_CATEGORIES };
export type { ActivityCategory, ActivityItem, ActivitySeverity };

const CHECKIN: Record<string, { title: string; severity: ActivitySeverity; category: ActivityCategory }> = {
  SHIFT_STARTED: { title: "Shift started", severity: "info", category: "shift" }, ARRIVAL_SMS_SENT: { title: "Arrival SMS sent", severity: "info", category: "shift" }, ARRIVAL_REMINDER_SENT: { title: "Arrival reminder sent", severity: "warning", category: "shift" },
  ARRIVAL_CONFIRMED: { title: "Arrival confirmed", severity: "success", category: "shift" }, ARRIVAL_DENIED: { title: "Arrival denied", severity: "critical", category: "shift" }, ARRIVAL_ESCALATED: { title: "Arrival not confirmed · escalated", severity: "critical", category: "shift" },
  WELFARE_SMS_SENT: { title: "Welfare check sent", severity: "info", category: "shift" }, WELFARE_OK: { title: "Welfare: all well", severity: "success", category: "shift" }, WELFARE_ASSISTANCE: { title: "Welfare: assistance requested", severity: "warning", category: "shift" }, WELFARE_INCIDENT: { title: "Welfare: incident", severity: "critical", category: "shift" }, WELFARE_MISSED: { title: "Welfare check missed", severity: "warning", category: "shift" },
  INCIDENT_REPORTED: { title: "Incident reported", severity: "critical", category: "shift" }, EMERGENCY: { title: "EMERGENCY", severity: "critical", category: "shift" }, HANDOVER_NOTICE: { title: "Handover notice", severity: "info", category: "shift" },
  COMPLETION_SMS_SENT: { title: "Completion SMS sent", severity: "info", category: "shift" }, COMPLETION_CONFIRMED: { title: "Shift completion confirmed", severity: "success", category: "shift" }, SHIFT_COMPLETED: { title: "Shift completed", severity: "success", category: "shift" }, SHIFT_CLOSED: { title: "Shift closed", severity: "info", category: "shift" },
  LOCATION_INSIDE: { title: "Location: inside the site", severity: "success", category: "geofence" }, LOCATION_OUTSIDE: { title: "Location: outside the site", severity: "critical", category: "geofence" }, LOCATION_EXIT: { title: "Left the site", severity: "critical", category: "geofence" }, LOCATION_RETURNED: { title: "Returned to the site", severity: "success", category: "geofence" }, LOCATION_UNAVAILABLE: { title: "Location unavailable", severity: "warning", category: "gps" },
  GUARD_OK: { title: "Shift going well", severity: "success", category: "shift" }, STATUS_UPDATE: { title: "Status update", severity: "info", category: "shift" }, SECURITY_ALERT: { title: "Security alert", severity: "critical", category: "shift" }, RUNNING_LATE: { title: "Running late", severity: "warning", category: "shift" },
};

const LOC: Record<string, { title: string; severity: ActivitySeverity; category: ActivityCategory }> = {
  SHIFT_STARTED: { title: "Monitoring started", severity: "info", category: "gps" }, LOCATION_CHECK: { title: "Location check", severity: "info", category: "gps" }, LOCATION_EXIT: { title: "Exited the geofence", severity: "critical", category: "geofence" },
  LOCATION_OUTSIDE: { title: "Still outside the geofence", severity: "critical", category: "geofence" }, LOCATION_RETURNED: { title: "Re-entered the geofence", severity: "success", category: "geofence" }, LOCATION_UNAVAILABLE: { title: "No usable GPS fix", severity: "warning", category: "gps" },
  LOCATION_VERIFICATION_OVERDUE: { title: "Location verification overdue", severity: "warning", category: "gps" }, LOCATION_CALL: { title: "Position at a call", severity: "info", category: "gps" },
};

export type ActivityQuery = { before?: Date; since?: Date; limit?: number; categories?: ActivityCategory[]; severity?: ActivitySeverity | "all" };

export async function guardActivity(guardId: string, q: ActivityQuery = {}): Promise<{ items: ActivityItem[]; nextBefore: string | null }> {
  const limit = Math.min(100, Math.max(10, q.limit ?? 50));
  const want = (c: ActivityCategory) => !q.categories?.length || q.categories.includes(c);
  const range = { ...(q.before ? { lt: q.before } : {}), ...(q.since ? { gt: q.since } : {}) };
  const timeFilter = Object.keys(range).length ? range : undefined;
  const take = limit + 1;
  const deviceIds = want("device") ? (await db.gatewayDevice.findMany({ where: { guardId }, select: { id: true } })).map((d) => d.id) : [];

  const [locs, alerts, calls, sms, checkIns, requests, audits] = await Promise.all([
    want("gps") || want("geofence") ? db.locationEvent.findMany({ where: { guardId, ...(timeFilter ? { occurredAt: timeFilter } : {}) }, orderBy: { occurredAt: "desc" }, take }) : [],
    want("alert") ? db.guardAlert.findMany({ where: { guardId, ...(timeFilter ? { occurredAt: timeFilter } : {}) }, orderBy: { occurredAt: "desc" }, take, include: { acknowledgedBy: { select: { name: true } } } }) : [],
    want("call") ? db.callLog.findMany({ where: { guardId, ...(timeFilter ? { startedAt: timeFilter } : {}) }, orderBy: { startedAt: "desc" }, take }) : [],
    want("sms") ? db.smsMessage.findMany({ where: { guardId, ...(timeFilter ? { createdAt: timeFilter } : {}) }, orderBy: { createdAt: "desc" }, take }) : [],
    want("shift") || want("geofence") || want("client") ? db.shiftCheckIn.findMany({ where: { guardId, ...(timeFilter ? { at: timeFilter } : {}) }, orderBy: { at: "desc" }, take, include: { shift: { select: { id: true, location: { select: { name: true } } } } } }) : [],
    want("request") ? db.deviceLocationRequest.findMany({ where: { guardId, ...(timeFilter ? { requestedAt: timeFilter } : {}) }, orderBy: { requestedAt: "desc" }, take, include: { requestedBy: { select: { name: true } } } }) : [],
    deviceIds.length ? db.auditLog.findMany({ where: { entity: "GatewayDevice", entityId: { in: deviceIds }, action: { in: ["GATEWAY_ONLINE", "GATEWAY_OFFLINE", "GATEWAY_ACTIVATED", "GATEWAY_REVOKED", "GATEWAY_DISABLED", "GATEWAY_ENABLED"] }, ...(timeFilter ? { createdAt: timeFilter } : {}) }, orderBy: { createdAt: "desc" }, take }) : [],
  ]);
  const [attendance, callRequests, incidents, clientMsgs] = await Promise.all([
    // One row per shift; it is dated by its last change, so a verified arrival and a later escalation do not both show.
    want("attendance") ? db.attendanceCheckIn.findMany({ where: { guardId, ...(timeFilter ? { updatedAt: timeFilter } : {}) }, orderBy: { updatedAt: "desc" }, take, include: { shift: { select: { location: { select: { name: true } } } } } }) : [],
    want("call") ? db.callRequest.findMany({ where: { guardId, ...(timeFilter ? { requestedAt: timeFilter } : {}) }, orderBy: { requestedAt: "desc" }, take, include: { requestedBy: { select: { name: true } }, gatewayDevice: { select: { deviceName: true } } } }) : [],
    want("incident") ? db.incident.findMany({ where: { guardId, ...(timeFilter ? { occurredAt: timeFilter } : {}) }, orderBy: { occurredAt: "desc" }, take }) : [],
    want("client") ? db.clientNotification.findMany({ where: { guardId, ...(timeFilter ? { createdAt: timeFilter } : {}) }, orderBy: { createdAt: "desc" }, take, include: { client: { select: { name: true } }, sentBy: { select: { name: true } } } }) : [],
  ]);

  const items: ActivityItem[] = [];
  for (const e of locs) {
    const m = LOC[e.eventType] ?? { title: e.eventType, severity: "info" as const, category: "gps" as const };
    if (!want(m.category)) continue;
    const parts = [e.distanceM != null ? `${e.distanceM} m from site` : null, e.accuracyM != null ? `±${Math.round(e.accuracyM)} m` : null, e.reason ? e.reason.replace(/_/g, " ") : null, e.mock ? "mock provider" : null].filter(Boolean);
    items.push({ id: `loc:${e.id}`, at: e.occurredAt.toISOString(), category: m.category, severity: e.eventType === "LOCATION_CHECK" && e.locationState === "OUTSIDE" ? "critical" : m.severity, title: m.title, detail: parts.join(" · ") || undefined, href: e.shiftId ? `/shifts/${e.shiftId}` : undefined, late: e.syncStatus === "SYNCED_LATE" });
  }
  for (const a of alerts) {
    const m = ALERT_META[a.type];
    items.push({ id: `alert:${a.id}`, at: a.occurredAt.toISOString(), category: "alert", severity: a.type === "EMERGENCY" ? "critical" : m.severity === "WARNING" ? "warning" : m.tone === "ok" ? "success" : "info", title: m.label, detail: [a.message, a.status === "ACKNOWLEDGED" ? `acknowledged by ${a.acknowledgedBy?.name ?? "operations"}` : a.status === "RESOLVED" ? "resolved" : a.requiresAck ? "awaiting acknowledgement" : null].filter(Boolean).join(" · ") || undefined, href: `/alerts`, late: a.syncStatus === "SYNCED_LATE" });
  }
  for (const c of calls) {
    items.push({ id: `call:${c.id}`, at: c.startedAt.toISOString(), category: "call", severity: c.status === "MISSED" ? "warning" : "info", title: `${c.direction === "INCOMING" ? "Call from guard" : "Call to guard"} · ${c.status.toLowerCase()}`, detail: [c.durationSeconds != null ? fmtCallDuration(c.durationSeconds) : null, c.locationState ? `location ${c.locationState.toLowerCase()}` : null].filter(Boolean).join(" · ") || undefined, href: `/calls?guardId=${guardId}` });
  }
  for (const s of sms) {
    items.push({ id: `sms:${s.id}`, at: s.createdAt.toISOString(), category: "sms", severity: s.status === "FAILED" ? "warning" : s.type === "EMERGENCY" ? "critical" : "info", title: `${s.direction === "INBOUND" ? "SMS from guard" : "SMS to guard"} · ${s.type.toLowerCase().replace(/_/g, " ")}`, detail: `${s.body.slice(0, 120)}${s.body.length > 120 ? "…" : ""}${s.interpretedAs ? ` · read as ${s.interpretedAs.toLowerCase()}` : ""}${s.status === "FAILED" ? " · failed" : ""}`, href: `/sms` });
  }
  // A message sent through the client-notification service has its own entry below; the shift
  // note it also writes is shown only for older messages, which have nothing else.
  const notifiedShifts = new Set(clientMsgs.map((n) => n.shiftId).filter(Boolean));
  for (const k of checkIns) {
    const m = CHECKIN[k.type] ?? { title: k.type.toLowerCase().replace(/_/g, " "), severity: "info" as const, category: "shift" as const };
    if (!want(m.category)) continue;
    if (k.type === "CLIENT_NOTIFIED" && notifiedShifts.has(k.shiftId)) continue;
    items.push({ id: `chk:${k.id}`, at: k.at.toISOString(), category: m.category, severity: m.severity, title: m.title, detail: [k.note, k.shift?.location?.name].filter(Boolean).join(" · ") || undefined, href: `/shifts/${k.shiftId}` });
  }
  for (const r of requests) {
    const meta = REQUEST_STATUS_META[r.status];
    items.push({ id: `req:${r.id}`, at: r.requestedAt.toISOString(), category: "request", severity: r.status === "COMPLETED" ? "success" : r.status === "FAILED" ? "warning" : r.status === "EXPIRED" ? "warning" : "info", title: `GPS request · ${meta.label.toLowerCase()}`, detail: [r.requestedBy ? `by ${r.requestedBy.name}` : null, r.accuracyM != null ? `±${Math.round(r.accuracyM)} m` : null, r.failureReason ? r.failureReason.toLowerCase().replace(/_/g, " ") : null, r.mock ? "mock location" : null].filter(Boolean).join(" · ") || undefined });
  }
  for (const a of audits) {
    items.push({ id: `aud:${a.id}`, at: a.createdAt.toISOString(), category: "device", severity: a.action === "GATEWAY_OFFLINE" || a.action === "GATEWAY_REVOKED" || a.action === "GATEWAY_DISABLED" ? "warning" : "success", title: a.action === "GATEWAY_ONLINE" ? "Device connected" : a.action === "GATEWAY_OFFLINE" ? "Device disconnected" : a.action.toLowerCase().replace("gateway_", "device ").replace(/_/g, " "), href: a.entityId ? `/gateways/${a.entityId}` : undefined });
  }
  const SEV = { ok: "success", warn: "warning", critical: "critical", info: "info", neutral: "info", muted: "info" } as const;
  for (const a of attendance) {
    const m = CHECK_IN_META[a.status];
    items.push({ id: `att:${a.id}`, at: a.updatedAt.toISOString(), category: "attendance", severity: SEV[m.tone], title: `Check-in · ${m.label.toLowerCase()}`, detail: [a.shift?.location?.name, a.source !== "NONE" ? `by ${a.source.toLowerCase().replace(/_/g, " ")}` : null, a.distanceM != null ? `${Math.round(a.distanceM)} m from site` : null, a.accuracyM != null ? `±${Math.round(a.accuracyM)} m` : null].filter(Boolean).join(" · ") || undefined, href: `/shifts/${a.shiftId}` });
  }
  for (const r of callRequests) {
    const m = CALL_META[r.status];
    items.push({ id: `creq:${r.id}`, at: r.requestedAt.toISOString(), category: "call", severity: SEV[m.tone], title: `Call requested from the portal · ${m.label.toLowerCase()}`, detail: [r.requestedBy ? `by ${r.requestedBy.name}` : null, r.gatewayDevice ? `via ${r.gatewayDevice.deviceName}` : null, r.reason].filter(Boolean).join(" · ") || undefined });
  }
  for (const i of incidents) {
    items.push({ id: `inc:${i.id}`, at: i.occurredAt.toISOString(), category: "incident", severity: i.category === "EMERGENCY" || i.severity === "CRITICAL" ? "critical" : i.severity === "HIGH" ? "warning" : "info", title: `${i.incidentNo} · ${i.category.toLowerCase().replace(/_/g, " ")}`, detail: [i.status.toLowerCase(), i.description.slice(0, 100)].join(" · "), href: `/incidents/${i.id}` });
  }
  for (const n of clientMsgs) {
    const st = NOTIFY_STATUS[n.status];
    items.push({ id: `cn:${n.id}`, at: (n.sentAt ?? n.createdAt).toISOString(), category: "client", severity: n.status === "FAILED" ? "warning" : n.status === "PENDING_APPROVAL" ? "warning" : "info", title: `Client message · ${NOTIFY_TYPES[n.type].label.toLowerCase()} · ${st.label.toLowerCase()}`, detail: [n.client.name, `${n.channel === "EMAIL" ? "email" : "SMS"} to ${n.recipient}`, n.sentBy ? `by ${n.sentBy.name}` : n.rule ? "automatic" : null, n.failureReason].filter(Boolean).join(" · "), href: n.locationId ? `/locations/${n.locationId}#client-messages` : undefined });
  }
  const filtered = q.severity && q.severity !== "all" ? items.filter((i) => i.severity === q.severity) : items;
  filtered.sort((a, b) => b.at.localeCompare(a.at));
  const page = filtered.slice(0, limit);
  const more = filtered.length > limit;
  return { items: page, nextBefore: more && page.length ? page[page.length - 1].at : null };
}
