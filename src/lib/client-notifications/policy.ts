/**
 * Pure rules for messages to clients (ClientNotification). No database.
 *
 * Who may send what:
 *   - routine updates (arrived, verified, late, missed check-in, shift completed, replacement,
 *     site status, all well, custom): an operations admin sends them; a supervisor drafts them
 *     for an admin to approve.
 *   - sensitive updates (absent, outside the site, emergency, assistance): only the super admin
 *     sends or approves them. Anyone else, and every rule, can only draft them.
 *
 * What a status means:
 *   PENDING_APPROVAL  drafted; nothing has been sent.
 *   QUEUED            being handed to the provider now.
 *   SENT              the provider accepted it. Not proof the client received it.
 *   DELIVERED         the provider reported delivery to the handset or mailbox.
 *   FAILED            the provider refused it, or reported it undelivered.
 *   DISCARDED         a draft someone chose not to send.
 */
import type { ClientNotificationStatus, ClientNotificationType, MessageChannel, Role } from "@prisma/client";

export type NotifyTone = "ok" | "warn" | "critical" | "info" | "neutral" | "muted";

export const NOTIFY_TYPES: Record<ClientNotificationType, { label: string; template: string; sensitive: boolean; subject: string }> = {
  GUARD_ARRIVED:          { label: "Guard arrived",            template: "CLIENT_ARRIVAL",          sensitive: false, subject: "Guard on site" },
  GUARD_VERIFIED:         { label: "Guard verified on site",   template: "CLIENT_VERIFIED",         sensitive: false, subject: "Guard verified on site" },
  GUARD_LATE:             { label: "Guard running late",       template: "CLIENT_LATE",             sensitive: false, subject: "Guard running late" },
  MISSED_CHECK_IN:        { label: "Missed check-in",          template: "CLIENT_MISSED_CHECK_IN",  sensitive: false, subject: "Check-in not confirmed" },
  GUARD_ABSENT:           { label: "Guard absent",             template: "CLIENT_ABSENT",           sensitive: true,  subject: "Guard absent" },
  GUARD_OUTSIDE:          { label: "Guard outside the site",   template: "CLIENT_OUTSIDE",          sensitive: true,  subject: "Guard away from the post" },
  EMERGENCY:              { label: "Emergency or incident",    template: "CLIENT_EMERGENCY",        sensitive: true,  subject: "Urgent: emergency reported" },
  ASSISTANCE:             { label: "Assistance requested",     template: "CLIENT_ASSISTANCE",       sensitive: true,  subject: "Assistance requested" },
  SHIFT_COMPLETED:        { label: "Shift completed",          template: "CLIENT_SHIFT_ENDED",      sensitive: false, subject: "Shift completed" },
  REPLACEMENT_DISPATCHED: { label: "Replacement dispatched",   template: "CLIENT_REPLACEMENT",      sensitive: false, subject: "Replacement guard on the way" },
  SITE_STATUS:            { label: "Site status update",       template: "CLIENT_SITE_STATUS",      sensitive: false, subject: "Site status update" },
  WELFARE_OK:             { label: "All well",                 template: "CLIENT_WELFARE_OK",       sensitive: false, subject: "All well on site" },
  CUSTOM:                 { label: "Custom message",           template: "CLIENT_CUSTOM",           sensitive: false, subject: "Update from the control room" },
};

/** The order the composer lists them in: the common ones first. */
export const NOTIFY_TYPE_ORDER: ClientNotificationType[] = [
  "GUARD_VERIFIED", "GUARD_ARRIVED", "GUARD_LATE", "MISSED_CHECK_IN", "GUARD_ABSENT", "GUARD_OUTSIDE",
  "EMERGENCY", "ASSISTANCE", "REPLACEMENT_DISPATCHED", "SHIFT_COMPLETED", "WELFARE_OK", "SITE_STATUS", "CUSTOM",
];

export const NOTIFY_STATUS: Record<ClientNotificationStatus, { label: string; tone: NotifyTone; detail: string }> = {
  PENDING_APPROVAL: { label: "Awaiting approval", tone: "warn",     detail: "Drafted. Nothing has been sent." },
  QUEUED:           { label: "Sending",           tone: "neutral",  detail: "Being handed to the provider." },
  SENT:             { label: "Sent",              tone: "info",     detail: "The provider accepted it. Delivery not yet confirmed." },
  DELIVERED:        { label: "Delivered",         tone: "ok",       detail: "The provider reported delivery." },
  FAILED:           { label: "Failed",            tone: "critical", detail: "Not delivered." },
  DISCARDED:        { label: "Discarded",         tone: "muted",    detail: "Draft not sent." },
};

export const CHANNEL_NAME: Record<MessageChannel, string> = { SMS: "SMS", WHATSAPP: "WhatsApp", EMAIL: "Email" };

const RANK: Record<Role, number> = { SUPERVISOR: 1, ADMIN: 2, SUPER_ADMIN: 3 };

/** The role that may send this type without anyone else's approval, and approve drafts of it. */
export function sendRoleFor(type: ClientNotificationType): Role {
  return NOTIFY_TYPES[type].sensitive ? "SUPER_ADMIN" : "ADMIN";
}

/** SEND: goes out now. DRAFT: saved for approval. */
export function sendMode(role: Role, type: ClientNotificationType): "SEND" | "DRAFT" {
  return RANK[role] >= RANK[sendRoleFor(type)] ? "SEND" : "DRAFT";
}

export const canApprove = (role: Role, type: ClientNotificationType) => sendMode(role, type) === "SEND";

/**
 * Something that reads like a map position: two decimals of at least four places, or a "lat"/"lng"
 * label with a number. Client messages state facts about the post, not where a guard's phone is.
 */
export function containsCoordinates(text: string): boolean {
  if (/-?\d{1,3}\.\d{4,}\s*[,;/ ]\s*-?\d{1,3}\.\d{4,}/.test(text)) return true;
  return /\b(lat|latitude|lng|lon|longitude)\b\s*[:=]?\s*-?\d{1,3}\.\d{3,}/i.test(text);
}

/**
 * One message per rule per shift (or incident) per channel. A repeated GPS fix, an event retried by
 * a phone, or a second engine tick builds the same key, and the second insert is refused.
 * ARRIVAL is shared by "guard arrived" (SMS YES) and "guard verified" (GPS) so a guard who does
 * both produces one message.
 */
export function ruleKey(rule: "ARRIVAL" | "LATE" | "OUTSIDE" | "EMERGENCY" | "SHIFT_ENDED" | "WELFARE_OK", ref: string, channel: MessageChannel): string {
  return `auto:${rule}:${ref}:${channel}`;
}

export const manualKey = (idempotencyKey: string, channel: MessageChannel, recipient: string) => `manual:${idempotencyKey}:${channel}:${recipient}`;

/** A terminal state: nothing further will change it. SENT can still become DELIVERED or FAILED. */
export const isSettled = (s: ClientNotificationStatus) => s === "DELIVERED" || s === "FAILED" || s === "DISCARDED";
