import { guarded, json, error } from "@/lib/api";
import { ClientNotificationError, describeNotification, discardClientNotification } from "@/lib/client-notifications/service";

type Ctx = { params: Promise<{ id: string }> };

export const POST = guarded<Ctx>("ADMIN", async (_req, ctx, user) => {
  const { id } = await ctx.params;
  try {
    await discardClientNotification(id, { id: user.id, name: user.name, role: user.role });
    return json({ notification: await describeNotification(id) });
  } catch (e) {
    if (e instanceof ClientNotificationError) return error(e.message, e.status);
    throw e;
  }
});
