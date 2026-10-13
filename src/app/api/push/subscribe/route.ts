import { db } from "@/lib/db";
import { guarded, json, error } from "@/lib/api";

export const POST = guarded("SUPERVISOR", async (req, _ctx, user) => {
  const b = (await req.json().catch(() => ({}))) as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!b.endpoint || !b.keys?.p256dh || !b.keys?.auth) return error("Invalid subscription");
  await db.pushSubscription.upsert({ where: { endpoint: b.endpoint }, update: { userId: user.id, p256dh: b.keys.p256dh, auth: b.keys.auth, userAgent: req.headers.get("user-agent") }, create: { endpoint: b.endpoint, userId: user.id, p256dh: b.keys.p256dh, auth: b.keys.auth, userAgent: req.headers.get("user-agent") } });
  return json({ ok: true });
});

export const DELETE = guarded("SUPERVISOR", async (req) => {
  const b = (await req.json().catch(() => ({}))) as { endpoint?: string };
  if (b.endpoint) await db.pushSubscription.deleteMany({ where: { endpoint: b.endpoint } });
  return json({ ok: true });
});
