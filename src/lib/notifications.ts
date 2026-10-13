import { db } from "@/lib/db";
import type { NotificationSeverity } from "@prisma/client";

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
  return db.notification.create({
    data: {
      type: input.type,
      severity: input.severity ?? "INFO",
      title: input.title,
      body: input.body,
      guardId: input.guardId ?? null,
      shiftId: input.shiftId ?? null,
      incidentId: input.incidentId ?? null,
    },
  });
}

export async function unreadCount() {
  return db.notification.count({ where: { readAt: null } });
}
