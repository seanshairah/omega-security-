/**
 * Who runs the automation engine, and how often.
 *
 * The engine has to run about once a minute: it sends the arrival text at the shift start, asks
 * guard phones for their shift-start fix, and escalates what has run out of time. On Vercel nothing
 * runs between requests, and the GitHub Actions schedule meant to fill that gap fired four times on
 * 20 October 2026 instead of once every five minutes. A 16:00 shift got its arrival text at 16:50.
 *
 * So the engine now has four ways in, all through one lease so they can never overlap:
 *
 *   - the cron route (`POST /api/automation/tick`), from whatever external scheduler is configured;
 *   - every device heartbeat, after its response is sent, when the engine has not run for a minute.
 *     Guard and operations phones heartbeat every two minutes, all day, so while any phone is
 *     online the engine keeps time without depending on anyone's cron;
 *   - every portal page view, after its response, on the same one-minute rule, so a control room
 *     with the portal open keeps the engine running even with no phone online and no cron;
 *   - an admin's "run now".
 *
 * The lease is a row, not a lock held in memory: on serverless the next request may land on a
 * different instance, which knows nothing of the last one.
 */
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { runAutomationTick, type TickReport } from "./engine";

const JOB = "automation";
/** A run that has not released its lease by then is assumed to have died with its instance. */
const LEASE_MS = 120_000;

export type TickSource = "cron" | "heartbeat" | "portal" | "manual" | "in-process";

/** How long a source waits after the last run before it may start another. */
export const MIN_INTERVAL_MS: Record<TickSource, number> = {
  // Phones are many and frequent; one run a minute is what the engine needs.
  heartbeat: 55_000,
  // Anyone using the portal keeps the engine running too, with no phone online and no cron.
  portal: 55_000,
  // An external scheduler aimed at every minute should not run again on top of a heartbeat run.
  cron: 20_000,
  "in-process": 20_000,
  // A person asked for it: run unless a run is under way right now.
  manual: 0,
};

export type ScheduledResult =
  | { ran: true; report: TickReport }
  | { ran: false; reason: "recent" | "busy" };

async function ensureRow() {
  // skipDuplicates: the row usually exists, and a concurrent request may create it first.
  await db.schedulerLease.createMany({ data: [{ name: JOB, leaseUntil: new Date(0), lastRunAt: null }], skipDuplicates: true });
}

/**
 * Run the engine if this source is allowed to now. Never throws: the heartbeat that called it has
 * already answered the phone, and a scheduling problem must not turn into a device error.
 */
export async function runScheduledTick(source: TickSource, now = new Date()): Promise<ScheduledResult> {
  await ensureRow();
  const holder = `${source}:${randomUUID()}`;
  const notBefore = new Date(now.getTime() - MIN_INTERVAL_MS[source]);
  // One conditional UPDATE is the whole lock: the row moves only if nobody holds it and the last
  // run is old enough. Postgres serialises the two competing updates, so exactly one wins.
  const won = await db.schedulerLease.updateMany({
    where: {
      name: JOB,
      leaseUntil: { lt: now },
      ...(MIN_INTERVAL_MS[source] > 0 ? { OR: [{ lastRunAt: null }, { lastRunAt: { lte: notBefore } }] } : {}),
    },
    data: { holder, leaseUntil: new Date(now.getTime() + LEASE_MS) },
  });
  if (won.count !== 1) {
    const row = await db.schedulerLease.findUnique({ where: { name: JOB } });
    return { ran: false, reason: row && row.leaseUntil >= now ? "busy" : "recent" };
  }

  let report: TickReport | null = null;
  let error: string | null = null;
  try {
    report = await runAutomationTick(now);
    error = report.errors.length ? report.errors.slice(0, 5).join(" · ").slice(0, 500) : null;
  } catch (e) {
    error = (e as Error).message.slice(0, 500);
  }
  // Release only our own lease: if this run outlived it and someone else took over, leave theirs.
  await db.schedulerLease.updateMany({
    where: { name: JOB, holder },
    data: { leaseUntil: new Date(), lastRunAt: now, lastSource: source, lastError: error },
  });
  if (!report) return { ran: false, reason: "busy" };
  return { ran: true, report };
}

/** Called after a portal page has been rendered: the same check, so a busy portal never runs it twice. */
export const maybeTickFromPortal = () => maybeTickFromHeartbeat(new Date(), "portal");

/**
 * Called after a device heartbeat has been answered. Cheap when there is nothing to do: one read,
 * and no write unless the engine is due.
 */
export async function maybeTickFromHeartbeat(now = new Date(), source: "heartbeat" | "portal" = "heartbeat"): Promise<void> {
  if (source === "heartbeat" && process.env.AUTOMATION_HEARTBEAT_TICK === "false") return;
  try {
    const row = await db.schedulerLease.findUnique({ where: { name: JOB } });
    if (row?.lastRunAt && now.getTime() - row.lastRunAt.getTime() < MIN_INTERVAL_MS.heartbeat) return;
    if (row && row.leaseUntil >= now) return;
    await runScheduledTick(source, now);
  } catch {
    // The heartbeat has already been answered; a scheduling hiccup is retried on the next one.
  }
}

/** For /api/health and the portal: when the engine last ran, by what, and whether it is falling behind. */
export async function schedulerStatus(now = new Date()) {
  const row = await db.schedulerLease.findUnique({ where: { name: JOB } }).catch(() => null);
  const ageSeconds = row?.lastRunAt ? Math.round((now.getTime() - row.lastRunAt.getTime()) / 1000) : null;
  return {
    lastRunAt: row?.lastRunAt?.toISOString() ?? null,
    lastSource: row?.lastSource ?? null,
    lastError: row?.lastError ?? null,
    ageSeconds,
    // Five minutes without a run means arrival texts and shift-start checks are being delayed.
    behind: ageSeconds == null || ageSeconds > 300,
  };
}
