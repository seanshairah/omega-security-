/**
 * Network location checks: the database side of the router.
 *
 * `requestNetworkVerification` gathers the facts, asks the router, and either sends one request to
 * the guard's network adapter or records why it did not. Results go to NetworkLocationCheck, never
 * to GPS location events. A network "inside" becomes PRESENCE evidence labelled "Network verified";
 * an "outside" raises a location exception for a person to look at. Nothing here changes attendance:
 * a guard who clocked in by call stays clocked in whatever the network says.
 *
 * `runNetworkLocationSchedule` is the engine step for the scheduled triggers. Every trigger is off
 * by default, and so is the feature.
 */
import type { NetworkCheckTrigger, NetworkLocationCheck } from "@prisma/client";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { notify } from "@/lib/notifications";
import { audit } from "@/lib/audit";
import { recordEvent, CLOSED_STATUSES, ON_SITE_STATUSES } from "@/lib/services/shifts";
import { recordEvidence } from "@/lib/attendance/evidence";
import { effectiveGeofence } from "@/lib/site-config";
import { fmtTime } from "@/lib/time";
import { networkProviderFor } from "./provider";
import { NETWORK_RESULT_META, NETWORK_TRIGGER_LABEL, parseNetworkPolicy, routeVerification, type NetworkPolicy, type Route } from "./router-rules";

/** A check may be made this long before the shift starts and after it ends. */
export const NETWORK_SHIFT_MARGIN_MINUTES = 15;

export async function networkPolicy(): Promise<NetworkPolicy> {
  return parseNetworkPolicy((await getSettings()) as Record<string, string | undefined>);
}

export type NetworkRequestOutcome = { method: Route["method"] | "DUPLICATE"; check: NetworkLocationCheck | null; reason: string | null };

export async function requestNetworkVerification(
  input: { guardId: string; shiftId?: string | null; trigger: NetworkCheckTrigger; dedupeKey?: string | null; actor?: { userId: string | null; name: string } | null },
  now = new Date(),
  policy?: NetworkPolicy,
): Promise<NetworkRequestOutcome> {
  if (input.dedupeKey) {
    const seen = await db.networkLocationCheck.findUnique({ where: { dedupeKey: input.dedupeKey } });
    if (seen) return { method: "DUPLICATE", check: seen, reason: null };
  }
  const p = policy ?? (await networkPolicy());
  const guard = await db.guard.findUniqueOrThrow({ where: { id: input.guardId } });
  const margin = NETWORK_SHIFT_MARGIN_MINUTES * 60_000;
  const shift = input.shiftId
    ? await db.shift.findUnique({ where: { id: input.shiftId }, include: { location: true } })
    : await db.shift.findFirst({ where: { guardId: guard.id, status: { notIn: ["CANCELLED", "MISSED"] }, startAt: { lte: new Date(now.getTime() + margin) }, endAt: { gte: new Date(now.getTime() - margin) } }, include: { location: true }, orderBy: { startAt: "desc" } });
  const inShift = Boolean(shift && shift.status !== "CANCELLED" && shift.status !== "MISSED" && shift.startAt.getTime() - margin <= now.getTime() && now.getTime() <= shift.endAt.getTime() + margin);
  const centre = shift ? effectiveGeofence(shift, shift.location) : null;
  const area = centre && shift?.location.networkVerifyEnabled && shift.location.networkRadiusM ? { latitude: centre.fence.latitude, longitude: centre.fence.longitude, radiusM: shift.location.networkRadiusM } : null;
  const provider = networkProviderFor(guard.mobileOperator);

  const lastGps = guard.phoneType === "ANDROID" && shift
    ? await db.locationEvent.findFirst({ where: { guardId: guard.id, shiftId: shift.id, latitude: { not: null } }, orderBy: { occurredAt: "desc" }, select: { occurredAt: true } })
    : null;
  const lastSent = await db.networkLocationCheck.findFirst({ where: { guardId: guard.id, requestSent: true }, orderBy: { requestedAt: "desc" }, select: { requestedAt: true } });
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [sentThisShift, sentThisMonth] = await Promise.all([
    shift ? db.networkLocationCheck.count({ where: { shiftId: shift.id, requestSent: true } }) : Promise.resolve(0),
    db.networkLocationCheck.count({ where: { requestSent: true, requestedAt: { gte: monthStart } } }),
  ]);

  const route = routeVerification({
    trigger: input.trigger, phoneType: guard.phoneType, operator: guard.mobileOperator,
    networkEligible: guard.networkLocationEligible, consentAt: guard.networkLocationConsentAt, inShift,
    siteHasArea: Boolean(area), providerConfigured: Boolean(provider?.configured()),
    gpsAgeMinutes: lastGps ? (now.getTime() - lastGps.occurredAt.getTime()) / 60_000 : null,
    minutesSinceLastSent: lastSent ? (now.getTime() - lastSent.requestedAt.getTime()) / 60_000 : null,
    sentThisShift, sentThisMonth,
  }, p);

  if (input.trigger === "MANUAL") {
    await audit({ userId: input.actor?.userId ?? null, actor: input.actor?.name ?? "system", action: "NETWORK_LOCATION_REQUESTED", entity: "Guard", entityId: guard.id, details: { shiftId: shift?.id ?? null, route: route.method, reason: "reason" in route ? route.reason : null } });
  }
  if (route.method === "GPS" || route.method === "SKIP") return { method: route.method, check: null, reason: route.reason };

  const base = {
    dedupeKey: input.dedupeKey ?? null, guardId: guard.id, shiftId: shift?.id ?? null, locationId: shift?.locationId ?? null,
    trigger: input.trigger, requestedById: input.actor?.userId ?? null, operator: guard.mobileOperator, requestedAt: now,
    areaLatitude: area?.latitude ?? null, areaLongitude: area?.longitude ?? null, areaRadiusM: area?.radiusM ?? null,
  };
  if (route.method === "RECORD") {
    const check = await createOnce({ ...base, provider: "router", requestSent: false, result: route.result, reason: route.reason, completedAt: now });
    return { method: "RECORD", check, reason: route.reason };
  }

  // NETWORK: one request to the adapter.
  const reference = `${guard.id}:${now.getTime()}`;
  let answer;
  try {
    answer = await provider!.verify({ phone: guard.phone, area: area!, maxAgeSeconds: p.maxAgeSeconds, reference });
  } catch (e) {
    answer = { result: "NETWORK_ERROR" as const, error: (e as Error).message };
  }
  const check = await createOnce({
    ...base, provider: provider!.name, requestSent: true, result: answer.result, reason: answer.error ?? null,
    maxAgeSeconds: p.maxAgeSeconds, observedAt: answer.observedAt ?? null, matchRate: answer.matchRate ?? null, uncertaintyM: answer.uncertaintyM ?? null,
    authorisationRef: provider!.authorisationRef(), providerRef: answer.providerRef ?? null, costUnits: answer.costUnits ?? null,
    simulated: provider!.simulated, completedAt: new Date(),
  });
  if (check && shift) await afterResult(check, shift, guard);
  return { method: "NETWORK", check, reason: null };
}

