"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { audit } from "@/lib/audit";
import { createGateway, updateGateway, regenerateActivationCode, setGatewayDisabled, revokeGateway } from "@/lib/gateway/service";
import { linkUnknownCaller, resolveUnknownCaller } from "@/lib/gateway/events";
import { simulateGatewayEvent, type SimulateInput } from "@/lib/gateway/simulate";
import { actor, auditAs, fail, type ActionState } from "./_helpers";

const who = (u: { id: string; name: string }) => ({ userId: u.id, name: u.name });

export async function createGatewayAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const user = await actor("ADMIN");
    const deviceName = String(fd.get("deviceName") ?? "").trim();
    if (deviceName.length < 2) return { error: "Give the gateway a name, e.g. Control Room Phone 01." };
    const mode = fd.get("mode") === "GUARD" ? "GUARD" : "OPERATIONS_GATEWAY";
    const guardId = String(fd.get("guardId") ?? "") || null;
    if (mode === "GUARD" && !guardId) return { error: "Choose the guard this phone belongs to." };
    const g = await createGateway({ deviceName, phoneNumber: String(fd.get("phoneNumber") ?? ""), locationId: String(fd.get("locationId") ?? "") || null, notes: String(fd.get("notes") ?? "") || null, mode, guardId, actor: who(user) });
    id = g.id;
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/gateways");
  redirect(`/gateways/${id}`);
}

export async function updateGatewayAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await actor("ADMIN");
    const deviceName = String(fd.get("deviceName") ?? "").trim();
    if (deviceName.length < 2) return { error: "Give the gateway a name." };
    const mode = fd.get("mode") === "GUARD" ? "GUARD" : "OPERATIONS_GATEWAY";
    const guardId = String(fd.get("guardId") ?? "") || null;
    if (mode === "GUARD" && !guardId) return { error: "Choose the guard this phone belongs to." };
    await updateGateway(id, { deviceName, phoneNumber: String(fd.get("phoneNumber") ?? ""), locationId: String(fd.get("locationId") ?? "") || null, notes: String(fd.get("notes") ?? "") || null, mode, guardId }, who(user));
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/gateways");
  redirect(`/gateways/${id}`);
}

export async function regenerateGatewayCode(id: string) {
  const user = await actor("ADMIN");
  await regenerateActivationCode(id, who(user));
  revalidatePath(`/gateways/${id}`);
}

export async function setGatewayDisabledAction(id: string, disabled: boolean) {
  const user = await actor("ADMIN");
  await setGatewayDisabled(id, disabled, who(user));
  revalidatePath("/gateways");
  revalidatePath(`/gateways/${id}`);
}

export async function revokeGatewayAction(id: string, reason: string) {
  const user = await actor("ADMIN");
  await revokeGateway(id, who(user), reason.trim() || undefined);
  revalidatePath("/gateways");
  revalidatePath(`/gateways/${id}`);
}

/** Admin callback bookkeeping: note who called the guard back, so the missed call stops shouting. */
export async function markCallHandled(callId: string, note: string) {
  const user = await actor("SUPERVISOR");
  const call = await db.callLog.update({ where: { id: callId }, data: { note: `${note.trim() || "Handled"} · ${user.name}` } });
  await db.notification.updateMany({ where: { type: "MISSED_CALL", readAt: null, guardId: call.guardId ?? undefined, createdAt: { gte: call.startedAt } }, data: { readAt: new Date() } });
  await auditAs(user, "CALL_HANDLED", "CallLog", callId, { note });
  revalidatePath("/calls");
  revalidatePath(`/calls/${callId}`);
  revalidatePath("/dashboard");
}

export async function linkCallerAction(callId: string, guardId: string) {
  const user = await actor("ADMIN");
  await linkUnknownCaller(callId, guardId, who(user));
  revalidatePath("/calls");
  revalidatePath(`/calls/${callId}`);
}

export async function resolveCallerAction(callId: string, resolution: "IGNORED" | "BLOCKED") {
  const user = await actor("ADMIN");
  await resolveUnknownCaller(callId, resolution, who(user));
  revalidatePath("/calls");
  revalidatePath(`/calls/${callId}`);
}

/** Simulator: behaves exactly like the phone posting the event. */
export async function simulateGateway(input: SimulateInput) {
  const user = await getSessionUser();
  if (!can.simulate(user)) return { ok: false as const, error: "Not permitted." };
  const device = await db.gatewayDevice.findUnique({ where: { id: input.gatewayId } });
  if (!device) return { ok: false as const, error: "Gateway not found." };
  await audit({ userId: user!.id, actor: user!.name, action: "GATEWAY_EVENT_SIMULATED", entity: "GatewayDevice", entityId: device.id, details: { eventType: input.eventType, phoneNumber: input.phoneNumber ?? null } });
  const r = await simulateGatewayEvent(device, input);
  revalidatePath("/", "layout");
  return { ok: true as const, ...r };
}
