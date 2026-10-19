/**
 * Event intake from a gateway phone (or the simulator). Every event is stored raw with its
 * device-generated `eventId`, so a retry after a dropped acknowledgement is a no-op. Call
 * events are folded into one CallLog row per (device, callId) through the pure reducer.
 */
import { db } from "@/lib/db";
import type { CallLog, GatewayDevice, Prisma } from "@prisma/client";
import { normalisePhone } from "@/lib/phone";
import { findLiveShiftForGuard, recordEvent } from "@/lib/services/shifts";
import { notify } from "@/lib/notifications";
import { getSettingBool } from "@/lib/settings";
import { fmtTime } from "@/lib/time";
import { formatPhone } from "@/lib/phone";
import { CALL_EVENT_TYPES, DEVICE_EVENT_TYPES, fmtCallDuration, initialCallState, isTerminal, reduceCall, saneTimestamp, type IncomingGatewayEvent } from "./call-state";
import { LOCATION_EVENT_TYPES, applyLocationEvent, validateLocationEvent, type IncomingLocationEvent } from "./location-events";
import { ALERT_EVENT_TYPES, applyAlertEvent, validateAlertEvent, type IncomingAlertEvent } from "./alerts";
import { LOCATION_REQUEST_EVENT_TYPES, applyLocationRequestResult, validateLocationRequestResult, type IncomingLocationRequestResult } from "./location-requests";
import type { LocationState } from "@prisma/client";

export type EventAck = { eventId: string; status: "ok" | "duplicate" | "rejected"; callLogId?: string; error?: string };

const STATUS_EVENT_TYPES = ["DEVICE_STATUS", "HEARTBEAT"] as const;
const ALL_TYPES: string[] = [...CALL_EVENT_TYPES, ...DEVICE_EVENT_TYPES, ...LOCATION_EVENT_TYPES, ...STATUS_EVENT_TYPES, ...ALERT_EVENT_TYPES, ...LOCATION_REQUEST_EVENT_TYPES];

export type AnyIncomingEvent = ({ kind: "call" | "device" | "status" } & IncomingGatewayEvent) | ({ kind: "location" } & IncomingLocationEvent) | ({ kind: "alert" } & IncomingAlertEvent) | ({ kind: "location_request" } & IncomingLocationRequestResult);

export function validateEvent(raw: unknown): { ok: true; event: AnyIncomingEvent } | { ok: false; error: string; eventId?: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "event must be an object" };
  const e = raw as Record<string, unknown>;
  const eventId = typeof e.eventId === "string" ? e.eventId.trim() : "";
  if (!eventId || eventId.length > 120) return { ok: false, error: "eventId is required" };
  const eventType = typeof e.eventType === "string" ? e.eventType.toUpperCase() : "";
  if (!ALL_TYPES.includes(eventType)) return { ok: false, error: `unknown eventType ${eventType || "(blank)"}`, eventId };
  if ((LOCATION_EVENT_TYPES as readonly string[]).includes(eventType)) {
    const v = validateLocationEvent(e, eventId, eventType);
    return v.ok ? { ok: true, event: { kind: "location", ...v.event } } : { ok: false, error: v.error, eventId };
  }
  if ((LOCATION_REQUEST_EVENT_TYPES as readonly string[]).includes(eventType)) {
    const v = validateLocationRequestResult(e, eventId);
    return v.ok ? { ok: true, event: { kind: "location_request", ...v.event } } : { ok: false, error: v.error, eventId };
  }
  if ((ALERT_EVENT_TYPES as readonly string[]).includes(eventType)) {
    const v = validateAlertEvent(e, eventId, eventType);
    return v.ok ? { ok: true, event: { kind: "alert", ...v.event } } : { ok: false, error: v.error, eventId };
  }
  const timestamp = typeof e.timestamp === "string" || e.timestamp instanceof Date ? e.timestamp : new Date().toISOString();
  const isCall = (CALL_EVENT_TYPES as readonly string[]).includes(eventType);
  const callId = typeof e.callId === "string" ? e.callId.trim() : "";
  if (isCall && !callId) return { ok: false, error: "callId is required for call events", eventId };
  const phoneNumber = typeof e.phoneNumber === "string" ? e.phoneNumber.trim() : "";
  const direction = e.direction === "OUTGOING" ? "OUTGOING" : e.direction === "INCOMING" ? "INCOMING" : undefined;
  const durationSeconds = typeof e.durationSeconds === "number" && Number.isFinite(e.durationSeconds) ? Math.max(0, Math.round(e.durationSeconds)) : undefined;
  const answered = typeof e.answered === "boolean" ? e.answered : undefined;
  const kind = isCall ? "call" : (STATUS_EVENT_TYPES as readonly string[]).includes(eventType) ? "status" : "device";
  const meta = typeof e.meta === "object" && e.meta ? (e.meta as Record<string, unknown>) : undefined;
  // Guard devices attach their latest fix to call events.
  const loc = typeof e.location === "object" && e.location ? (e.location as Record<string, unknown>) : undefined;
  return { ok: true, event: { kind, eventId, eventType: eventType as IncomingGatewayEvent["eventType"], callId: callId || undefined, phoneNumber: phoneNumber || undefined, direction, timestamp, durationSeconds, answered, meta: loc ? { ...(meta ?? {}), location: loc } : meta } };
}

