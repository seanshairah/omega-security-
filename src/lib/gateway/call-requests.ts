/**
 * "Call this guard" from the portal, placed by an operations gateway phone.
 *
 * The portal never dials. It creates a CallRequest for one gateway phone; that phone fetches it as
 * a PLACE_CALL command, shows it to the operator, and dials when the operator taps Call. Android
 * does not allow an app in the background to start a call, and nothing here tries to get round
 * that: no accessibility automation, no hidden screens.
 *
 * What the portal shows is therefore only ever what the phone reported or recorded:
 * DELIVERED and AWAITING_CONFIRMATION mean nothing has rung; DIALING means the operator confirmed;
 * CONNECTED, COMPLETED and NO_ANSWER come from the phone's own record of that call.
 */
import { db } from "@/lib/db";
import type { CallLog, CallRequest, GatewayDevice, Prisma } from "@prisma/client";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { getSettingNumber } from "@/lib/settings";
import { isValidPhone, normalisePhone } from "@/lib/phone";
import { effectiveStatus } from "./service";
import { findLiveShiftForGuard } from "@/lib/services/shifts";
import {
  CALL_LIMITS, CALL_META, callRecordMatches, canCallTransition, isOpenCall, OPEN_CALL_STATES, PHONE_REPORTABLE, PRE_DIAL_STATES,
  stateFromCallRecord, versionAtLeast, type CallState, type PlaceCallCommand,
} from "@/lib/call-request-state";

export class CallRequestError extends Error { constructor(message: string, public status = 400) { super(message); } }

export type Actor = { userId: string | null; name: string };

export type GatewayOption = {
  id: string; deviceName: string; phoneNumber: string; siteName: string | null;
  eligible: boolean; reason: string | null; isDefault: boolean; lastSeenAt: Date | null;
};

async function ttlSeconds() {
  const v = await getSettingNumber("calls.requestTtlSeconds");
  return Math.min(CALL_LIMITS.ttlSecondsMax, Math.max(CALL_LIMITS.ttlSecondsMin, Number.isFinite(v) && v > 0 ? v : CALL_LIMITS.ttlSecondsDefault));
}

/** Why a gateway phone cannot place this call, or null when it can. */
function ineligibility(d: GatewayDevice, offlineMinutes: number, now: Date): string | null {
  if (d.mode !== "OPERATIONS_GATEWAY") return "not an operations gateway";
  if (d.activationStatus !== "ACTIVE") return "not activated";
  if (d.status === "REVOKED" || d.status === "DISABLED") return d.status.toLowerCase();
  if (effectiveStatus(d, offlineMinutes, now) !== "ONLINE") return "offline";
  if (!versionAtLeast(d.appVersion, CALL_LIMITS.minAppVersion)) return `app ${d.appVersion ?? "unknown"} cannot place calls; needs ${CALL_LIMITS.minAppVersion} or later`;
  if (d.placeCallPermission === "denied") return "phone permission denied on the device";
  return null;
}

/**
 * The gateway phones that could call this guard, best first: the site's default for the guard's
 * current shift, then a phone registered at that site, then any other eligible phone. Ineligible
 * phones are listed with the reason, so the operator sees why one is greyed out.
 */
export async function gatewayOptionsForGuard(guardId: string, now = new Date()): Promise<{ options: GatewayOption[]; siteId: string | null }> {
  const [devices, shift, offlineMinutes] = await Promise.all([
    db.gatewayDevice.findMany({ where: { mode: "OPERATIONS_GATEWAY", status: { notIn: ["REVOKED"] } }, include: { location: true }, orderBy: { lastSeenAt: "desc" } }),
    findLiveShiftForGuard(guardId, now),
    getSettingNumber("gateway.offlineMinutes"),
  ]);
  const site = shift ? await db.location.findUnique({ where: { id: shift.locationId }, select: { id: true, defaultGatewayId: true } }) : null;
  const rank = (d: GatewayDevice) => (site?.defaultGatewayId === d.id ? 0 : site && d.locationId === site.id ? 1 : 2);
  const options = devices.map((d) => {
    const reason = ineligibility(d, offlineMinutes || 5, now);
    return { id: d.id, deviceName: d.deviceName, phoneNumber: d.phoneNumber, siteName: d.location?.name ?? null, eligible: !reason, reason, isDefault: site?.defaultGatewayId === d.id, lastSeenAt: d.lastSeenAt, _rank: rank(d) };
  }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || a._rank - b._rank);
  return { options: options.map(({ _rank, ...o }) => { void _rank; return o; }), siteId: site?.id ?? null };
}

