import { db } from "@/lib/db";
import type { SmsType } from "@prisma/client";
import { getProvider } from "./index";
import { getTemplateBody, renderTemplate, type TemplateVars } from "./templates";
import { getSettings } from "@/lib/settings";
import { fmtTime, fmtDate } from "@/lib/time";
import { audit } from "@/lib/audit";
import type { ShiftWithRelations } from "@/lib/services/shifts";

/** Variables available to every template, built from a shift. */
export function shiftVars(shift: ShiftWithRelations, extra: TemplateVars = {}): TemplateVars {
  return {
    guard_name: `${shift.guard.firstName} ${shift.guard.lastName}`,
    location: shift.location.name,
    start_time: fmtTime(shift.startAt),
    end_time: fmtTime(shift.endAt),
    date: fmtDate(shift.startAt),
    supervisor_name: shift.supervisor?.name ?? "your supervisor",
    ...extra,
  };
}

export type SendOptions = {
  to: string;
  body: string;
  type: SmsType;
  guardId?: string | null;
  shiftId?: string | null;
  locationId?: string | null;
  actor?: string;
  userId?: string | null;
};

/** Send one raw message and log it. Never throws for gateway errors. */
export async function sendSms(opts: SendOptions) {
  const provider = getProvider();
  const settings = await getSettings();
  const sig = settings["general.smsSignature"]?.trim();
  const body = sig && !opts.body.includes(sig) ? `${opts.body} ${sig}` : opts.body;
  const from = process.env.SMS_SENDER_ID ?? "SENTINEL";

  const msg = await db.smsMessage.create({
    data: {
      direction: "OUTBOUND",
      fromNumber: from,
      toNumber: opts.to,
      body,
      type: opts.type,
      status: "QUEUED",
      provider: provider.name,
      guardId: opts.guardId ?? null,
      shiftId: opts.shiftId ?? null,
      locationId: opts.locationId ?? null,
    },
  });

  const result = await provider.sendSMS(opts.to, body);
  const updated = await db.smsMessage.update({
    where: { id: msg.id },
    data: { status: result.ok ? "SENT" : "FAILED", providerMessageId: result.providerMessageId ?? null, error: result.error ?? null },
  });
  await audit({
    userId: opts.userId ?? null,
    actor: opts.actor ?? "system",
    action: result.ok ? "SMS_SENT" : "SMS_FAILED",
    entity: "SmsMessage",
    entityId: msg.id,
    details: { to: opts.to, type: opts.type, provider: provider.name, error: result.error ?? undefined },
  });
  return updated;
}

/** Render a template for a shift and send it to the shift's guard. */
export async function sendTemplated(shift: ShiftWithRelations, templateKey: string, type: SmsType, extra: TemplateVars = {}) {
  const settings = await getSettings();
  const template = await getTemplateBody(templateKey);
  const body = renderTemplate(template, { ...shiftVars(shift, extra), company: settings["general.companyName"] });
  return sendSms({ to: shift.guard.phone, body, type, guardId: shift.guardId, shiftId: shift.id, locationId: shift.locationId });
}