/** Match a caller to exactly one guard. Never guesses: no match or an ambiguous match is an unknown caller. */
export async function matchGuardByPhone(normalized: string) {
  if (!normalized || normalized.length < 8) return null;
  const guards = await db.guard.findMany({ where: { phone: normalized }, take: 2 });
  if (guards.length !== 1) return null;
  return guards[0];
}

export async function processGatewayEvents(device: GatewayDevice, rawEvents: unknown[], opts: { simulated?: boolean; ip?: string | null } = {}): Promise<EventAck[]> {
  const acks: EventAck[] = [];
  const ordered = rawEvents.map((r) => ({ r, v: validateEvent(r) }));
  // Replay in time order so a drained offline queue still reduces correctly.
  ordered.sort((a, b) => (a.v.ok && b.v.ok ? new Date(a.v.event.timestamp).getTime() - new Date(b.v.event.timestamp).getTime() : 0));
  for (const { v } of ordered) {
    if (!v.ok) { acks.push({ eventId: v.eventId ?? "", status: "rejected", error: v.error }); continue; }
    acks.push(await processOne(device, v.event, opts));
  }
  return acks;
}

/** DEVICE_STATUS / HEARTBEAT events carry permission and monitoring state from guard phones. */
async function applyStatusEvent(device: GatewayDevice, ev: IncomingGatewayEvent): Promise<string> {
  const m = ev.meta ?? {};
  const s = (k: string) => (typeof m[k] === "string" ? (m[k] as string).slice(0, 30) : undefined);
  await db.gatewayDevice.update({ where: { id: device.id }, data: { ...(s("locationPermission") ? { locationPermission: s("locationPermission") } : {}), ...(s("callPermission") ? { callPermission: s("callPermission") } : {}), ...(s("monitoringState") ? { monitoringState: s("monitoringState") } : {}), ...(m.mock === true ? { mockLocationSeen: true } : {}) } });
  return `status: ${s("monitoringState") ?? "—"} · location ${s("locationPermission") ?? "—"}`;
}

