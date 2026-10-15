import { guarded, json, paging } from "@/lib/api";
import { db } from "@/lib/db";
import { callRows, callsWhere, callMetrics, type CallFilter } from "@/lib/gateway/calls";

export const GET = guarded("SUPERVISOR", async (req) => {
  const url = new URL(req.url);
  const q = url.searchParams;
  const { take, skip, page } = paging(url);
  const f: CallFilter = { from: q.get("from") ? new Date(q.get("from")!) : undefined, to: q.get("to") ? new Date(q.get("to")!) : undefined, guardId: q.get("guardId") ?? undefined, locationId: q.get("locationId") ?? undefined, clientId: q.get("clientId") ?? undefined, gatewayId: q.get("gatewayId") ?? undefined, status: (q.get("status") as never) ?? undefined, direction: (q.get("direction") as never) ?? undefined, unknown: q.get("unknown") === "true" ? true : q.get("unknown") === "false" ? false : undefined, q: q.get("q") ?? undefined };
  const [items, total, metrics] = await Promise.all([callRows(f, take, skip), db.callLog.count({ where: callsWhere(f) }), callMetrics(f)]);
  return json({ items, total, page, metrics });
});
