/**
 * Inbound SMS pipeline.
 *
 *   identify phone → identify guard → find live shift → determine expected reply
 *   → normalise → validate → update record → trigger next action → notify → confirm by SMS
 *
 * Every path returns a `PipelineResult` so the webhook, the simulator and tests can see
 * exactly what the system understood.
 */
import { db } from "@/lib/db";
import type { PendingPrompt } from "@prisma/client";
import { normalisePhone } from "@/lib/phone";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { getSettingNumber, getSettings } from "@/lib/settings";
import { getTemplateBody, renderTemplate } from "./templates";
import { sendClientUpdate } from "./client-updates";
import { sendSms, sendTemplated } from "./outbound";
import { findLiveShiftForGuard, recordEvent, shiftInclude, type ShiftWithRelations } from "@/lib/services/shifts";
import { createIncident } from "@/lib/services/incidents";
import { fmtTime } from "@/lib/time";

export type Interpreted =
  | "YES" | "NO" | "WELL" | "ASSISTANCE" | "INCIDENT" | "EMERGENCY" | "INCIDENT_DESCRIPTION" | "FREE_TEXT" | "UNRECOGNISED";

export type PipelineResult = {
  messageId: string;
  guardId: string | null;
  shiftId: string | null;
  interpreted: Interpreted | "UNKNOWN_NUMBER";
  action: string;
  replySent: boolean;
};

const YES = new Set(["YES", "Y", "YEBO", "HONGU", "EHE", "ARRIVED", "ONSITE", "ON SITE", "CONFIRM", "CONFIRMED", "OK", "DONE"]);
const NO = new Set(["NO", "N", "NOT YET", "NOTYET", "KWETE", "CHA", "AIWA", "NOT ARRIVED"]);
const WELL = new Set(["1", "ONE", "WELL", "GOOD", "FINE", "OKAY", "ALL GOOD", "GOING WELL"]);
const HELP = new Set(["2", "TWO", "HELP", "ASSIST", "ASSISTANCE", "NEED ASSISTANCE", "SUPPORT"]);
const INC = new Set(["3", "THREE", "INCIDENT", "ALERT", "INCIDENT/ALERT", "REPORT"]);
const EMERG = new Set(["EMERGENCY", "SOS", "911", "999", "URGENT", "EMERG"]);

