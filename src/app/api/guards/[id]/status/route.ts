import { guarded, json, error } from "@/lib/api";
import { guardSnapshot } from "@/lib/services/guard-snapshot";

/** Small status read for the guard workspace header, location block and map; polled every 15 s. Audited once per page view by the page itself, not here. */
export const GET = guarded<{ params: Promise<{ id: string }> }>("SUPERVISOR", async (_req, ctx) => {
  const { id } = await ctx.params;
  const s = await guardSnapshot(id);
  if (!s) return error("Guard not found", 404);
  return json(s);
});
