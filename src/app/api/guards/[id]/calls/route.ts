import { guarded, json, paging } from "@/lib/api";
import { callRows } from "@/lib/gateway/calls";

export const GET = guarded<{ params: Promise<{ id: string }> }>("SUPERVISOR", async (req, ctx) => {
  const { id } = await ctx.params;
  const { take, skip, page } = paging(new URL(req.url));
  return json({ items: await callRows({ guardId: id }, take, skip), page });
});
