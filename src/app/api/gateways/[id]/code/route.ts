import { guarded, json } from "@/lib/api";
import { regenerateActivationCode } from "@/lib/gateway/service";

/** New activation code (for a pending device or a replaced phone). */
export const POST = guarded<{ params: Promise<{ id: string }> }>("ADMIN", async (_req, ctx, user) => {
  const { id } = await ctx.params;
  const g = await regenerateActivationCode(id, { userId: user.id, name: user.name });
  return json({ id: g.id, activationCode: g.activationCode, activationExpiresAt: g.activationExpiresAt });
});
