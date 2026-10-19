import { guarded, json, error } from "@/lib/api";
import { db } from "@/lib/db";
import { guardActivity, type ActivityCategory, type ActivitySeverity } from "@/lib/guard-activity";

const CATS: ActivityCategory[] = ["device", "gps", "geofence", "shift", "alert", "sms", "call", "request"];
const SEVS: ActivitySeverity[] = ["info", "success", "warning", "critical"];
const date = (v: string | null) => { if (!v) return undefined; const d = new Date(v); return Number.isNaN(d.getTime()) ? undefined : d; };

/** GET /api/guards/{id}/activity?before=ISO&since=ISO&limit=50&cat=alert,gps&severity=critical — merged, newest first, time-cursor paged. */
export const GET = guarded<{ params: Promise<{ id: string }> }>("SUPERVISOR", async (req, ctx) => {
  const { id } = await ctx.params;
  if (!(await db.guard.findUnique({ where: { id }, select: { id: true } }))) return error("Guard not found", 404);
  const u = new URL(req.url);
  const categories = (u.searchParams.get("cat") ?? "").split(",").filter((c): c is ActivityCategory => (CATS as string[]).includes(c));
  const sev = u.searchParams.get("severity");
  const limit = Number(u.searchParams.get("limit") ?? 50);
  const r = await guardActivity(id, { before: date(u.searchParams.get("before")), since: date(u.searchParams.get("since")), limit: Number.isFinite(limit) ? limit : 50, categories, severity: (SEVS as string[]).includes(sev ?? "") ? (sev as ActivitySeverity) : "all" });
  return json(r);
});
