import { NextResponse } from "next/server";
import { authenticateGateway, clientIp, rateLimit } from "@/lib/gateway/auth";
import { processGatewayEvents } from "@/lib/gateway/events";
import { db } from "@/lib/db";

/**
 * POST /api/gateways/events  Bearer <deviceToken>
 * Body: { events: [ { eventId, eventType, callId?, phoneNumber?, direction?, timestamp, durationSeconds?, answered? } ] }
 * or a single event object. Returns one acknowledgement per event; the phone deletes a queued
 * event only when its ack is "ok" or "duplicate".
 */
export async function POST(req: Request) {
  const auth = await authenticateGateway(req);
  if (!auth.device) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const rl = rateLimit(`ev:${auth.device.id}`, 120, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many events" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } });
  const body = (await req.json().catch(() => null)) as unknown;
  const events = Array.isArray(body) ? body : body && typeof body === "object" && Array.isArray((body as { events?: unknown }).events) ? (body as { events: unknown[] }).events : body && typeof body === "object" ? [body] : [];
  if (events.length === 0) return NextResponse.json({ error: "No events" }, { status: 400 });
  if (events.length > 200) return NextResponse.json({ error: "At most 200 events per request" }, { status: 400 });
  const ip = clientIp(req);
  // The phone's clock at the moment it sent this batch. Read against our own clock in the same
  // request, it measures the phone's offset, so a fix captured at 21:58 and uploaded at 22:30 after
  // an outage keeps its 21:58, and a phone whose clock is wrong is corrected rather than believed.
  const sentAtMs = body && typeof body === "object" && !Array.isArray(body) ? Date.parse(String((body as { sentAt?: unknown }).sentAt ?? "")) : NaN;
  const offsetMs = Number.isFinite(sentAtMs) ? Date.now() - sentAtMs : NaN;
  const clockOffsetMs = Number.isFinite(offsetMs) && Math.abs(offsetMs) < 7 * 24 * 3_600_000 ? offsetMs : undefined;
  await db.gatewayDevice.update({ where: { id: auth.device.id }, data: { lastSeenAt: new Date(), lastIp: ip, ...(auth.device.status === "OFFLINE" ? { status: "ONLINE" } : {}) } });
  const acks = await processGatewayEvents(auth.device, events, { ip, clockOffsetMs });
  return NextResponse.json({ ok: true, acks });
}
