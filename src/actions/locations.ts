"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { clientSchema, locationSchema, formToObject, firstIssue } from "@/lib/validation";
import { actor, auditAs, fail, type ActionState } from "./_helpers";

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
    const l = await db.location.create({ data: r.data });
    await auditAs(user, "LOCATION_CREATED", "Location", l.id, { name: l.name });
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
    const l = await db.location.update({ where: { id }, data: r.data });
    await auditAs(user, "LOCATION_UPDATED", "Location", l.id, { name: l.name });
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
