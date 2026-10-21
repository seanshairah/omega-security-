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
  const { phoneVerified, networkLocationConsent, ...d } = r.data;
  return { data: { ...d, alternatePhones: d.alternatePhones.filter((p) => p !== d.phone), dateOfBirth: d.dateOfBirth ? new Date(d.dateOfBirth) : null, dateEmployed: d.dateEmployed ? new Date(d.dateEmployed) : null }, phoneVerified, networkLocationConsent };
}

/**
 * The phone profile's rules, checked on the server: an alternative number may not be another guard's
 * number (it would make that number match nobody), the gateway must be an operations phone, and
 * network location needs a known phone type and recorded consent.
 */
async function checkPhoneProfile(guardId: string | null, d: ReturnType<typeof parse>["data"], consent: boolean) {
  if (d.alternatePhones.length) {
    const clash = await db.guard.findFirst({ where: { id: guardId ? { not: guardId } : undefined, OR: [{ phone: { in: d.alternatePhones } }, { alternatePhones: { hasSome: d.alternatePhones } }] }, select: { firstName: true, lastName: true } });
    if (clash) throw new Error(`An alternative number already belongs to ${clash.firstName} ${clash.lastName}. A shared number would identify neither guard.`);
  }
  if (d.assignedGatewayId) {
    const gw = await db.gatewayDevice.findUnique({ where: { id: d.assignedGatewayId }, select: { mode: true } });
    if (!gw || gw.mode !== "OPERATIONS_GATEWAY") throw new Error("Choose an operations gateway phone.");
  }
  if (d.networkLocationEligible && d.phoneType === "UNKNOWN") throw new Error("Set the phone type before allowing network location checks.");
  if (d.networkLocationEligible && !consent) throw new Error("Record the guard's consent before allowing network location checks.");
}

const stamp = (on: boolean, before: Date | null | undefined) => (on ? before ?? new Date() : null);

export async function createGuard(_: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const user = await actor("ADMIN");
    const { data, phoneVerified, networkLocationConsent } = parse(fd);
    await checkPhoneProfile(null, data, networkLocationConsent);
    const photoUrl = (await resolvePhoto(fd, "photoUrl")) ?? null;
    const guard = await db.guard.create({ data: { ...data, photoUrl, guardNo: await nextGuardNo(), phoneVerifiedAt: stamp(phoneVerified, null), networkLocationConsentAt: stamp(networkLocationConsent, null) } });
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
    const { data, phoneVerified, networkLocationConsent } = parse(fd);
    const before = await db.guard.findUniqueOrThrow({ where: { id } });
    await checkPhoneProfile(id, data, networkLocationConsent);
    const photoUrl = await resolvePhoto(fd, "photoUrl");
    // A changed number is not verified any more, whatever the form says.
    const guard = await db.guard.update({ where: { id }, data: { ...data, ...(photoUrl !== undefined ? { photoUrl } : {}), active: data.employmentStatus !== "INACTIVE", deactivatedAt: data.employmentStatus === "INACTIVE" ? before.deactivatedAt ?? new Date() : null, phoneVerifiedAt: before.phone !== data.phone ? null : stamp(phoneVerified, before.phoneVerifiedAt), networkLocationConsentAt: stamp(networkLocationConsent, before.networkLocationConsentAt) } });
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
