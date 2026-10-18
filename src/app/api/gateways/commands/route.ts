import { NextResponse } from "next/server";
import { authenticateGateway, rateLimit } from "@/lib/gateway/auth";
import { commandPollSeconds, pendingCommandsForDevice } from "@/lib/gateway/location-requests";

/**
 * GET /api/gateways/commands  Bearer <deviceToken>
 * Lightweight poll for operations commands addressed to this phone (currently REQUEST_LOCATION).
 * Only the authenticated device's own commands are returned; the device never names itself.
 */
export async function GET(req: Request) {
  const auth = await authenticateGateway(req);
  if (!auth.device) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const rl = rateLimit(`cmd:${auth.device.id}`, 20, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many polls" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } });
  const [commands, pollSeconds] = await Promise.all([pendingCommandsForDevice(auth.device), commandPollSeconds()]);
  return NextResponse.json({ ok: true, commands, commandPollSeconds: pollSeconds, serverTime: new Date().toISOString() });
}
