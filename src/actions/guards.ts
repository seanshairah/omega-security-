"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { guardSchema, formToObject, firstIssue } from "@/lib/validation";
import { nextGuardNo } from "@/lib/services/guards";
import { actor, auditAs, fail, type ActionState } from "./_helpers";
import { resolvePhoto } from "@/lib/upload";

function parse(fd: FormData) {
  const r = guardSchema.safeParse(formToObject(fd));
  if (!r.success) throw new Error(firstIssue(r.error));
  const d = r.data;
  return { ...d, dateOfBirth: d.dateOfBirth ? new Date(d.dateOfBirth) : null, dateEmployed: d.dateEmployed ? new Date(d.dateEmployed) : null };
}

export async function createGuard(_: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const user = await actor("ADMIN");
    const data = parse(fd);
    const photoUrl = (await resolvePhoto(fd, "photoUrl")) ?? null;
    const guard = await db.guard.create({ data: { ...data, photoUrl, guardNo: await nextGuardNo() } });
    await auditAs(user, "GUARD_CREATED", "Guard", guard.id, { name: `${guard.firstName} ${guard.lastName}`, phone: guard.phone });
    id = guard.id;
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/guards");
  redirect(`/guards/${id}`);
}

export async function updateGuard(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await actor("ADMIN");
    const data = parse(fd);
    const before = await db.guard.findUniqueOrThrow({ where: { id } });
    const photoUrl = await resolvePhoto(fd, "photoUrl");
    const guard = await db.guard.update({ where: { id }, data: { ...data, ...(photoUrl !== undefined ? { photoUrl } : {}), active: data.employmentStatus !== "INACTIVE", deactivatedAt: data.employmentStatus === "INACTIVE" ? before.deactivatedAt ?? new Date() : null } });
    const changed = Object.fromEntries(Object.entries(data).filter(([k, v]) => String((before as Record<string, unknown>)[k] ?? "") !== String(v ?? "")));
    await auditAs(user, "GUARD_UPDATED", "Guard", guard.id, changed);
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/guards");
  redirect(`/guards/${id}`);
}

export async function setGuardActive(id: string, active: boolean) {
  const user = await actor("ADMIN");
  const guard = await db.guard.update({ where: { id }, data: { active, deactivatedAt: active ? null : new Date(), employmentStatus: active ? "ACTIVE" : "INACTIVE" } });
  if (!active) await db.shift.updateMany({ where: { guardId: id, status: "SCHEDULED", startAt: { gt: new Date() } }, data: { status: "CANCELLED" } });
  await auditAs(user, active ? "GUARD_REACTIVATED" : "GUARD_DEACTIVATED", "Guard", guard.id, { name: `${guard.firstName} ${guard.lastName}` });
  revalidatePath("/guards");
  revalidatePath(`/guards/${id}`);
}
