import { guarded, json, error } from "@/lib/api";
import { cancelCallRequest, CallRequestError, describeCallRequest } from "@/lib/gateway/call-requests";

type Ctx = { params: Promise<{ id: string }> };

/** One call request, as the call panel polls it. */
export const GET = guarded<Ctx>("SUPERVISOR", async (_req, ctx) => {
  const { id } = await ctx.params;
  const view = await describeCallRequest(id);
  return view ? json({ request: view }) : error("Call request not found", 404);
});

/** Withdraw a request before the phone starts the call. After that it is left as it is: the call is real. */
export const DELETE = guarded<Ctx>("SUPERVISOR", async (_req, ctx, user) => {
  const { id } = await ctx.params;
  try {
    await cancelCallRequest(id, { userId: user.id, name: user.name });
    return json({ request: await describeCallRequest(id) });
  } catch (e) {
    if (e instanceof CallRequestError) return error(e.message, e.status);
    throw e;
  }
});
