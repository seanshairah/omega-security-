import { NextResponse } from "next/server";
import { authenticateGateway, rateLimit } from "@/lib/gateway/auth";
import { acknowledgeProcessing, LocationRequestError } from "@/lib/gateway/location-requests";
import { acknowledgeCallRequest, CallRequestError } from "@/lib/gateway/call-requests";

/**
 * POST /api/gateways/commands/[id]/ack  Bearer <deviceToken>
 *   { status: "PROCESSING" }  a guard phone has started the GPS for a location request;
 *   { status: "AWAITING_CONFIRMATION" | "DIALING" | "FAILED" | "CANCELLED", detail? }  an operations
 *   phone reports what happened to a call request on its screen.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authenticateGateway(req);
  if (!auth.device) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const rl = rateLimit(`cmdack:${auth.device.id}`, 30, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many acknowledgements" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } });
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (auth.device.mode === "OPERATIONS_GATEWAY") {
    try {
      const r = await acknowledgeCallRequest(auth.device, id, String(b.status ?? ""), typeof b.detail === "string" ? b.detail : null);
      return NextResponse.json({ ok: true, id: r.id, status: r.status, expiresAt: r.expiresAt });
    } catch (e) { if (e instanceof CallRequestError) return NextResponse.json({ error: e.message }, { status: e.status }); throw e; }
  }
  if (b.status !== "PROCESSING") return NextResponse.json({ error: "status must be PROCESSING; results travel as LOCATION_REQUEST_RESULT events" }, { status: 400 });
  try {
    const r = await acknowledgeProcessing(auth.device, id);
    return NextResponse.json({ ok: true, id: r.id, status: r.status, expiresAt: r.expiresAt });
  } catch (e) { if (e instanceof LocationRequestError) return NextResponse.json({ error: e.message }, { status: e.status }); throw e; }
}
