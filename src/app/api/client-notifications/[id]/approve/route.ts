import { guarded, json, error } from "@/lib/api";
import { ClientNotificationError, approveClientNotification, describeNotification } from "@/lib/client-notifications/service";

type Ctx = { params: Promise<{ id: string }> };

/** Send a draft, optionally with edited text. Routine drafts need an operations admin; sensitive ones the super admin. */
export const POST = guarded<Ctx>("ADMIN", async (req, ctx, user) => {
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => ({}))) as { message?: unknown };
  try {
    await approveClientNotification(id, { id: user.id, name: user.name, role: user.role }, { message: typeof b.message === "string" ? b.message : null });
    return json({ notification: await describeNotification(id) });
  } catch (e) {
    if (e instanceof ClientNotificationError) return error(e.message, e.status);
    throw e;
  }
});
