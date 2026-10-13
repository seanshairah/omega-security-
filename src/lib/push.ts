/**
 * Browser push notifications (Web Push / VAPID). Subscriptions are stored per user; every
 * dashboard notification is fanned out to all subscribed browsers. Failures that mean the
 * subscription is gone (404/410) delete it.
 */
import webpush from "web-push";
import { db } from "@/lib/db";

let configured = false;
export function pushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function ensure() {
  if (configured || !pushConfigured()) return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@omegasecurity.co.zw", process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  configured = true;
}

export async function pushToAll(payload: { title: string; body: string; url?: string; tag?: string; critical?: boolean }) {
  ensure();
  if (!configured) return 0;
  const subs = await db.pushSubscription.findMany();
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 60 * 60, urgency: payload.critical ? "high" : "normal" });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.pushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
      else console.error("push failed", code, (e as Error).message);
    }
  }));
  return sent;
}