export function normaliseToken(body: string): string {
  return body.trim().toUpperCase().replace(/[.!?,;:'"()\-_]+/g, " ").replace(/\s+/g, " ").trim();
}

function classify(token: string, expected: PendingPrompt): Interpreted {
  if (EMERG.has(token)) return "EMERGENCY";
  if (expected === "INCIDENT_DESCRIPTION") return token.length >= 3 ? "INCIDENT_DESCRIPTION" : "UNRECOGNISED";
  if (INC.has(token)) return "INCIDENT";
  switch (expected) {
    case "ARRIVAL":
      if (YES.has(token)) return "YES";
      if (NO.has(token)) return "NO";
      return "UNRECOGNISED";
    case "WELFARE":
      if (WELL.has(token)) return "WELL";
      if (HELP.has(token)) return "ASSISTANCE";
      if (YES.has(token)) return "WELL"; // "ok" / "yes" to a welfare check means fine
      return "UNRECOGNISED";
    case "COMPLETION":
      if (YES.has(token)) return "YES";
      if (NO.has(token)) return "NO";
      return "UNRECOGNISED";
    default:
      if (HELP.has(token)) return "ASSISTANCE";
      if (YES.has(token) || WELL.has(token)) return "WELL";
      return "FREE_TEXT";
  }
}

export type IncomingInput = { from: string; body: string; provider: string; providerMessageId?: string; receivedAt?: Date };

export async function processIncomingMessage(input: IncomingInput): Promise<PipelineResult> {
  const now = input.receivedAt ?? new Date();
  const phone = normalisePhone(input.from);
  const settings = await getSettings();
  const company = settings["general.companyName"];

  // 1–2. store and identify the guard
  const guard = await db.guard.findUnique({ where: { phone } });
  const msg = await db.smsMessage.create({
    data: {
      direction: "INBOUND",
      fromNumber: phone,
      toNumber: process.env.SMS_SENDER_ID ?? "OMEGASEC",
      body: input.body,
      status: "RECEIVED",
      provider: input.provider,
      providerMessageId: input.providerMessageId,
      guardId: guard?.id ?? null,
      createdAt: now,
    },
  });
  await audit({ actor: "sms gateway", action: "SMS_RECEIVED", entity: "SmsMessage", entityId: msg.id, details: { from: phone, body: input.body, provider: input.provider } });

  if (!guard) {
    const body = renderTemplate(await getTemplateBody("UNKNOWN_NUMBER"), { company });
    await sendSms({ to: phone, body, type: "CLARIFICATION" });
    await db.smsMessage.update({ where: { id: msg.id }, data: { interpretedAs: "UNKNOWN_NUMBER" } });
    return { messageId: msg.id, guardId: null, shiftId: null, interpreted: "UNKNOWN_NUMBER", action: "Unknown number, replied with instructions", replySent: true };
  }

  // 3. find the live shift
  const shift = await findLiveShiftForGuard(guard.id, now);
  const token = normaliseToken(input.body);

  if (!shift) {
    const interpreted = EMERG.has(token) ? "EMERGENCY" : "FREE_TEXT";
    if (interpreted === "EMERGENCY") {
      const homeLocation = guard.homeLocationId ?? (await db.location.findFirst({ where: { active: true } }))?.id;
      const incident = homeLocation
        ? await createIncident({ guardId: guard.id, locationId: homeLocation, category: "EMERGENCY", severity: "CRITICAL", description: `EMERGENCY sent by SMS outside a scheduled shift: "${input.body}"`, source: "EMERGENCY", supervisorId: guard.supervisorId, actorName: "sms gateway" })
        : null;
      await notify({ type: "EMERGENCY", severity: "CRITICAL", title: `EMERGENCY from ${guard.firstName} ${guard.lastName}`, body: `Sent outside a scheduled shift at ${fmtTime(now)}. Call ${guard.phone} now.`, guardId: guard.id, incidentId: incident?.id });
      await sendSms({ to: phone, body: renderTemplate(await getTemplateBody("EMERGENCY_ACK"), { location: "your location", supervisor_name: "your supervisor", company }), type: "EMERGENCY", guardId: guard.id });
      await db.smsMessage.update({ where: { id: msg.id }, data: { interpretedAs: "EMERGENCY" } });
      return { messageId: msg.id, guardId: guard.id, shiftId: null, interpreted: "EMERGENCY", action: "Emergency outside a shift: incident created, admins notified", replySent: true };
    }
    await notify({ type: "GENERAL", severity: "INFO", title: `Message from ${guard.firstName} ${guard.lastName}`, body: `"${input.body}" (no active shift)`, guardId: guard.id });
    await sendSms({ to: phone, body: renderTemplate(await getTemplateBody("NO_ACTIVE_SHIFT"), { guard_name: guard.firstName, company }), type: "GENERAL", guardId: guard.id });
    await db.smsMessage.update({ where: { id: msg.id }, data: { interpretedAs: "FREE_TEXT" } });
    return { messageId: msg.id, guardId: guard.id, shiftId: null, interpreted: "FREE_TEXT", action: "No active shift; logged and acknowledged", replySent: true };
  }

  await db.smsMessage.update({ where: { id: msg.id }, data: { shiftId: shift.id, locationId: shift.locationId } });

  // 4–6. expected reply, normalise, validate
  const interpreted = classify(token, shift.pendingPrompt);
  const result = await applyInterpretation(shift, interpreted, input.body, msg.id, now);
  await db.smsMessage.update({ where: { id: msg.id }, data: { interpretedAs: interpreted } });
  return { messageId: msg.id, guardId: guard.id, shiftId: shift.id, interpreted, ...result };
}

async function reload(id: string): Promise<ShiftWithRelations> {
  return db.shift.findUniqueOrThrow({ where: { id }, include: shiftInclude });
}

async function applyInterpretation(shift: ShiftWithRelations, interpreted: Interpreted, rawBody: string, msgId: string, now: Date): Promise<{ action: string; replySent: boolean }> {
  const guardName = `${shift.guard.firstName} ${shift.guard.lastName}`;
  const sms = { source: "SMS" as const, smsMessageId: msgId, at: now };

  switch (interpreted) {
    case "EMERGENCY": {
      const incident = await createIncident({ guardId: shift.guardId, locationId: shift.locationId, shiftId: shift.id, category: "EMERGENCY", severity: "CRITICAL", description: `EMERGENCY keyword sent by ${guardName} at ${fmtTime(now)}.`, source: "EMERGENCY", supervisorId: shift.supervisorId, actorName: "sms gateway" });
      await db.shift.update({ where: { id: shift.id }, data: { status: "CRITICAL", emergencyAt: now, pendingPrompt: "INCIDENT_DESCRIPTION" } });
      await db.attendance.update({ where: { shiftId: shift.id }, data: { status: "INCIDENT" } });
      await recordEvent(shift.id, shift.guardId, "EMERGENCY", { ...sms, note: `EMERGENCY received. Incident ${incident.incidentNo} created.` });
      await notify({ type: "EMERGENCY", severity: "CRITICAL", title: `EMERGENCY ALERT RECEIVED FROM ${guardName.toUpperCase()} — ${shift.location.name.toUpperCase()} — ${fmtTime(now)}`, body: `Call ${shift.guard.phone} immediately. Supervisor: ${shift.supervisor?.name ?? "unassigned"}.`, guardId: shift.guardId, shiftId: shift.id, incidentId: incident.id });
      await sendTemplated(await reload(shift.id), "EMERGENCY_ACK", "EMERGENCY");
      return { action: `Emergency: shift marked critical, incident ${incident.incidentNo} created, admins notified`, replySent: true };
    }

    case "INCIDENT": {
      await db.shift.update({ where: { id: shift.id }, data: { status: shift.status === "CRITICAL" ? "CRITICAL" : "INCIDENT", pendingPrompt: "INCIDENT_DESCRIPTION" } });
      if (shift.pendingPrompt === "WELFARE") await db.welfareCheck.updateMany({ where: { shiftId: shift.id, response: "PENDING" }, data: { response: "INCIDENT", respondedAt: now } });
      await recordEvent(shift.id, shift.guardId, "WELFARE_INCIDENT", { ...sms, note: "Guard reported an incident. Awaiting description." });
      await sendTemplated(await reload(shift.id), "INCIDENT_PROMPT", "INCIDENT");
      return { action: "Incident flagged; asked the guard for a description", replySent: true };
    }

    case "INCIDENT_DESCRIPTION": {
      // After an EMERGENCY the incident already exists: attach the description to it.
      const openEmergency = shift.status === "CRITICAL" ? await db.incident.findFirst({ where: { shiftId: shift.id, category: "EMERGENCY", status: { in: ["OPEN", "ACKNOWLEDGED"] } }, orderBy: { createdAt: "desc" } }) : null;
      const incident = openEmergency
        ? await db.incident.update({ where: { id: openEmergency.id }, data: { description: `${openEmergency.description} Guard's description: ${rawBody.trim()}` } })
        : await createIncident({ guardId: shift.guardId, locationId: shift.locationId, shiftId: shift.id, category: "OTHER", severity: "HIGH", description: rawBody.trim(), source: "SMS", supervisorId: shift.supervisorId, actorName: "sms gateway" });
      // Return to the prompt that was interrupted: if the shift has ended, ask for completion; else nothing pending.
      const ended = shift.endAt <= now;
      await db.shift.update({ where: { id: shift.id }, data: { pendingPrompt: ended && shift.completionSmsSentAt ? "COMPLETION" : "NONE" } });
      await db.attendance.update({ where: { shiftId: shift.id }, data: { status: "INCIDENT" } });
      await recordEvent(shift.id, shift.guardId, "INCIDENT_REPORTED", { ...sms, note: `${incident.incidentNo}: ${rawBody.trim()}` });
      await notify({ type: "INCIDENT_REPORTED", severity: "CRITICAL", title: `Incident reported by ${guardName} at ${shift.location.name}`, body: rawBody.trim(), guardId: shift.guardId, shiftId: shift.id, incidentId: incident.id });
      await sendTemplated(await reload(shift.id), "INCIDENT_ACK", "INCIDENT");
      return { action: `Incident ${incident.incidentNo} recorded from the guard's description`, replySent: true };
    }

    case "ASSISTANCE": {
      await db.shift.update({ where: { id: shift.id }, data: { status: shift.status === "CRITICAL" ? "CRITICAL" : "ASSISTANCE", pendingPrompt: "NONE" } });
      await db.welfareCheck.updateMany({ where: { shiftId: shift.id, response: "PENDING" }, data: { response: "ASSISTANCE", respondedAt: now } });
      const incident = await createIncident({ guardId: shift.guardId, locationId: shift.locationId, shiftId: shift.id, category: "ASSISTANCE_REQUEST", severity: "HIGH", description: `${guardName} requested assistance by SMS at ${fmtTime(now)}.`, source: "SMS", supervisorId: shift.supervisorId, actorName: "sms gateway" });
      await recordEvent(shift.id, shift.guardId, "WELFARE_ASSISTANCE", { ...sms, note: "Guard needs assistance." });
      await notify({ type: "ASSISTANCE_REQUESTED", severity: "WARNING", title: `${guardName} needs assistance at ${shift.location.name}`, body: `Requested at ${fmtTime(now)}. Call ${shift.guard.phone}.`, guardId: shift.guardId, shiftId: shift.id, incidentId: incident.id });
      await sendTemplated(await reload(shift.id), "ASSISTANCE_ACK", "ASSISTANCE");
      return { action: "Assistance request recorded; supervisor notified", replySent: true };
    }

    case "WELL": {
      if (shift.pendingPrompt === "WELFARE") {
        await db.welfareCheck.updateMany({ where: { shiftId: shift.id, response: "PENDING" }, data: { response: "WELL", respondedAt: now } });
        const nextStatus = shift.status === "LATE" || shift.status === "ASSISTANCE" ? "ON_DUTY" : shift.status;
        await db.shift.update({ where: { id: shift.id }, data: { pendingPrompt: "NONE", status: nextStatus } });
        await recordEvent(shift.id, shift.guardId, "WELFARE_OK", { ...sms, note: "Guard replied: shift going well." });
        await sendTemplated(await reload(shift.id), "WELFARE_OK", "WELFARE");
        const cu = await sendClientUpdate(shift, "WELFARE_OK", now);
        return { action: `Welfare check: shift going well${cu.sent ? "; client updated" : ""}`, replySent: true };
      }
      // Nothing pending; a courtesy "ok". Log it, no state change.
      await recordEvent(shift.id, shift.guardId, "ADMIN_NOTE", { ...sms, note: `Guard message: "${rawBody.trim()}"` });
      return { action: "Nothing pending; message logged on the timeline", replySent: false };
    }

    case "YES": {
      if (shift.pendingPrompt === "ARRIVAL") {
        const lateMinutes = Math.max(0, Math.round((now.getTime() - shift.startAt.getTime()) / 60000));
        const grace = await getSettingNumber("arrival.graceMinutes");
        const isLate = lateMinutes > grace;
        await db.attendance.update({ where: { shiftId: shift.id }, data: { status: isLate ? "LATE" : "PRESENT", arrivalConfirmedAt: now, lateMinutes } });
        await db.shift.update({ where: { id: shift.id }, data: { status: "ON_DUTY", pendingPrompt: "NONE" } });
        await recordEvent(shift.id, shift.guardId, "ARRIVAL_CONFIRMED", { ...sms, note: isLate ? `Guard confirmed arrival, ${lateMinutes} min late.` : "Guard confirmed arrival." });
        if (isLate) await notify({ type: "GUARD_LATE", severity: "WARNING", title: `${guardName} arrived late at ${shift.location.name}`, body: `Confirmed at ${fmtTime(now)}, ${lateMinutes} min after the ${fmtTime(shift.startAt)} start.`, guardId: shift.guardId, shiftId: shift.id });
        await sendTemplated(await reload(shift.id), "ARRIVAL_CONFIRMED", "ARRIVAL");
        const cu = await sendClientUpdate(shift, "ARRIVAL", now);
        return { action: `${isLate ? `Arrival confirmed, ${lateMinutes} min late` : "Arrival confirmed, on time"}${cu.sent ? "; client updated" : ""}`, replySent: true };
      }
      if (shift.pendingPrompt === "COMPLETION") {
        await db.attendance.update({ where: { shiftId: shift.id }, data: { status: "COMPLETED", completionConfirmedAt: now } });
        await db.shift.update({ where: { id: shift.id }, data: { status: "COMPLETED", pendingPrompt: "NONE" } });
        await recordEvent(shift.id, shift.guardId, "COMPLETION_CONFIRMED", { ...sms, note: "Guard confirmed handover." });
        await recordEvent(shift.id, shift.guardId, "SHIFT_COMPLETED", { at: now, note: "Shift completed." });
        await notify({ type: "SHIFT_COMPLETED", severity: "INFO", title: `${guardName} completed the shift at ${shift.location.name}`, body: `Confirmed at ${fmtTime(now)}.`, guardId: shift.guardId, shiftId: shift.id });
        await sendTemplated(await reload(shift.id), "COMPLETION_CONFIRMED", "COMPLETION");
        const cu = await sendClientUpdate(shift, "SHIFT_ENDED", now);
        return { action: `Shift completed and confirmed${cu.sent ? "; client updated" : ""}`, replySent: true };
      }
      await recordEvent(shift.id, shift.guardId, "ADMIN_NOTE", { ...sms, note: `Guard message: "${rawBody.trim()}"` });
      return { action: "Nothing pending; message logged", replySent: false };
    }

    case "NO": {
      if (shift.pendingPrompt === "ARRIVAL") {
        await db.attendance.update({ where: { shiftId: shift.id }, data: { status: "NOT_REPORTED" } });
        await db.shift.update({ where: { id: shift.id }, data: { status: "NOT_CONFIRMED", pendingPrompt: "ARRIVAL" } }); // keep listening for a later YES
        await recordEvent(shift.id, shift.guardId, "ARRIVAL_DENIED", { ...sms, note: "Guard replied NO: not arrived." });
        await notify({ type: "GUARD_NOT_REPORTED", severity: "CRITICAL", title: `${guardName} has not arrived at ${shift.location.name}`, body: `Replied NO at ${fmtTime(now)}. Shift ${fmtTime(shift.startAt)}–${fmtTime(shift.endAt)}.`, guardId: shift.guardId, shiftId: shift.id });
        await sendTemplated(await reload(shift.id), "ARRIVAL_DENIED", "ARRIVAL");
        return { action: "Guard not arrived; supervisor notified", replySent: true };
      }
      if (shift.pendingPrompt === "COMPLETION") {
        await db.attendance.update({ where: { shiftId: shift.id }, data: { status: "STILL_ON_DUTY" } });
        await db.shift.update({ where: { id: shift.id }, data: { pendingPrompt: "COMPLETION" } });
        await recordEvent(shift.id, shift.guardId, "COMPLETION_DENIED", { ...sms, note: "Guard replied NO: still on duty." });
        await notify({ type: "STILL_ON_DUTY", severity: "WARNING", title: `${guardName} is still on duty at ${shift.location.name}`, body: `Shift ended ${fmtTime(shift.endAt)}, guard not relieved as of ${fmtTime(now)}.`, guardId: shift.guardId, shiftId: shift.id });
        await sendTemplated(await reload(shift.id), "COMPLETION_DENIED", "COMPLETION");
        return { action: "Guard still on duty; supervisor notified", replySent: true };
      }
      await recordEvent(shift.id, shift.guardId, "ADMIN_NOTE", { ...sms, note: `Guard message: "${rawBody.trim()}"` });
      return { action: "Nothing pending; message logged", replySent: false };
    }

    case "FREE_TEXT": {
      await recordEvent(shift.id, shift.guardId, "ADMIN_NOTE", { ...sms, note: `Guard message: "${rawBody.trim()}"` });
      await notify({ type: "GENERAL", severity: "INFO", title: `Message from ${guardName} (${shift.location.name})`, body: rawBody.trim(), guardId: shift.guardId, shiftId: shift.id });
      return { action: "Free text logged on the timeline and raised as a notification", replySent: false };
    }

    case "UNRECOGNISED":
    default: {
      const key = shift.pendingPrompt === "ARRIVAL" ? "CLARIFY_ARRIVAL" : shift.pendingPrompt === "WELFARE" ? "CLARIFY_WELFARE" : shift.pendingPrompt === "COMPLETION" ? "CLARIFY_COMPLETION" : null;
      await recordEvent(shift.id, shift.guardId, "UNRECOGNISED_REPLY", { ...sms, note: `Reply not understood: "${rawBody.trim()}"` });
      if (key) {
        await sendTemplated(shift, key, "CLARIFICATION");
        return { action: "Reply not understood; asked the guard to clarify", replySent: true };
      }
      return { action: "Reply not understood; logged", replySent: false };
    }
  }
}