async function processOne(device: GatewayDevice, ev: AnyIncomingEvent, opts: { simulated?: boolean; ip?: string | null }): Promise<EventAck> {
  const now = new Date();
  const at = saneTimestamp(ev.timestamp, now);
  // 1. raw record; the unique eventId is the deduplication key
  try {
    await db.gatewayEvent.create({ data: { eventId: ev.eventId, gatewayDeviceId: device.id, eventType: ev.eventType, callId: ev.kind === "alert" || ev.kind === "location_request" ? null : ev.callId ?? null, phoneNumber: ev.kind === "location" || ev.kind === "alert" || ev.kind === "location_request" ? null : ev.phoneNumber ?? null, occurredAt: at, payload: { ...ev, timestamp: String(ev.timestamp), simulated: Boolean(opts.simulated) } as Prisma.InputJsonObject } });
  } catch (e) {
    if (/Unique constraint/.test((e as Error).message)) {
      const existing = ev.kind === "call" && ev.callId ? await db.callLog.findUnique({ where: { gatewayDeviceId_callId: { gatewayDeviceId: device.id, callId: ev.callId } } }) : null;
      return { eventId: ev.eventId, status: "duplicate", callLogId: existing?.id };
    }
    throw e;
  }
  let outcome = "stored";
  let callLogId: string | undefined;
  try {
    if (ev.kind === "location") {
      outcome = (await applyLocationEvent(device, ev, { simulated: opts.simulated })).outcome;
    } else if (ev.kind === "alert") {
      outcome = (await applyAlertEvent(device, ev, { simulated: opts.simulated })).outcome;
    } else if (ev.kind === "location_request") {
      outcome = (await applyLocationRequestResult(device, ev)).outcome;
    } else if (ev.kind === "status") {
      outcome = await applyStatusEvent(device, ev);
    } else if (ev.eventType === "DEVICE_ONLINE" || ev.eventType === "DEVICE_OFFLINE") {
      outcome = await applyDeviceEvent(device, ev, at);
    } else {
      const r = await applyCallEvent(device, ev, at, Boolean(opts.simulated));
      outcome = r.outcome;
      callLogId = r.callLogId;
    }
  } finally {
    await db.gatewayEvent.update({ where: { eventId: ev.eventId }, data: { outcome } });
  }
  return { eventId: ev.eventId, status: "ok", callLogId };
}

async function applyDeviceEvent(device: GatewayDevice, ev: IncomingGatewayEvent, at: Date): Promise<string> {
  if (device.status === "DISABLED" || device.status === "REVOKED") return "ignored: device not active";
  if (ev.eventType === "DEVICE_ONLINE") {
    await db.gatewayDevice.update({ where: { id: device.id }, data: { status: "ONLINE", lastSeenAt: at > new Date() ? new Date() : at } });
    return "device online";
  }
  await db.gatewayDevice.update({ where: { id: device.id }, data: { status: "OFFLINE" } });
  return "device offline (announced by phone)";
}

async function applyCallEvent(device: GatewayDevice, ev: IncomingGatewayEvent, at: Date, simulated: boolean): Promise<{ outcome: string; callLogId: string }> {
  const callId = ev.callId!;
  const existing = await db.callLog.findUnique({ where: { gatewayDeviceId_callId: { gatewayDeviceId: device.id, callId } } });
  if (!existing) return createCall(device, ev, at, simulated);
  const before = { direction: existing.direction, status: existing.status, startedAt: existing.startedAt, answeredAt: existing.answeredAt, endedAt: existing.endedAt, durationSeconds: existing.durationSeconds };
  const after = reduceCall(before, ev, at);
  if (after === before) return { outcome: `no change (${existing.status})`, callLogId: existing.id };
  const updated = await db.callLog.update({ where: { id: existing.id }, data: { status: after.status, startedAt: after.startedAt, answeredAt: after.answeredAt, endedAt: after.endedAt, durationSeconds: after.durationSeconds } });
  await afterTransition(device, updated, before.status, at);
  return { outcome: `${before.status} → ${after.status}`, callLogId: updated.id };
}