/** Insert, or return the row another runner inserted for the same key a moment earlier. */
async function createOnce(data: Parameters<typeof db.networkLocationCheck.create>[0]["data"] & { dedupeKey: string | null }): Promise<NetworkLocationCheck | null> {
  if (!data.dedupeKey) return db.networkLocationCheck.create({ data });
  const { count } = await db.networkLocationCheck.createMany({ data: [data as never], skipDuplicates: true });
  const row = await db.networkLocationCheck.findUnique({ where: { dedupeKey: data.dedupeKey } });
  return count ? row : null;
}

const PLACE: Partial<Record<NetworkLocationCheck["result"], string>> = { NETWORK_VERIFIED_INSIDE: "inside", NETWORK_VERIFIED_OUTSIDE: "outside", NETWORK_PARTIAL_MATCH: "partly inside" };

async function afterResult(c: NetworkLocationCheck, shift: { id: string; locationId: string; location: { name: string } }, guard: { id: string; firstName: string; lastName: string }) {
  const meta = NETWORK_RESULT_META[c.result];
  const sim = c.simulated ? " (simulated, not real evidence)" : "";
  const area = c.areaRadiusM ? ` ${c.areaRadiusM.toLocaleString("en-GB")} m duty area` : " duty area";
  await recordEvent(shift.id, guard.id, "NETWORK_LOCATION", {
    at: c.completedAt ?? c.requestedAt,
    note: `Network check (${c.provider}, ${NETWORK_TRIGGER_LABEL[c.trigger]}): ${PLACE[c.result] ? `${PLACE[c.result]} the${area}` : meta.label.toLowerCase()}${c.matchRate != null ? `, ${c.matchRate}% match` : ""}${c.observedAt ? `, position from ${fmtTime(c.observedAt)}` : ""}${sim}. Not GPS.`,
  });
  if (c.result === "NETWORK_VERIFIED_INSIDE") {
    await recordEvidence({
      shiftId: shift.id, guardId: guard.id, kind: "PRESENCE", source: "NETWORK", status: "CONFIRMED", occurredAt: c.observedAt ?? c.completedAt ?? c.requestedAt,
      dedupeKey: `network:${c.id}`, flags: c.simulated ? ["SIMULATED"] : [], note: `Inside the${area} by ${c.provider}${sim}.`,
    });
  } else if (c.result === "NETWORK_VERIFIED_OUTSIDE") {
    await notify({
      type: "LOCATION_EXCEPTION", severity: "WARNING",
      title: `${guard.firstName} ${guard.lastName} may be away from ${shift.location.name}${c.simulated ? " (simulated)" : ""}`,
      body: `The mobile network places the guard's phone outside the${area} at ${fmtTime(c.observedAt ?? c.completedAt ?? c.requestedAt)}. Network positions are approximate: call the guard before acting.`,
      guardId: guard.id, shiftId: shift.id, url: `/shifts/${shift.id}`,
    }).catch(() => undefined);
  }
}

