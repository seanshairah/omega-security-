import { guarded, json, error } from "@/lib/api";
import { ClientNotificationError, composerContext } from "@/lib/client-notifications/service";

/** Everything the Notify client composer shows: who, which site, approved recipients and a draft of each type. */
export const GET = guarded("SUPERVISOR", async (req, _ctx, user) => {
  const u = new URL(req.url);
  const q = (k: string) => u.searchParams.get(k) || null;
  try {
    return json(await composerContext({ shiftId: q("shiftId"), guardId: q("guardId"), incidentId: q("incidentId"), locationId: q("locationId") }, user.role));
  } catch (e) {
    if (e instanceof ClientNotificationError) return error(e.message, e.status);
    throw e;
  }
});
