/**
 * Site-status updates to clients by SMS.
 *
 * A location opts in (`clientUpdates`) and chooses which moments to report: the guard arrived,
 * the mid-shift welfare check came back fine, the shift ended. Messages go to the site's
 * client-update number, falling back to the site contact and then the client contact.
 * Failures never interrupt the guard's own flow: callers get a result, nothing throws.
 */
import { db } from "@/lib/db";
import type { Location, Client } from "@prisma/client";
import { getSettings } from "@/lib/settings";
import { fmtTime, fmtDate } from "@/lib/time";
import { normalisePhone } from "@/lib/phone";
import { sendSms } from "./outbound";
import { getTemplateBody, renderTemplate, type TemplateVars } from "./templates";
import { recordEvent, type ShiftWithRelations } from "@/lib/services/shifts";

export type ClientUpdateKind = "ARRIVAL" | "WELFARE_OK" | "SHIFT_ENDED";

const TEMPLATE: Record<ClientUpdateKind, string> = { ARRIVAL: "CLIENT_ARRIVAL", WELFARE_OK: "CLIENT_WELFARE_OK", SHIFT_ENDED: "CLIENT_SHIFT_ENDED" };
const FLAG: Record<ClientUpdateKind, keyof Location> = { ARRIVAL: "notifyClientArrival", WELFARE_OK: "notifyClientWelfare", SHIFT_ENDED: "notifyClientCompletion" };
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

export async function clientVars(shift: ShiftWithRelations, at: Date, extra: TemplateVars = {}): Promise<TemplateVars> {
  const settings = await getSettings();
  return {
    company: settings["general.companyName"],
    control_phone: settings["general.controlRoomPhone"],
    client_name: shift.location.client.name,
    site: shift.location.name,
    guard_name: `${shift.guard.firstName} ${shift.guard.lastName}`,
    start_time: fmtTime(shift.startAt),
    end_time: fmtTime(shift.endAt),
    time: fmtTime(at),
    date: fmtDate(at),
    ...extra,
  };
}

/**
 * Send one status update for a shift if the site has opted in to that moment.
 * Returns what happened so the caller can mention it in its own summary.
 */
export async function sendClientUpdate(shift: ShiftWithRelations, kind: ClientUpdateKind, at = new Date()): Promise<{ sent: boolean; reason?: string }> {
  try {
    const loc = shift.location;
    if (!loc.clientUpdates) return { sent: false, reason: "site has not opted in" };
    if (!loc[FLAG[kind]]) return { sent: false, reason: `site does not report "${KIND_LABEL[kind]}"` };
    const to = clientPhoneFor(loc);
    if (!to) return { sent: false, reason: "no client phone on the site or client" };
    const body = renderTemplate(await getTemplateBody(TEMPLATE[kind]), await clientVars(shift, at));
    const msg = await sendSms({ to, body, type: "CLIENT_UPDATE", guardId: shift.guardId, shiftId: shift.id, locationId: shift.locationId, clientId: loc.clientId, actor: "system (client update)" });
    await recordEvent(shift.id, shift.guardId, "CLIENT_NOTIFIED", { at, note: `Client updated by SMS (${KIND_LABEL[kind]}) on ${to}${msg.status === "FAILED" ? ` — delivery failed: ${msg.error ?? "unknown error"}` : ""}.`, smsMessageId: msg.id });
    return { sent: msg.status !== "FAILED", reason: msg.error ?? undefined };
  } catch (e) {
    return { sent: false, reason: (e as Error).message };
  }
}

/** Clients whose sites receive updates, for the audience pickers. */
export async function sitesWithClientUpdates() {
  return db.location.findMany({ where: { clientUpdates: true, active: true }, include: { client: true }, orderBy: { name: "asc" } });
}
