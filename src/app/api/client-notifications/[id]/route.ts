import { guarded, json, error } from "@/lib/api";
import { describeNotification } from "@/lib/client-notifications/service";

type Ctx = { params: Promise<{ id: string }> };

export const GET = guarded<Ctx>("SUPERVISOR", async (_req, ctx) => {
  const { id } = await ctx.params;
  const n = await describeNotification(id);
  return n ? json({ notification: n }) : error("Message not found", 404);
});
