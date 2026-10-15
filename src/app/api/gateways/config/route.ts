import { NextResponse } from "next/server";
import { authenticateGateway, rateLimit } from "@/lib/gateway/auth";
import { guardDeviceConfig } from "@/lib/gateway/service";

/** GET /api/gateways/config  Bearer <deviceToken> — guard, live/next shift, site coordinates and radius, timing policy. Cached on the phone for offline use. */
export async function GET(req: Request) {
  const auth = await authenticateGateway(req);
  if (!auth.device) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const rl = rateLimit(`cfg:${auth.device.id}`, 60, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } });
  return NextResponse.json({ ok: true, deviceId: auth.device.id, deviceName: auth.device.deviceName, ...(await guardDeviceConfig(auth.device)) });
}
