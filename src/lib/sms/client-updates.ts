/**
 * Site-status updates to clients by SMS.
 *
 * A location opts in (`clientUpdates`) and chooses which moments to report: the guard arrived,
 * the mid-shift welfare check came back fine, the shift ended. Messages go to the site's
 * client-update number, falling back to the site contact and then the client contact.
 * Failures never interrupt the guard's own flow: callers get a result, nothing throws.
 * The sending, history and dedupe live in lib/client-notifications.
 */
import { db } from "@/lib/db";
import type { Location, Client } from "@prisma/client";
import { normalisePhone } from "@/lib/phone";
import type { ShiftWithRelations } from "@/lib/services/shifts";

export type ClientUpdateKind = "ARRIVAL" | "WELFARE_OK" | "SHIFT_ENDED";

export const KIND_LABEL: Record<ClientUpdateKind, string> = { ARRIVAL: "guard on site", WELFARE_OK: "all well", SHIFT_ENDED: "shift ended" };

/** The number a site's client updates go to, or null when none is configured. */
export function clientPhoneFor(location: Location & { client: Client }): string | null {
  const raw = location.clientUpdatePhone || location.contactPhone || location.client.contactPhone;
  if (!raw) return null;
  try {
    return normalisePhone(raw);
  } catch {
    return raw.trim() || null;
  }
}

/**
 * Send one status update for a shift if the site has opted in to that moment. It goes through the
 * client-notification rules, so it is stored in the client's history, and a repeat (a second YES,
 * or a GPS check-in after an SMS one) sends nothing. Returns what happened so the caller can
 * mention it in its own summary.
 */
export async function sendClientUpdate(shift: ShiftWithRelations, kind: ClientUpdateKind, at = new Date()): Promise<{ sent: boolean; reason?: string }> {
  try {
    const { onGuardArrived, onShiftUpdate } = await import("@/lib/client-notifications/rules");
    const r = kind === "ARRIVAL"
      ? await onGuardArrived(shift.id, "GUARD_ARRIVED", `shift:${shift.id}:arrival`, at)
      // Welfare checks recur in a shift, so each minute is its own message; a retried reply is not.
      : await onShiftUpdate(shift.id, kind, at, kind === "WELFARE_OK" ? `${shift.id}:${Math.floor(at.getTime() / 60_000)}` : shift.id);
    if (r.sent) return { sent: true };
    return { sent: false, reason: r.skipped ?? (r.deduped ? "client already told" : r.failed ? "delivery failed" : undefined) };
  } catch (e) {
    return { sent: false, reason: (e as Error).message };
  }
}

/** Clients whose sites receive updates, for the audience pickers. */
export async function sitesWithClientUpdates() {
  return db.location.findMany({ where: { clientUpdates: true, active: true }, include: { client: true }, orderBy: { name: "asc" } });
}
