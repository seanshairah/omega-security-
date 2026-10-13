import { guarded } from "@/lib/api";
import { attendanceRows, toCsv } from "@/lib/services/attendance";

export const GET = guarded("SUPERVISOR", async (req) => {
  const q = new URL(req.url).searchParams;
  const rows = await attendanceRows({ from: q.get("from") ? new Date(q.get("from")!) : undefined, to: q.get("to") ? new Date(q.get("to")!) : undefined, guardId: q.get("guardId") ?? undefined, locationId: q.get("locationId") ?? undefined, clientId: q.get("clientId") ?? undefined, status: (q.get("status") as never) ?? undefined }, 5000);
  return new Response(toCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="attendance-${new Date().toISOString().slice(0, 10)}.csv"` } });
});