export type NetworkRunReport = { requested: number; recorded: number; skipped: number; errors: string[] };

/** The engine step: scheduled triggers, Android fallback and retries. Does nothing while the feature is off. */
export async function runNetworkLocationSchedule(now = new Date()): Promise<NetworkRunReport> {
  const report: NetworkRunReport = { requested: 0, recorded: 0, skipped: 0, errors: [] };
  const p = await networkPolicy();
  if (!p.enabled) return report;
  const window = 15 * 60_000;
  const since = new Date(now.getTime() - window);
  const eligible = { networkLocationEligible: true, active: true };
  const fire = async (guardId: string, shiftId: string, trigger: NetworkCheckTrigger, dedupeKey: string) => {
    try {
      const r = await requestNetworkVerification({ guardId, shiftId, trigger, dedupeKey }, now, p);
      if (r.method === "NETWORK") report.requested++;
      else if (r.method === "RECORD") report.recorded++;
      else if (r.method === "SKIP") report.skipped++;
    } catch (e) {
      report.errors.push(`network ${trigger} ${shiftId}: ${(e as Error).message}`);
    }
  };

  if (p.onShiftStart) {
    for (const s of await db.shift.findMany({ where: { startAt: { gte: since, lte: now }, status: { notIn: CLOSED_STATUSES }, guard: eligible }, select: { id: true, guardId: true } })) await fire(s.guardId, s.id, "SHIFT_START", `SHIFT_START:${s.id}`);
  }
  if (p.onShiftEnd) {
    for (const s of await db.shift.findMany({ where: { endAt: { gte: since, lte: now }, status: { notIn: ["CANCELLED", "MISSED"] }, guard: eligible }, select: { id: true, guardId: true } })) await fire(s.guardId, s.id, "SHIFT_END", `SHIFT_END:${s.id}`);
  }
  const live = await db.shift.findMany({ where: { status: { in: ON_SITE_STATUSES }, startAt: { lte: now }, endAt: { gt: now }, guard: eligible }, select: { id: true, guardId: true, startAt: true, endAt: true, guard: { select: { phoneType: true } } } });
  for (const s of live) {
    const mid = new Date((s.startAt.getTime() + s.endAt.getTime()) / 2);
    if (p.midShift && mid <= now && mid >= since) await fire(s.guardId, s.id, "MID_SHIFT", `MID_SHIFT:${s.id}`);
    if (p.androidFallback && s.guard.phoneType === "ANDROID") {
      // One key per cooldown period; the router still decides whether GPS is stale enough.
      await fire(s.guardId, s.id, "ANDROID_FALLBACK", `ANDROID_FALLBACK:${s.id}:${Math.floor(now.getTime() / (p.cooldownMinutes * 60_000))}`);
    }
    if (p.retryUncertain) {
      const last = await db.networkLocationCheck.findFirst({ where: { shiftId: s.id, requestSent: true }, orderBy: { requestedAt: "desc" } });
      if (last && ["NETWORK_PARTIAL_MATCH", "NETWORK_LOCATION_STALE", "NETWORK_ERROR"].includes(last.result) && last.trigger !== "RETRY_UNCERTAIN") {
        await fire(s.guardId, s.id, "RETRY_UNCERTAIN", `RETRY_UNCERTAIN:${last.id}`);
      }
    }
  }
  return report;
}

/** A guard's call to an operations gateway, if the policy asks for a network check on calls. */
export async function networkCheckForCall(guardId: string, shiftId: string, callLogId: string, now = new Date()): Promise<void> {
  const p = await networkPolicy();
  if (!p.enabled || !p.onIncomingCall) return;
  await requestNetworkVerification({ guardId, shiftId, trigger: "INCOMING_CALL", dedupeKey: `call:${callLogId}` }, now, p);
}

/** After a welfare call the guard answered, if the policy asks for it. */
export async function networkCheckAfterWelfare(guardId: string, shiftId: string, welfareCheckId: string, now = new Date()): Promise<void> {
  const p = await networkPolicy();
  if (!p.enabled || !p.afterWelfareCall) return;
  await requestNetworkVerification({ guardId, shiftId, trigger: "AFTER_WELFARE_CALL", dedupeKey: `welfare:${welfareCheckId}` }, now, p);
}
