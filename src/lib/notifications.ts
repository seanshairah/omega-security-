import { db } from "@/lib/db";
import type { NotificationSeverity } from "@prisma/client";
import { pushToAll } from "@/lib/push";

/**
 * Dashboard notifications. One function, one table. Channels (email, WhatsApp, push)
 * can be added here later by fanning out from `notify` — callers do not change.
 */
export type NotifyInput = {
  type:
    | "GUARD_NOT_REPORTED"
    | "GUARD_LATE"
    | "ASSISTANCE_REQUESTED"
    | "INCIDENT_REPORTED"
    | "WELFARE_MISSED"
    | "SHIFT_COMPLETED"
    | "SHIFT_UNCONFIRMED"
    | "NO_RESPONSE"
    | "EMERGENCY"
    | "STILL_ON_DUTY"
    | "SHIFT_MISSED"
    | "GENERAL";
  severity?: NotificationSeverity;
  title: string;
  body: string;
  guardId?: string | null;
  shiftId?: string | null;
  incidentId?: string | null;
};

export async function notify(input: NotifyInput) {
  // A watched guard's events are never quiet: at least WARNING, and labelled.
  const watched = input.guardId ? await db.guard.findUnique({ where: { id: input.guardId }, select: { watched: true } }) : null;
  let severity: NotificationSeverity = input.severity ?? "INFO";
  let title = input.title;
  if (watched?.watched) {
    if (severity === "INFO") severity = "WARNING";
    title = `Watched · ${title}`;
  }
  const n = await db.notification.create({
    data: { type: input.type, severity, title, body: input.body, guardId: input.guardId ?? null, shiftId: input.shiftId ?? null, incidentId: input.incidentId ?? null },
  });
  const url = input.incidentId ? `/incidents/${input.incidentId}` : input.shiftId ? `/shifts/${input.shiftId}` : input.guardId ? `/guards/${input.guardId}` : "/notifications";
  if (severity !== "INFO" || watched?.watched) {
    pushToAll({ title, body: input.body, url, tag: n.id, critical: severity === "CRITICAL" }).catch(() => undefined);
  }
  return n;
}

export async function unreadCount() {
  return db.notification.count({ where: { readAt: null } });
}