/**
 * Create the request. Idempotent on the portal's key (a double click is one call), and a guard
 * with a call already in progress gets that call back rather than a second one.
 */
export async function createCallRequest(input: { guardId: string; gatewayDeviceId?: string | null; shiftId?: string | null; incidentId?: string | null; reason?: string | null; idempotencyKey: string; actor: Actor }, now = new Date()): Promise<{ request: CallRequest; reused: boolean }> {
  const key = (input.idempotencyKey ?? "").trim();
  if (!key || key.length > 80) throw new CallRequestError("A request key is required.");
  const existing = await db.callRequest.findUnique({ where: { idempotencyKey: key } });
  if (existing) return { request: existing, reused: true };

  const guard = await db.guard.findUnique({ where: { id: input.guardId } });
  if (!guard) throw new CallRequestError("Guard not found.", 404);
  if (!guard.active) throw new CallRequestError("This guard is deactivated.", 409);
  let phone: string;
  try { phone = normalisePhone(guard.phone); } catch { throw new CallRequestError("The guard's phone number is not valid.", 422); }
  if (!isValidPhone(phone)) throw new CallRequestError(`The guard's phone number (${guard.phone}) is not a dialable number.`, 422);

  await expireCallRequests(now);
  const inProgress = await db.callRequest.findFirst({ where: { guardId: guard.id, status: { in: [...OPEN_CALL_STATES] } }, orderBy: { requestedAt: "desc" } });
  if (inProgress) return { request: inProgress, reused: true };

  if (input.actor.userId) {
    const mine = await db.callRequest.count({ where: { requestedById: input.actor.userId, requestedAt: { gte: new Date(now.getTime() - 60_000) } } });
    if (mine >= CALL_LIMITS.perUserPerMinute) throw new CallRequestError("Too many call requests in the last minute. Wait a moment.", 429);
  }
  const forGuard = await db.callRequest.count({ where: { guardId: guard.id, requestedAt: { gte: new Date(now.getTime() - 10 * 60_000) } } });
  if (forGuard >= CALL_LIMITS.perGuardPer10Minutes) throw new CallRequestError(`This guard has been called ${forGuard} times in ten minutes. Wait before calling again.`, 429);

  const { options } = await gatewayOptionsForGuard(guard.id, now);
  const chosen = input.gatewayDeviceId ? options.find((o) => o.id === input.gatewayDeviceId) : options.find((o) => o.eligible);
  if (input.gatewayDeviceId && !chosen) throw new CallRequestError("That gateway phone was not found.", 404);
  if (!chosen) throw new CallRequestError(options.length ? "No gateway phone can place this call: " + options.map((o) => `${o.deviceName} (${o.reason})`).join(", ") + "." : "No operations gateway phone is registered. Register one under Devices.", 409);
  if (!chosen.eligible) throw new CallRequestError(`${chosen.deviceName} cannot place calls: ${chosen.reason}.`, 409);

  const shift = input.shiftId ? await db.shift.findUnique({ where: { id: input.shiftId }, select: { id: true, guardId: true } }) : await findLiveShiftForGuard(guard.id, now);
  const request = await db.callRequest.create({
    data: {
      guardId: guard.id, gatewayDeviceId: chosen.id, requestedById: input.actor.userId,
      shiftId: shift && shift.guardId === guard.id ? shift.id : null, incidentId: input.incidentId ?? null,
      phoneNumber: phone, reason: input.reason?.trim().slice(0, 140) || null, idempotencyKey: key,
      requestedAt: now, expiresAt: new Date(now.getTime() + (await ttlSeconds()) * 1000),
    },
  });
  await audit({ userId: input.actor.userId, actor: input.actor.name, action: "CALL_REQUESTED", entity: "Guard", entityId: guard.id, details: { callRequestId: request.id, gatewayDeviceId: chosen.id, gateway: chosen.deviceName, shiftId: request.shiftId, incidentId: request.incidentId, reason: request.reason } });
  return { request, reused: false };
}

export async function cancelCallRequest(id: string, actor: Actor, now = new Date()) {
  const r = await db.callRequest.findUnique({ where: { id } });
  if (!r) throw new CallRequestError("Call request not found.", 404);
  // Once the phone has started the call, cancelling here would claim something untrue.
  if (!PRE_DIAL_STATES.includes(r.status)) return r;
  const updated = await move(r, "CANCELLED", { endedAt: now, failureReason: `Cancelled by ${actor.name}` });
  if (updated) await audit({ userId: actor.userId, actor: actor.name, action: "CALL_REQUEST_CANCELLED", entity: "Guard", entityId: r.guardId, details: { callRequestId: id } });
  return updated ?? r;
}

