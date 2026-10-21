"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { hasRole } from "@/lib/auth/rbac";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { findLiveShiftForGuard, recordEvent } from "@/lib/services/shifts";

/**
 * Escalate a guard from Monitoring: a critical notification pushed to every portal user's devices,
 * written on the live shift's timeline and in the audit log. It does not page anyone outside the
 * portal and does not contact the client; those stay separate, deliberate actions.
 */
export async function escalateGuard(guardId: string, note?: string) {
  const user = await getSessionUser();
  if (!hasRole(user, "SUPERVISOR")) throw new Error("Not permitted.");
  const reason = note?.trim();
  if (!reason) throw new Error("Say why you are escalating.");
  const g = await db.guard.findUnique({ where: { id: guardId }, select: { id: true, firstName: true, lastName: true, phone: true } });
  if (!g) throw new Error("Guard not found.");
  const shift = await findLiveShiftForGuard(guardId);
  const name = `${g.firstName} ${g.lastName}`;
  await notify({
    type: "GUARD_ESCALATED", severity: "CRITICAL",
    title: `Escalated · ${name}${shift ? ` at ${shift.location.name}` : ""}`,
    body: `${user!.name}: ${reason}. Call ${g.phone}.`,
    guardId, shiftId: shift?.id, url: `/monitoring?guard=${guardId}`,
  });
  if (shift) await recordEvent(shift.id, guardId, "ADMIN_NOTE", { source: "ADMIN", note: `Escalated by ${user!.name}: ${reason}` });
  await audit({ userId: user!.id, actor: user!.name, action: "GUARD_ESCALATED", entity: "Guard", entityId: guardId, details: { reason, shiftId: shift?.id } });
  revalidatePath("/monitoring");
}