async function createCall(device: GatewayDevice, ev: IncomingGatewayEvent, at: Date, simulated: boolean): Promise<{ outcome: string; callLogId: string }> {
  const raw = ev.phoneNumber ?? "";
  const normalized = raw ? safeNormalise(raw) : "";
  // On a guard's own phone the call is the guard's, whoever is on the other end (usually operations).
  const guard = device.mode === "GUARD" && device.guardId ? await db.guard.findUnique({ where: { id: device.guardId } }) : normalized ? await matchGuardByPhone(normalized) : null;
  const fix = device.mode === "GUARD" ? readFix(ev) : null;
  const shift = guard ? await findLiveShiftForGuard(guard.id, at) : null;
  const state = initialCallState(ev, at);
  const unknown = !guard;
  const call = await db.callLog.create({
    data: {
      callId: ev.callId!, gatewayDeviceId: device.id,
      guardId: guard?.id ?? null, shiftId: shift?.id ?? null,
      locationId: shift?.locationId ?? device.locationId ?? null,
      clientId: shift?.location.clientId ?? (device.locationId ? (await db.location.findUnique({ where: { id: device.locationId }, select: { clientId: true } }))?.clientId ?? null : null),
      phoneNumber: raw || "unknown", normalizedPhoneNumber: normalized || "unknown",
      direction: state.direction, status: state.status, startedAt: state.startedAt, answeredAt: state.answeredAt, endedAt: state.endedAt, durationSeconds: state.durationSeconds,
      unknownCaller: unknown, simulated,
      latitude: fix?.latitude ?? null, longitude: fix?.longitude ?? null, locationState: fix?.state ?? null,
    },
  });
  await db.gatewayDevice.update({ where: { id: device.id }, data: { lastCallAt: at } });
  await correlateCall(call.id, device, normalized, state.direction, at);
  if (shift) {
    const who = `${guard!.firstName} ${guard!.lastName}`;
    await recordEvent(shift.id, guard!.id, state.direction === "INCOMING" ? "CALL_INCOMING" : "CALL_OUTGOING", { at: state.startedAt, source: "APP", note: `${state.direction === "INCOMING" ? "Incoming call from" : "Outgoing call to"} ${who} via ${device.deviceName}.` });
  }
  if (unknown && raw && state.direction === "INCOMING" && device.mode !== "GUARD" && (await getSettingBool("gateway.unknownCallerAlert"))) {
    await notify({ type: "UNKNOWN_CALLER", severity: "INFO", title: `Unknown caller on ${device.deviceName}`, body: `${formatPhone(normalized || raw)} called at ${fmtTime(at)} and is not a registered guard.`, url: `/calls/${call.id}` });
  }
  // A call from a guard's own registered phone may be the shift check-in. Never throws into the
  // call pipeline: a failure here must not lose the call record.
  let checkIn = "";
  try {
    const { handleCall } = await import("@/lib/attendance/check-in-service");
    const r = await handleCall(call, device, at);
    if (r && !r.startsWith("no ") && r !== "check-in disabled" && r !== "not the guard's registered device") checkIn = ` · check-in: ${r}`;
  } catch (e) {
    console.warn("[check-in] call handling failed", (e as Error).message);
  }
  // A single event can already be terminal (for example a CALL_MISSED arriving first).
  await afterTransition(device, call, "RINGING", at, true);
  return { outcome: `created ${call.status}${guard ? ` · ${guard.firstName} ${guard.lastName}` : " · unknown caller"}${shift ? " · on live shift" : ""}${checkIn}`, callLogId: call.id };
}

function readFix(ev: IncomingGatewayEvent): { latitude: number; longitude: number; state: LocationState } | null {
  const l = ev.meta?.location as Record<string, unknown> | undefined;
  if (!l || typeof l.latitude !== "number" || typeof l.longitude !== "number") return null;
  const st = l.locationState;
  return { latitude: l.latitude, longitude: l.longitude, state: st === "INSIDE" || st === "OUTSIDE" ? st : "UNKNOWN" };
}

/**
 * Link the two sides of one conversation: an operations-gateway call and a guard-device call with
 * the same number, opposite directions, within 90 seconds. Both rows point at each other.
 */
async function correlateCall(callId: string, device: GatewayDevice, normalized: string, direction: CallLog["direction"], at: Date) {
  if (!normalized || normalized === "unknown") return;
  const other = await db.callLog.findFirst({
    where: { id: { not: callId }, gatewayDeviceId: { not: device.id }, correlatedCallId: null, direction: direction === "INCOMING" ? "OUTGOING" : "INCOMING", startedAt: { gte: new Date(at.getTime() - 90_000), lte: new Date(at.getTime() + 90_000) }, gateway: { mode: device.mode === "GUARD" ? "OPERATIONS_GATEWAY" : "GUARD" },
      ...(device.mode === "GUARD" ? { normalizedPhoneNumber: device.phoneNumber } : { guard: { devices: { some: { phoneNumber: normalized } } } }) },
    orderBy: { startedAt: "desc" },
  });
  if (!other) return;
  await db.callLog.update({ where: { id: callId }, data: { correlatedCallId: other.id } });
  await db.callLog.update({ where: { id: other.id }, data: { correlatedCallId: callId } });
}

