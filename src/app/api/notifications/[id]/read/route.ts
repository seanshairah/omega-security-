import { db } from "@/lib/db";
import { guarded, json } from "@/lib/api";

export const POST = guarded<{ params: Promise<{ id: string }> }>("SUPERVISOR", async (_req, { params }) => {
  const { id } = await params;
  return json(await db.notification.update({ where: { id }, data: { readAt: new Date() } }));
});
