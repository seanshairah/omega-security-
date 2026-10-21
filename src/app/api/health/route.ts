import { NextResponse } from "next/server";
import { db, usesNeonHttp } from "@/lib/db";
import { checkEnv } from "@/lib/env-check";
import { schedulerStatus } from "@/lib/automation/scheduler";

export const dynamic = "force-dynamic";

/** Unauthenticated liveness check that never exposes secrets. */
export async function GET() {
  const started = Date.now();
  const url = process.env.DATABASE_URL ?? "";
  let database: { ok: boolean; ms?: number; error?: string } = { ok: false };
  try {
    await db.$queryRaw`SELECT 1`;
    database = { ok: true, ms: Date.now() - started };
  } catch (e) {
    database = { ok: false, error: (e as Error).message.split("\n")[0].slice(0, 200) };
  }
  // When the engine last ran. Five minutes behind means arrival texts and shift-start checks are late.
  const scheduler = database.ok ? await schedulerStatus() : null;
  return NextResponse.json({
    ok: database.ok,
    database,
    scheduler,
    config: {
      databaseUrlSet: Boolean(url),
      databaseHost: process.env.NODE_ENV === "production" ? undefined : url.match(/@([^/:?]+)/)?.[1] ?? null,
      databaseTransport: usesNeonHttp() ? "neon-http" : "tcp",
      smsProvider: process.env.SMS_PROVIDER ?? "simulated",
      automationInProcess: process.env.AUTOMATION_INPROCESS !== "false",
      authSecretSet: Boolean(process.env.AUTH_SECRET),
      timezone: process.env.TZ ?? null,
      environment: process.env.NODE_ENV ?? "development",
      configIssues: checkEnv().length, // count only; details are logged at startup
      version: process.env.npm_package_version ?? null,
    },
  }, { status: database.ok ? 200 : 503 });
}
