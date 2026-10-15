import { guarded } from "@/lib/api";
import { callRows, toCallsCsv } from "@/lib/gateway/calls";

export const GET = guarded("SUPERVISOR", async (req) => {
  const q = new URL(req.url).searchParams;
  const rows = await callRows({ from: q.get("from") ? new Date(q.get("from")!) : undefined, to: q.get("to") ? new Date(q.get("to")!) : undefined, guardId: q.get("guardId") ?? undefined, locationId: q.get("locationId") ?? undefined, clientId: q.get("clientId") ?? undefined, gatewayId: q.get("gatewayId") ?? undefined, status: (q.get("status") as never) ?? undefined, direction: (q.get("direction") as never) ?? undefined }, 5000);
  return new Response(toCallsCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="calls-${new Date().toISOString().slice(0, 10)}.csv"` } });
});
