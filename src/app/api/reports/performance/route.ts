import { db } from "@/lib/db";
import { guarded, json } from "@/lib/api";
import { guardPerformance } from "@/lib/services/guards";

export const GET = guarded("SUPERVISOR", async (req) => {
  const q = new URL(req.url).searchParams;
  const from = q.get("from") ? new Date(q.get("from")!) : undefined;
  const to = q.get("to") ? new Date(q.get("to")!) : undefined;
  const guards = await db.guard.findMany({ where: { active: true }, orderBy: { lastName: "asc" } });
  const items = await Promise.all(guards.map(async (g) => ({ id: g.id, guardNo: g.guardNo, name: `${g.firstName} ${g.lastName}`, ...(await guardPerformance(g.id, from, to)) })));
  return json({ items });
});