/** Guarded on the status we read: a concurrent change wins and this becomes a no-op. */
async function move(r: CallRequest, to: CallState, data: Prisma.CallRequestUpdateInput = {}): Promise<CallRequest | null> {
  if (r.status === to || !canCallTransition(r.status, to)) return null;
  const res = await db.callRequest.updateMany({ where: { id: r.id, status: r.status }, data: { ...(data as Prisma.CallRequestUncheckedUpdateManyInput), status: to } });
  return res.count === 1 ? db.callRequest.findUnique({ where: { id: r.id } }) : null;
}

/** Requests nobody acted on lapse; a "dialling" with no call record after ten minutes is reported as failed. */
export async function expireCallRequests(now = new Date()): Promise<number> {
  const lapsed = await db.callRequest.updateMany({ where: { status: { in: [...PRE_DIAL_STATES] }, expiresAt: { lte: now } }, data: { status: "TIMED_OUT", endedAt: now, failureReason: "Nobody acted on the request before it expired. No call was made." } });
  const stuck = await db.callRequest.updateMany({
    where: { status: "DIALING", callLogId: null, dialedAt: { lte: new Date(now.getTime() - CALL_LIMITS.dialingWithoutRecordMinutes * 60_000) } },
    data: { status: "FAILED", endedAt: now, failureReason: `The phone said it started the call, but no call record arrived within ${CALL_LIMITS.dialingWithoutRecordMinutes} minutes.` },
  });
  return lapsed.count + stuck.count;
}

/** PLACE_CALL commands for an operations gateway phone. First fetch marks the request delivered. */
export async function callCommandsForDevice(device: Pick<GatewayDevice, "id" | "mode">, now = new Date()): Promise<PlaceCallCommand[]> {
  if (device.mode !== "OPERATIONS_GATEWAY") return [];
  await expireCallRequests(now);
  const open = await db.callRequest.findMany({
    where: { gatewayDeviceId: device.id, status: { in: ["QUEUED", "DELIVERED", "AWAITING_CONFIRMATION"] }, expiresAt: { gt: now } },
    include: { guard: true, requestedBy: true }, orderBy: { requestedAt: "asc" }, take: 3,
  });
  const queued = open.filter((r) => r.status === "QUEUED").map((r) => r.id);
  if (queued.length) await db.callRequest.updateMany({ where: { id: { in: queued }, status: "QUEUED" }, data: { status: "DELIVERED", deliveredAt: now } });
  return open.map((r) => ({
    id: r.id, type: "PLACE_CALL", requestedAt: r.requestedAt.toISOString(), expiresAt: r.expiresAt.toISOString(),
    phoneNumber: r.phoneNumber, guardName: `${r.guard.firstName} ${r.guard.lastName}`, reason: r.reason, requestedBy: r.requestedBy?.name ?? null,
  }));
}

/**
 * The phone reports what happened on its screen. Only the device the request names may report,
 * and only the states a phone can know: shown, dialling, failed, or declined by the operator.
 */
export async function acknowledgeCallRequest(device: Pick<GatewayDevice, "id" | "deviceName">, id: string, status: string, detail: string | null, now = new Date()): Promise<CallRequest> {
  const r = await db.callRequest.findUnique({ where: { id } });
  if (!r || r.gatewayDeviceId !== device.id) throw new CallRequestError("Unknown call request for this device.", 404);
  if (!(PHONE_REPORTABLE as readonly string[]).includes(status)) throw new CallRequestError(`status must be one of ${PHONE_REPORTABLE.join(", ")}`);
  const to = status as CallState;
  if (to !== "DIALING" && to !== "FAILED" && r.expiresAt <= now && isOpenCall(r.status)) { await expireCallRequests(now); return (await db.callRequest.findUnique({ where: { id } }))!; }
  const why = detail?.slice(0, 200) ?? null;
  const data: Prisma.CallRequestUpdateInput =
    to === "AWAITING_CONFIRMATION" ? { shownAt: now, deliveredAt: r.deliveredAt ?? now }
    : to === "DIALING" ? { dialedAt: now, deliveredAt: r.deliveredAt ?? now, shownAt: r.shownAt ?? now }
    : to === "FAILED" ? { endedAt: now, failureReason: why ?? "The phone could not place the call." }
    : { endedAt: now, failureReason: why ? `Declined on ${device.deviceName}: ${why}` : `Declined on ${device.deviceName}` };
  const updated = await move(r, to, data);
  if (!updated) return r;
  await audit({ userId: null, actor: device.deviceName, action: `CALL_REQUEST_${to}`, entity: "Guard", entityId: r.guardId, details: { callRequestId: r.id, detail: why } });
  if (to === "FAILED" && r.requestedById) {
    await notify({ type: "CALL_REQUEST_FAILED", severity: "WARNING", title: "Call could not be placed", body: `${device.deviceName}: ${updated.failureReason}`, guardId: r.guardId, shiftId: r.shiftId ?? undefined });
  }
  return updated;
}

