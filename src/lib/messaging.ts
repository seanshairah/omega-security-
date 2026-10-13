/**
 * Outbound messaging across channels. SMS goes through the SMS pipeline (templates, signature,
 * shift linkage); WhatsApp and email go through the same provider when it supports them.
 * Every message is logged in SmsMessage with its channel so the logs show one conversation.
 */
import { db } from "@/lib/db";
import type { MessageChannel, SmsType } from "@prisma/client";
import { getProvider } from "@/lib/sms";
import { sendSms } from "@/lib/sms/outbound";
import { audit } from "@/lib/audit";
import { findLiveShiftForGuard } from "@/lib/services/shifts";

export type Recipient = { guardId?: string; userId?: string; name: string; phone?: string | null; email?: string | null };

export type SendInput = {
  channel: MessageChannel;
  recipients: Recipient[];
  body: string;
  subject?: string;
  type?: SmsType;
  actor: { id: string; name: string };
};

export type SendOutcome = { name: string; to: string; ok: boolean; error?: string; messageId?: string };

export async function sendToRecipients(input: SendInput): Promise<SendOutcome[]> {
  const provider = getProvider();
  const out: SendOutcome[] = [];
  for (const r of input.recipients) {
    const to = input.channel === "EMAIL" ? r.email : r.phone;
    if (!to) {
      out.push({ name: r.name, to: "", ok: false, error: input.channel === "EMAIL" ? "No email address on file" : "No phone number on file" });
      continue;
    }
    if (input.channel === "SMS") {
      const shift = r.guardId ? await findLiveShiftForGuard(r.guardId) : null;
      const m = await sendSms({ to, body: input.body, type: input.type ?? "GENERAL", guardId: r.guardId, shiftId: shift?.id, locationId: shift?.locationId, actor: input.actor.name, userId: input.actor.id });
      out.push({ name: r.name, to, ok: m.status !== "FAILED", error: m.error ?? undefined, messageId: m.id });
      continue;
    }
    const fn = input.channel === "WHATSAPP" ? provider.sendWhatsApp?.bind(provider) : undefined;
    const fnEmail = input.channel === "EMAIL" ? provider.sendEmail?.bind(provider) : undefined;
    const msg = await db.smsMessage.create({
      data: { channel: input.channel, subject: input.subject ?? null, direction: "OUTBOUND", fromNumber: process.env.SMS_SENDER_ID ?? "OMEGASEC", toNumber: to, body: input.body, type: input.type ?? "GENERAL", status: "QUEUED", provider: provider.name, guardId: r.guardId ?? null },
    });
    const result = fn ? await fn(to, input.body) : fnEmail ? await fnEmail(to, input.subject ?? "Omega Security", input.body) : { ok: false, error: `${provider.name} does not support ${input.channel.toLowerCase()}` };
    await db.smsMessage.update({ where: { id: msg.id }, data: { status: result.ok ? "SENT" : "FAILED", providerMessageId: result.providerMessageId ?? null, error: result.error ?? null } });
    await audit({ userId: input.actor.id, actor: input.actor.name, action: result.ok ? "MESSAGE_SENT" : "MESSAGE_FAILED", entity: "SmsMessage", entityId: msg.id, details: { channel: input.channel, to, error: result.error } });
    out.push({ name: r.name, to, ok: result.ok, error: result.error, messageId: msg.id });
  }
  return out;
}

export const CHANNEL_LABEL: Record<MessageChannel, string> = { SMS: "SMS", WHATSAPP: "WhatsApp", EMAIL: "Email" };
