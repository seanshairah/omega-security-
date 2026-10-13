"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { sendSms } from "@/lib/sms/outbound";
import { processIncomingMessage } from "@/lib/sms/pipeline";
import { runAutomationTick } from "@/lib/automation/engine";
import { findLiveShiftForGuard } from "@/lib/services/shifts";
import { audit } from "@/lib/audit";

export async function sendManualSms(input: { guardId: string; body: string }) {
  const user = await getSessionUser();
  if (!can.sendSms(user)) return { ok: false, error: "Not permitted." };
  const guard = await db.guard.findUnique({ where: { id: input.guardId } });
  if (!guard) return { ok: false, error: "Guard not found." };
  const shift = await findLiveShiftForGuard(guard.id);
  const msg = await sendSms({ to: guard.phone, body: input.body.trim(), type: "GENERAL", guardId: guard.id, shiftId: shift?.id, locationId: shift?.locationId, actor: user!.name, userId: user!.id });
  revalidatePath("/sms");
  return { ok: msg.status !== "FAILED", error: msg.error ?? undefined };
}

/** Demo: inject an inbound message as if the gateway had delivered it. */
export async function simulateInbound(input: { guardId: string; body: string }) {
  const user = await getSessionUser();
  if (!can.simulate(user)) return { ok: false as const, error: "Not permitted." };
  const guard = await db.guard.findUnique({ where: { id: input.guardId } });
  if (!guard) return { ok: false as const, error: "Guard not found." };
  await audit({ userId: user!.id, actor: user!.name, action: "SMS_SIMULATED", entity: "Guard", entityId: guard.id, details: { body: input.body } });
  const result = await processIncomingMessage({ from: guard.phone, body: input.body, provider: "simulated" });
  revalidatePath("/", "layout");
  return { ok: true as const, result };
}

/** Demo: run one automation tick now, optionally pretending it is a later time. */
export async function runTickNow(offsetMinutes = 0) {
  const user = await getSessionUser();
  if (!can.simulate(user)) return { ok: false as const, error: "Not permitted." };
  const at = new Date(Date.now() + offsetMinutes * 60000);
  await audit({ userId: user!.id, actor: user!.name, action: "AUTOMATION_RUN_MANUAL", details: { at: at.toISOString(), offsetMinutes } });
  const report = await runAutomationTick(at);
  revalidatePath("/", "layout");
  return { ok: true as const, report };
}
