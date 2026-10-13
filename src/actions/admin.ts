"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { userSchema, formToObject, firstIssue } from "@/lib/validation";
import { hashPassword } from "@/lib/auth/password";
import { saveSettings } from "@/lib/settings";
import { invalidateTemplateCache, TEMPLATE_DEFS } from "@/lib/sms/templates";
import { actor, auditAs, fail, type ActionState } from "./_helpers";

export async function createUser(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const me = await actor("SUPER_ADMIN");
    const r = userSchema.safeParse(formToObject(fd));
    if (!r.success) return { error: firstIssue(r.error) };
    const d = r.data;
    if (!d.password) return { error: "A password is required for a new user." };
    const u = await db.user.create({ data: { name: d.name, email: d.email, role: d.role, title: d.title, phone: d.phone, passwordHash: await hashPassword(d.password) } });
    await auditAs(me, "USER_CREATED", "User", u.id, { email: u.email, role: u.role });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/users");
  redirect("/users");
}

export async function updateUser(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const me = await actor("SUPER_ADMIN");
    const r = userSchema.safeParse(formToObject(fd));
    if (!r.success) return { error: firstIssue(r.error) };
    const d = r.data;
    const u = await db.user.update({ where: { id }, data: { name: d.name, email: d.email, role: d.role, title: d.title, phone: d.phone, ...(d.password ? { passwordHash: await hashPassword(d.password) } : {}) } });
    await auditAs(me, "USER_UPDATED", "User", u.id, { email: u.email, role: u.role, passwordChanged: Boolean(d.password) });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/users");
  redirect("/users");
}

export async function setUserActive(id: string, active: boolean) {
  const me = await actor("SUPER_ADMIN");
  if (me.id === id) throw new Error("You cannot deactivate your own account.");
  const u = await db.user.update({ where: { id }, data: { active } });
  await auditAs(me, active ? "USER_REACTIVATED" : "USER_DEACTIVATED", "User", u.id, { email: u.email });
  revalidatePath("/users");
}

export async function updateSettings(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const me = await actor("SUPER_ADMIN");
    const values: Record<string, string> = {};
    for (const [k, v] of fd.entries()) if (k.includes(".")) values[k] = String(v);
    await saveSettings(values);
    await auditAs(me, "SETTINGS_UPDATED", "Setting", undefined, values);
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/settings");
  return { ok: true };
}

export async function updateTemplate(key: string, _: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const me = await actor("SUPER_ADMIN");
    const body = String(fd.get("body") ?? "").trim();
    if (body.length < 10) return { error: "The message is too short." };
    if (body.length > 480) return { error: "Keep messages under 480 characters (3 SMS segments)." };
    const def = TEMPLATE_DEFS.find((t) => t.key === key);
    await db.messageTemplate.upsert({ where: { key }, update: { body }, create: { key, name: def?.name ?? key, description: def?.description, body, variables: def?.variables ?? [] } });
    invalidateTemplateCache();
    await auditAs(me, "TEMPLATE_UPDATED", "MessageTemplate", key);
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/sms/templates");
  return { ok: true };
}

export async function resetTemplate(key: string) {
  const me = await actor("SUPER_ADMIN");
  const def = TEMPLATE_DEFS.find((t) => t.key === key);
  if (!def) return;
  await db.messageTemplate.update({ where: { key }, data: { body: def.body } });
  invalidateTemplateCache();
  await auditAs(me, "TEMPLATE_RESET", "MessageTemplate", key);
  revalidatePath("/sms/templates");
}

export async function markNotificationsRead(ids: string[] | "all") {
  await actor("SUPERVISOR");
  await db.notification.updateMany({ where: ids === "all" ? { readAt: null } : { id: { in: ids } }, data: { readAt: new Date() } });
  revalidatePath("/", "layout");
}