function safeNormalise(raw: string): string {
  try { return normalisePhone(raw); } catch { return raw; }
}

/** Timeline entries and alerts once a call changes state. */
async function afterTransition(device: GatewayDevice, call: CallLog, previous: CallLog["status"], at: Date, created = false) {
  if (call.status === previous && !created) return;
  if (created && call.status === "RINGING") return;
  const guard = call.guardId ? await db.guard.findUnique({ where: { id: call.guardId } }) : null;
  const who = guard ? `${guard.firstName} ${guard.lastName}` : formatPhone(call.normalizedPhoneNumber);
  if (call.shiftId && guard) {
    if (call.status === "ANSWERED") await recordEvent(call.shiftId, guard.id, "CALL_ANSWERED", { at: call.answeredAt ?? at, source: "APP", note: `Call with ${who} answered on ${device.deviceName}.` });
    if (call.status === "ENDED") await recordEvent(call.shiftId, guard.id, "CALL_ENDED", { at: call.endedAt ?? at, source: "APP", note: `Call ended · ${fmtCallDuration(call.durationSeconds)}.` });
    if (call.status === "MISSED") await recordEvent(call.shiftId, guard.id, "CALL_MISSED", { at: call.endedAt ?? at, source: "APP", note: `Missed call from ${who} on ${device.deviceName}.` });
  }
  if (call.status === "MISSED" && call.direction === "INCOMING" && guard && device.mode !== "GUARD") {
    const onDuty = Boolean(call.shiftId);
    if (onDuty || (await getSettingBool("gateway.missedCallAlert"))) {
      await notify({
        type: "MISSED_CALL", severity: onDuty ? "CRITICAL" : "WARNING",
        title: onDuty ? `ACTIVE GUARD MISSED CALL · ${who}` : `Missed call from ${who}`,
        body: `${who} called ${device.deviceName} at ${fmtTime(call.startedAt)} and nobody answered. Call back on ${formatPhone(guard.phone)}.`,
        guardId: guard.id, shiftId: call.shiftId, url: `/calls/${call.id}`,
      });
    }
  }
  if (isTerminal(call.status) || call.status === "ANSWERED") await db.gatewayDevice.update({ where: { id: device.id }, data: { lastCallAt: at } });
}

/** Link an unknown caller's call (and every other call from that number) to a guard. */
export async function linkUnknownCaller(callId: string, guardId: string, actor: { userId: string; name: string }) {
  const call = await db.callLog.findUnique({ where: { id: callId } });
  if (!call) throw new Error("Call not found");
  const guard = await db.guard.findUnique({ where: { id: guardId } });
  if (!guard) throw new Error("Guard not found");
  const r = await db.callLog.updateMany({ where: { normalizedPhoneNumber: call.normalizedPhoneNumber, unknownCaller: true }, data: { guardId: guard.id, unknownCaller: false, unknownResolution: "LINKED" } });
  await db.auditLog.create({ data: { userId: actor.userId, actor: actor.name, action: "CALL_LINKED_TO_GUARD", entity: "CallLog", entityId: callId, details: { guardId, phone: call.normalizedPhoneNumber, updated: r.count } } });
  return r.count;
}

export async function resolveUnknownCaller(callId: string, resolution: "IGNORED" | "BLOCKED", actor: { userId: string; name: string }) {
  const call = await db.callLog.findUnique({ where: { id: callId } });
  if (!call) throw new Error("Call not found");
  const r = await db.callLog.updateMany({ where: { normalizedPhoneNumber: call.normalizedPhoneNumber, unknownCaller: true, unknownResolution: null }, data: { unknownResolution: resolution } });
  await db.auditLog.create({ data: { userId: actor.userId, actor: actor.name, action: resolution === "BLOCKED" ? "CALLER_BLOCKED" : "CALLER_IGNORED", entity: "CallLog", entityId: callId, details: { phone: call.normalizedPhoneNumber, updated: r.count } } });
  return r.count;
}