/**
 * A call record arrived or changed on a gateway phone. If it is the call a request asked for, the
 * request takes its state from the record. Never throws into the call pipeline.
 */
export async function correlateCallRequest(call: CallLog): Promise<string | null> {
  try {
    if (call.direction !== "OUTGOING") return null;
    const candidates = await db.callRequest.findMany({
      where: { gatewayDeviceId: call.gatewayDeviceId, phoneNumber: call.normalizedPhoneNumber, OR: [{ callLogId: call.id }, { callLogId: null, status: { in: ["DELIVERED", "AWAITING_CONFIRMATION", "DIALING", "CONNECTED"] } }] },
      orderBy: { requestedAt: "desc" }, take: 5,
    });
    const r = candidates.find((c) => c.callLogId === call.id) ?? candidates.find((c) => callRecordMatches(c, call));
    if (!r) return null;
    const to = stateFromCallRecord(call);
    if (!to) return null;
    const data: Prisma.CallRequestUpdateInput = {
      ...(r.callLogId ? {} : { callLogId: call.id }),
      ...(to === "DIALING" ? { dialedAt: r.dialedAt ?? call.startedAt } : {}),
      ...(to === "CONNECTED" ? { dialedAt: r.dialedAt ?? call.startedAt, connectedAt: call.answeredAt ?? call.startedAt } : {}),
      ...(to === "COMPLETED" || to === "NO_ANSWER" ? { dialedAt: r.dialedAt ?? call.startedAt, connectedAt: to === "COMPLETED" ? (call.answeredAt ?? r.connectedAt ?? call.startedAt) : null, endedAt: call.endedAt ?? new Date(), durationSeconds: call.durationSeconds ?? null } : {}),
    };
    if (r.status === to) {
      if (!r.callLogId) await db.callRequest.update({ where: { id: r.id }, data: { callLogId: call.id } });
      return r.id;
    }
    const updated = await move(r, to, data);
    if (!updated && !r.callLogId) await db.callRequest.update({ where: { id: r.id }, data: { callLogId: call.id } }).catch(() => undefined);
    return r.id;
  } catch (e) {
    console.warn("[call-request] correlation failed", (e as Error).message);
    return null;
  }
}

export type CallRequestView = {
  id: string; status: CallState; label: string; tone: string; detail: string;
  guardId: string; guardName: string; phoneNumber: string; gateway: string; requestedBy: string | null; reason: string | null;
  requestedAt: string; expiresAt: string; deliveredAt: string | null; shownAt: string | null; dialedAt: string | null; connectedAt: string | null; endedAt: string | null;
  durationSeconds: number | null; failureReason: string | null; callLogId: string | null; open: boolean;
};

export async function describeCallRequest(id: string): Promise<CallRequestView | null> {
  const r = await db.callRequest.findUnique({ where: { id }, include: { guard: true, gatewayDevice: true, requestedBy: true } });
  if (!r) return null;
  const iso = (d: Date | null) => d?.toISOString() ?? null;
  const m = CALL_META[r.status];
  return {
    id: r.id, status: r.status, label: m.label, tone: m.tone, detail: r.failureReason && (r.status === "FAILED" || r.status === "CANCELLED" || r.status === "TIMED_OUT") ? r.failureReason : m.detail,
    guardId: r.guardId, guardName: `${r.guard.firstName} ${r.guard.lastName}`, phoneNumber: r.phoneNumber, gateway: r.gatewayDevice.deviceName,
    requestedBy: r.requestedBy?.name ?? null, reason: r.reason, requestedAt: r.requestedAt.toISOString(), expiresAt: r.expiresAt.toISOString(),
    deliveredAt: iso(r.deliveredAt), shownAt: iso(r.shownAt), dialedAt: iso(r.dialedAt), connectedAt: iso(r.connectedAt), endedAt: iso(r.endedAt),
    durationSeconds: r.durationSeconds, failureReason: r.failureReason, callLogId: r.callLogId, open: isOpenCall(r.status),
  };
}
