import { NextResponse } from "next/server";
import { runAutomationTick } from "@/lib/automation/engine";
import { apiUser } from "@/lib/auth/rbac";

/** External cron entry point. Authorization: Bearer AUTOMATION_SECRET, or an admin session. */
export async function POST(req: Request) {
  const secret = process.env.AUTOMATION_SECRET;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const { status } = await apiUser("ADMIN");
  if (!(secret && bearer === secret) && status !== 200) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const report = await runAutomationTick();
  return NextResponse.json(report);
}
