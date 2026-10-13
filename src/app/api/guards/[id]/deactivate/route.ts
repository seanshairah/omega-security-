import { db } from "@/lib/db";
import { guarded, json } from "@/lib/api";
import { audit } from "@/lib/audit";

export const POST = guarded<{ params: Promise<{ id: string }> }>("ADMIN", async (_req, { params }, user) => {
  const { id } = await params;
  const guard = await db.guard.update({ where: { id }, data: { active: false, deactivatedAt: new Date(), employmentStatus: "INACTIVE" } });
  await db.shift.updateMany({ where: { guardId: id, status: "SCHEDULED", startAt: { gt: new Date() } }, data: { status: "CANCELLED" } });
  await audit({ userId: user.id, actor: user.name, action: "GUARD_DEACTIVATED", entity: "Guard", entityId: id });
  return json(guard);
});
