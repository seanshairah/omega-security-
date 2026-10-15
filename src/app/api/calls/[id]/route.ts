import { guarded, json, error } from "@/lib/api";
import { db } from "@/lib/db";
import { callInclude } from "@/lib/gateway/calls";

export const GET = guarded<{ params: Promise<{ id: string }> }>("SUPERVISOR", async (_req, ctx) => {
  const { id } = await ctx.params;
  const call = await db.callLog.findUnique({ where: { id }, include: callInclude });
  if (!call) return error("Call not found", 404);
  return json(call);
});
