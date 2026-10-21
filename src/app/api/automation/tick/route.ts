import { NextResponse } from "next/server";
import { runScheduledTick } from "@/lib/automation/scheduler";
import { apiUser } from "@/lib/auth/rbac";

export const maxDuration = 60;

/**
 * Scheduler entry point.
 *   POST  from your own cron with Authorization: Bearer AUTOMATION_SECRET, or an admin session.
 *   GET   from Vercel Cron (vercel.json), which sends Authorization: Bearer CRON_SECRET.
 */
async function authorised(req: Request) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const secrets = [process.env.AUTOMATION_SECRET, process.env.CRON_SECRET].filter(Boolean);
  if (bearer && secrets.includes(bearer)) return true;
  const { status } = await apiUser("ADMIN");
  return status === 200;
}

async function handle(req: Request) {
  if (!(await authorised(req))) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  // Through the shared lease, so a cron call landing on top of a heartbeat-driven run does not run
  // the engine twice. A skipped call is still a success: the engine ran, just not because of it.
  const result = await runScheduledTick(req.headers.get("authorization") ? "cron" : "manual");
  return NextResponse.json(result.ran ? { ran: true, ...result.report } : { ran: false, skipped: result.reason });
}

export const GET = handle;
export const POST = handle;
