import { db } from "@/lib/db";
import { guarded, json, error } from "@/lib/api";
import { rateLimit } from "@/lib/gateway/auth";
import { CallRequestError, createCallRequest, describeCallRequest, gatewayOptionsForGuard } from "@/lib/gateway/call-requests";

type Ctx = { params: Promise<{ id: string }> };

/** The gateway phones that could call this guard (best first, with why the others cannot), and the latest request. */
export const GET = guarded<Ctx>("SUPERVISOR", async (_req, ctx) => {
  const { id: guardId } = await ctx.params;
  const guard = await db.guard.findUnique({ where: { id: guardId }, select: { id: true, firstName: true, lastName: true, phone: true } });
  if (!guard) return error("Guard not found", 404);
  const [{ options }, latest] = await Promise.all([
    gatewayOptionsForGuard(guardId),
    db.callRequest.findFirst({ where: { guardId }, orderBy: { requestedAt: "desc" }, select: { id: true } }),
  ]);
  return json({ guard: { id: guard.id, name: `${guard.firstName} ${guard.lastName}`, phone: guard.phone }, gateways: options, latest: latest ? await describeCallRequest(latest.id) : null });
});

/** Ask a gateway phone to call this guard. Idempotent on `idempotencyKey`; returns the call in progress if there is one. */
export const POST = guarded<Ctx>("SUPERVISOR", async (req, ctx, user) => {
  const { id: guardId } = await ctx.params;
  const rl = rateLimit(`callreq:${user.id}`, 10, 60_000);
  if (!rl.ok) return error("Too many call requests. Wait a moment.", 429);
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  try {
    const { request, reused } = await createCallRequest({
      guardId, gatewayDeviceId: str(b.gatewayDeviceId), shiftId: str(b.shiftId), incidentId: str(b.incidentId), reason: str(b.reason),
      idempotencyKey: str(b.idempotencyKey) ?? "", actor: { userId: user.id, name: user.name },
    });
    return json({ request: await describeCallRequest(request.id), reused }, reused ? 200 : 201);
  } catch (e) {
    if (e instanceof CallRequestError) return error(e.message, e.status);
    throw e;
  }
});
