import { NextResponse } from "next/server";
import { authenticateGateway, clientIp, rateLimit } from "@/lib/gateway/auth";
import { heartbeat } from "@/lib/gateway/service";

/** POST /api/gateways/heartbeat  Bearer <deviceToken>  { appVersion, androidVersion, batteryLevel, networkType, timestamp } */
export async function POST(req: Request) {
  const auth = await authenticateGateway(req);
  if (!auth.device) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const rl = rateLimit(`hb:${auth.device.id}`, 30, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many heartbeats" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const { device, config } = await heartbeat(auth.device, { appVersion: s(b.appVersion), androidVersion: s(b.androidVersion), deviceModel: s(b.deviceModel), batteryLevel: typeof b.batteryLevel === "number" ? b.batteryLevel : undefined, networkType: s(b.networkType) }, clientIp(req));
  return NextResponse.json({ ok: true, deviceId: device.id, deviceName: device.deviceName, phoneNumber: device.phoneNumber, status: device.status, location: device.location ? { id: device.location.id, name: device.location.name, client: device.location.client.name } : null, config });
}
const s = (v: unknown) => (typeof v === "string" ? v : undefined);
