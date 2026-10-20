import type { ClientNotificationStatus, ClientNotificationType, MessageChannel } from "@prisma/client";
import { guarded, json, error } from "@/lib/api";
import { rateLimit } from "@/lib/gateway/auth";
import { ClientNotificationError, describeNotification, notificationHistory, sendFromComposer } from "@/lib/client-notifications/service";

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** History, newest first, for a client, site, guard, shift or incident. */
export const GET = guarded("SUPERVISOR", async (req) => {
  const u = new URL(req.url);
  const q = (k: string) => u.searchParams.get(k) || undefined;
  const where = { clientId: q("clientId"), locationId: q("locationId"), guardId: q("guardId"), shiftId: q("shiftId"), incidentId: q("incidentId"), status: q("status") as ClientNotificationStatus | undefined };
  if (!where.clientId && !where.locationId && !where.guardId && !where.shiftId && !where.incidentId && !where.status) return error("Say whose history to show.");
  return json({ notifications: await notificationHistory(where, Math.min(200, Number(q("limit") ?? 50) || 50)) });
});

/**
 * Send (or, for a role that may not send this type, draft) one message to one approved recipient.
 * The client is worked out from the shift, guard, incident or site; it is never taken from the request.
 */
export const POST = guarded("SUPERVISOR", async (req, _ctx, user) => {
  const rl = rateLimit(`clientnotify:${user.id}`, 10, 60_000);
  if (!rl.ok) return error("Too many messages. Wait a moment.", 429);
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const { notification, deduped } = await sendFromComposer({
      target: { shiftId: str(b.shiftId), guardId: str(b.guardId), incidentId: str(b.incidentId), locationId: str(b.locationId) },
      type: str(b.type) as ClientNotificationType, channel: (str(b.channel) ?? "SMS") as MessageChannel,
      recipient: str(b.recipient) ?? "", message: typeof b.message === "string" ? b.message : "", subject: str(b.subject),
      idempotencyKey: str(b.idempotencyKey) ?? "", actor: { id: user.id, name: user.name, role: user.role },
    });
    return json({ notification: await describeNotification(notification.id), deduped }, deduped ? 200 : 201);
  } catch (e) {
    if (e instanceof ClientNotificationError) return error(e.message, e.status);
    throw e;
  }
});
