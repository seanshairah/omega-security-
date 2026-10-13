import { db } from "@/lib/db";
import { guarded, json, error } from "@/lib/api";
import { shiftInclude, cancelShift } from "@/lib/services/shifts";
import { audit } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

export const GET = guarded<Ctx>("SUPERVISOR", async (_req, { params }) => {
  const { id } = await params;
  const shift = await db.shift.findUnique({ where: { id }, include: { ...shiftInclude, checkIns: { orderBy: [{ at: "asc" }, { id: "asc" }] }, welfareChecks: true, incidents: true, smsMessages: { orderBy: { createdAt: "asc" } } } });
  if (!shift) return error("Shift not found", 404);
  return json(shift);
});

export const PATCH = guarded<Ctx>("ADMIN", async (req, { params }, user) => {
  const { id } = await params;
  const b = (await req.json().catch(() => ({}))) as { guardId?: string; supervisorId?: string; instructions?: string; notes?: string; cancel?: boolean; reason?: string };
  if (b.cancel) return json(await cancelShift(id, { userId: user.id, name: user.name }, b.reason));
  const shift = await db.shift.update({ where: { id }, data: { guardId: b.guardId, supervisorId: b.supervisorId, instructions: b.instructions, notes: b.notes }, include: shiftInclude });
  await audit({ userId: user.id, actor: user.name, action: b.guardId ? "SHIFT_REASSIGNED" : "SHIFT_UPDATED", entity: "Shift", entityId: id, details: b as never });
  return json(shift);
});
