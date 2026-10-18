"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { clientSchema, locationSchema, formToObject, firstIssue } from "@/lib/validation";
import { actor, auditAs, fail, type ActionState } from "./_helpers";
import { geofenceChanged } from "@/lib/site-config";

export async function createClient(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await actor("ADMIN");
    const r = clientSchema.safeParse(formToObject(fd));
    if (!r.success) return { error: firstIssue(r.error) };
    const c = await db.client.create({ data: r.data });
    await auditAs(user, "CLIENT_CREATED", "Client", c.id, { name: c.name });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/clients");
  redirect("/clients");
}

export async function updateClient(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await actor("ADMIN");
    const r = clientSchema.safeParse(formToObject(fd));
    if (!r.success) return { error: firstIssue(r.error) };
    const c = await db.client.update({ where: { id }, data: r.data });
    await auditAs(user, "CLIENT_UPDATED", "Client", c.id, { name: c.name });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/clients");
  redirect("/clients");
}

export async function setClientActive(id: string, active: boolean) {
  const user = await actor("ADMIN");
  const c = await db.client.update({ where: { id }, data: { active } });
  await auditAs(user, active ? "CLIENT_REACTIVATED" : "CLIENT_DEACTIVATED", "Client", c.id, { name: c.name });
  revalidatePath("/clients");
}

export async function createLocation(_: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const user = await actor("ADMIN");
    const r = locationSchema.safeParse(formToObject(fd));
    if (!r.success) return { error: firstIssue(r.error) };
    const d = r.data;
    const hasCoords = d.latitude != null && d.longitude != null;
    const l = await db.location.create({ data: { ...d, coordinatesSource: hasCoords ? d.coordinatesSource ?? "MANUAL" : null, placeId: hasCoords ? d.placeId : null, coordinatesUpdatedAt: hasCoords ? new Date() : null, coordinatesVerifiedAt: hasCoords && d.coordinatesSource === "MAP" ? new Date() : null } });
    await auditAs(user, "LOCATION_CREATED", "Location", l.id, { name: l.name, geofence: hasCoords ? { latitude: l.latitude, longitude: l.longitude, radiusM: l.geofenceRadiusM, source: l.coordinatesSource } : null });
    id = l.id;
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/locations");
  redirect(`/locations/${id}`);
}

export async function updateLocation(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await actor("ADMIN");
    const r = locationSchema.safeParse(formToObject(fd));
    if (!r.success) return { error: firstIssue(r.error) };
    const d = r.data;
    const before = await db.location.findUniqueOrThrow({ where: { id } });
    const hasCoords = d.latitude != null && d.longitude != null;
    const moved = geofenceChanged(before, d);
    const l = await db.location.update({ where: { id }, data: {
      ...d,
      coordinatesSource: hasCoords ? d.coordinatesSource ?? before.coordinatesSource ?? "MANUAL" : null,
      placeId: hasCoords ? d.placeId ?? (moved ? null : before.placeId) : null,
      ...(moved ? { configVersion: { increment: 1 }, coordinatesUpdatedAt: new Date(), coordinatesVerifiedAt: hasCoords && d.coordinatesSource === "MAP" ? new Date() : null } : {}),
    } });
    await auditAs(user, moved ? "LOCATION_GEOFENCE_CHANGED" : "LOCATION_UPDATED", "Location", l.id, {
      name: l.name,
      ...(moved ? { configVersion: l.configVersion, before: { latitude: before.latitude, longitude: before.longitude, radiusM: before.geofenceRadiusM, source: before.coordinatesSource }, after: { latitude: l.latitude, longitude: l.longitude, radiusM: l.geofenceRadiusM, source: l.coordinatesSource } } : {}),
    });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/locations");
  redirect(`/locations/${id}`);
}

export async function setLocationActive(id: string, active: boolean) {
  const user = await actor("ADMIN");
  const l = await db.location.update({ where: { id }, data: { active } });
  await auditAs(user, active ? "LOCATION_REACTIVATED" : "LOCATION_DEACTIVATED", "Location", l.id, { name: l.name });
  revalidatePath("/locations");
  revalidatePath(`/locations/${id}`);
}
