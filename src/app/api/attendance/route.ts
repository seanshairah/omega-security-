import { guarded, json } from "@/lib/api";
import { attendanceRows } from "@/lib/services/attendance";

export const GET = guarded("SUPERVISOR", async (req) => {
  const q = new URL(req.url).searchParams;
  const rows = await attendanceRows({ from: q.get("from") ? new Date(q.get("from")!) : undefined, to: q.get("to") ? new Date(q.get("to")!) : undefined, guardId: q.get("guardId") ?? undefined, locationId: q.get("locationId") ?? undefined, clientId: q.get("clientId") ?? undefined, status: (q.get("status") as never) ?? undefined });
  return json({ items: rows.map((s) => ({ id: s.id, startAt: s.startAt, endAt: s.endAt, guard: `${s.guard.firstName} ${s.guard.lastName}`, location: s.location.name, client: s.location.client.name, status: s.status, attendance: s.attendance })) });
});
