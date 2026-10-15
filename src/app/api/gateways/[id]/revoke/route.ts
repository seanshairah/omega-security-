import { guarded, json } from "@/lib/api";
import { revokeGateway } from "@/lib/gateway/service";

export const POST = guarded<{ params: Promise<{ id: string }> }>("ADMIN", async (req, ctx, user) => {
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => ({}))) as { reason?: string };
  const g = await revokeGateway(id, { userId: user.id, name: user.name }, b.reason);
  return json({ id: g.id, status: g.status, activationStatus: g.activationStatus, revokedAt: g.revokedAt });
});
