import { db } from "@/lib/db";
import { getSettingNumber } from "@/lib/settings";
import { effectiveStatus } from "./service";
import type { PickerCandidate, PickerGuardDevice } from "@/components/map/site-picker";

/** Activated guard phones the site picker may ask for a position (server side; no token material). */
export async function guardDevicesForPicker(): Promise<PickerGuardDevice[]> {
  const [devices, offlineMinutes] = await Promise.all([
    db.gatewayDevice.findMany({ where: { mode: "GUARD", activationStatus: "ACTIVE", status: { notIn: ["REVOKED", "DISABLED"] }, guardId: { not: null } }, include: { guard: { select: { id: true, firstName: true, lastName: true } } }, orderBy: [{ lastSeenAt: "desc" }] }),
    getSettingNumber("gateway.offlineMinutes"),
  ]);
  return devices.filter((d) => d.guard).map((d) => ({ id: d.id, guardId: d.guard!.id, guardName: `${d.guard!.firstName} ${d.guard!.lastName}`, deviceName: d.deviceName, status: effectiveStatus(d, offlineMinutes), lastSeenAt: d.lastSeenAt?.toISOString() ?? null }));
}

/** A completed guard-phone request handed to the site form as a candidate (still needs confirmation there). */
export async function candidateFromRequest(requestId: string): Promise<PickerCandidate | null> {
  const r = await db.deviceLocationRequest.findUnique({ where: { id: requestId }, include: { guard: { select: { firstName: true, lastName: true } }, gatewayDevice: { select: { deviceName: true } } } });
  if (!r || r.status !== "COMPLETED" || r.latitude == null || r.longitude == null || !r.capturedAt || r.mock) return null;
  return { lat: r.latitude, lng: r.longitude, accuracyM: r.accuracyM, capturedAt: r.capturedAt.toISOString(), source: "GUARD_DEVICE", label: `${r.guard.firstName} ${r.guard.lastName}'s phone (${r.gatewayDevice.deviceName}), fix ${r.capturedAt.toLocaleTimeString("en-GB", { timeZone: "Africa/Harare" })}`, requestId: r.id };
}
