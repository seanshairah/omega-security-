/**
 * Messages to clients about their site, guard, shift or incident.
 *
 * Everything that goes to a client passes through here, whether a person wrote it or a rule did:
 * the client comes from the site, the recipient comes from the site or client record, every
 * message is stored with what it was about and who sent it, and its status is what the provider
 * said, never what we hoped. See policy.ts for who may send what and what each status means.
 */
import { type Prisma, type ClientNotification, type ClientNotificationType, type MessageChannel, type Client, type Location } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { getProvider } from "@/lib/sms";
import { sendSms } from "@/lib/sms/outbound";
import { getSettings } from "@/lib/settings";
import { fmtDate, fmtTime } from "@/lib/time";
import { normalisePhone, isValidPhone } from "@/lib/phone";
import { getTemplateBody, renderTemplate, type TemplateVars } from "@/lib/sms/templates";
import { findLiveShiftForGuard, recordEvent } from "@/lib/services/shifts";
import { notify } from "@/lib/notifications";
import { NOTIFY_STATUS, NOTIFY_TYPES, NOTIFY_TYPE_ORDER, CHANNEL_NAME, canApprove, containsCoordinates, isSettled, manualKey, sendMode, type NotifyTone } from "./policy";
import type { Role } from "@prisma/client";

export class ClientNotificationError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export type ApprovedRecipient = { channel: MessageChannel; address: string; label: string };

type SiteWithClient = Location & { client: Client };

function phoneOrNull(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    const p = normalisePhone(raw);
    return isValidPhone(p) ? p : null;
  } catch {
    return null;
  }
}

const emailOrNull = (raw: string | null | undefined) => (raw && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim()) ? raw.trim().toLowerCase() : null);

/**
 * The only addresses a message about this site may go to: the numbers and emails recorded on the
 * site and on its client. Nothing typed into the composer is accepted.
 */
export function approvedRecipients(site: SiteWithClient): ApprovedRecipient[] {
  const out: ApprovedRecipient[] = [];
  const add = (channel: MessageChannel, address: string | null, label: string) => {
    if (address && !out.some((r) => r.channel === channel && r.address === address)) out.push({ channel, address, label });
  };
  add("SMS", phoneOrNull(site.clientUpdatePhone), "Site client-update number");
  add("SMS", phoneOrNull(site.contactPhone), `Site contact${site.contactName ? ` (${site.contactName})` : ""}`);
  add("SMS", phoneOrNull(site.client.contactPhone), `Client contact${site.client.contactName ? ` (${site.client.contactName})` : ""}`);
  add("EMAIL", emailOrNull(site.clientUpdateEmail), "Site client-update email");
  add("EMAIL", emailOrNull(site.client.contactEmail), `Client contact${site.client.contactName ? ` (${site.client.contactName})` : ""}`);
  return out;
}

/** The recipients rules use: the site's client-update number (or first contact), and its update email if it has one. */
export function ruleRecipients(site: SiteWithClient): ApprovedRecipient[] {
  const all = approvedRecipients(site);
  const sms = all.find((r) => r.channel === "SMS");
  const email = emailOrNull(site.clientUpdateEmail);
  return [...(sms ? [sms] : []), ...(email ? [{ channel: "EMAIL" as const, address: email, label: "Site client-update email" }] : [])];
}

/** Whether the configured provider can send this channel at all. */
export function channelAvailable(channel: MessageChannel): boolean {
  const p = getProvider();
  if (channel === "SMS") return true;
  if (channel === "EMAIL") return typeof p.sendEmail === "function";
  return typeof p.sendWhatsApp === "function";
}

// ── context: what a message is about ────────────────────────────────────────────────────────────

const siteInclude = { client: true } as const;

export type NotifyTarget = { shiftId?: string | null; guardId?: string | null; incidentId?: string | null; locationId?: string | null };

export type NotifyContext = {
  client: { id: string; name: string };
  site: { id: string; name: string };
  guard: { id: string; name: string } | null;
  shift: { id: string; startAt: Date; endAt: Date; status: string } | null;
  incident: { id: string; incidentNo: string; category: string } | null;
  siteRecord: SiteWithClient;
};

/**
 * Work out the client from the thing the message is about, never from the caller. An incident
 * names its site; a shift names its site; a guard's current shift names the site. The client is
 * always that site's client.
 */
export async function resolveTarget(t: NotifyTarget): Promise<NotifyContext> {
  let incident: NotifyContext["incident"] = null;
  let shiftId = t.shiftId ?? null;
  let guardId = t.guardId ?? null;
  let locationId = t.locationId ?? null;

  if (t.incidentId) {
    const i = await db.incident.findUnique({ where: { id: t.incidentId }, select: { id: true, incidentNo: true, category: true, shiftId: true, guardId: true, locationId: true } });
    if (!i) throw new ClientNotificationError("Incident not found", 404);
    incident = { id: i.id, incidentNo: i.incidentNo, category: i.category };
    shiftId = shiftId ?? i.shiftId; guardId = guardId ?? i.guardId; locationId = locationId ?? i.locationId;
  }
  let shift = shiftId ? await db.shift.findUnique({ where: { id: shiftId }, select: { id: true, startAt: true, endAt: true, status: true, guardId: true, locationId: true } }) : null;
  if (shiftId && !shift) throw new ClientNotificationError("Shift not found", 404);
  if (!shift && guardId && !locationId) {
    const live = await findLiveShiftForGuard(guardId);
    if (live) shift = { id: live.id, startAt: live.startAt, endAt: live.endAt, status: live.status, guardId: live.guardId, locationId: live.locationId };
  }
  if (shift) {
    if (locationId && shift.locationId !== locationId) throw new ClientNotificationError("That shift is at a different site.");
    if (guardId && shift.guardId !== guardId) throw new ClientNotificationError("That shift belongs to a different guard.");
    locationId = shift.locationId; guardId = shift.guardId;
  }
  if (!locationId) throw new ClientNotificationError("This guard has no current shift, so there is no client to notify. Open a shift or a site to send an update.");
  const site = await db.location.findUnique({ where: { id: locationId }, include: siteInclude });
  if (!site) throw new ClientNotificationError("Site not found", 404);
  const g = guardId ? await db.guard.findUnique({ where: { id: guardId }, select: { id: true, firstName: true, lastName: true } }) : null;
  return {
    client: { id: site.client.id, name: site.client.name },
    site: { id: site.id, name: site.name },
    guard: g ? { id: g.id, name: `${g.firstName} ${g.lastName}` } : null,
    shift: shift ? { id: shift.id, startAt: shift.startAt, endAt: shift.endAt, status: shift.status } : null,
    incident,
    siteRecord: site,
  };
}

async function vars(ctx: NotifyContext, at: Date): Promise<TemplateVars> {
  const s = await getSettings();
  return {
    company: s["general.companyName"],
    control_phone: s["general.controlRoomPhone"],
    client_name: ctx.client.name,
    site: ctx.site.name,
    guard_name: ctx.guard?.name ?? "the guard",
    start_time: ctx.shift ? fmtTime(ctx.shift.startAt) : "",
    end_time: ctx.shift ? fmtTime(ctx.shift.endAt) : "",
    time: fmtTime(at),
    date: fmtDate(at),
    incident_no: ctx.incident?.incidentNo ?? "",
  };
}

export async function draftMessage(ctx: NotifyContext, type: ClientNotificationType, at = new Date()): Promise<{ body: string; subject: string }> {
  const body = renderTemplate(await getTemplateBody(NOTIFY_TYPES[type].template), await vars(ctx, at));
  return { body, subject: `${NOTIFY_TYPES[type].subject} · ${ctx.site.name}` };
}

/** What the composer needs: who and what, the approved recipients, and a ready draft of every type. */
export async function composerContext(t: NotifyTarget, role: Role) {
  const ctx = await resolveTarget(t);
  const recipients = approvedRecipients(ctx.siteRecord).map((r) => ({ ...r, available: channelAvailable(r.channel) }));
  const now = new Date();
  const types = await Promise.all(NOTIFY_TYPE_ORDER.map(async (type) => ({
    type, label: NOTIFY_TYPES[type].label, sensitive: NOTIFY_TYPES[type].sensitive, mode: sendMode(role, type), ...(await draftMessage(ctx, type, now)),
  })));
  const suggested: ClientNotificationType = ctx.incident ? (ctx.incident.category === "ASSISTANCE_REQUEST" ? "ASSISTANCE" : "EMERGENCY") : ctx.shift ? "GUARD_VERIFIED" : "SITE_STATUS";
  return {
    client: ctx.client, site: ctx.site, guard: ctx.guard, incident: ctx.incident,
    shift: ctx.shift ? { id: ctx.shift.id, startAt: ctx.shift.startAt.toISOString(), endAt: ctx.shift.endAt.toISOString(), status: ctx.shift.status } : null,
    recipients, types, suggested,
  };
}

// ── creating and sending ────────────────────────────────────────────────────────────────────────

export type CreateInput = {
  ctx: NotifyContext;
  type: ClientNotificationType;
  channel: MessageChannel;
  recipient: string;
  message: string;
  subject?: string | null;
  /** Null when a rule produced it. */
  actor: { id: string; name: string; role: Role } | null;
  rule?: string | null;
  dedupeKey?: string | null;
  eventRef?: string | null;
  /** Save for approval instead of sending. Rules set it for sensitive types; people get it from their role. */
  draft?: boolean;
};

/**
 * Store the message, then send it unless it is a draft. A second call with the same dedupe key
 * returns the first message and sends nothing.
 */
export async function createClientNotification(input: CreateInput): Promise<{ notification: ClientNotification; deduped: boolean }> {
  const message = input.message.trim();
  if (message.length < 10) throw new ClientNotificationError("The message is too short.");
  if (message.length > 900) throw new ClientNotificationError("Keep the message under 900 characters.");
  if (!approvedRecipients(input.ctx.siteRecord).some((r) => r.channel === input.channel && r.address === input.recipient)) {
    throw new ClientNotificationError("That recipient is not on this site's or client's record. Add it to the site first.");
  }
  if (input.actor && input.actor.role !== "SUPER_ADMIN" && containsCoordinates(message)) {
    throw new ClientNotificationError("Remove the map coordinates. Client messages describe the post, not a position.");
  }
  const draft = input.draft ?? (input.actor ? sendMode(input.actor.role, input.type) === "DRAFT" : NOTIFY_TYPES[input.type].sensitive);

  const data = {
    clientId: input.ctx.client.id, locationId: input.ctx.site.id, guardId: input.ctx.guard?.id ?? null, shiftId: input.ctx.shift?.id ?? null, incidentId: input.ctx.incident?.id ?? null,
    type: input.type, channel: input.channel, recipient: input.recipient, message, subject: input.subject ?? null,
    status: draft ? "PENDING_APPROVAL" as const : "QUEUED" as const, sentById: input.actor?.id ?? null,
    rule: input.rule ?? null, dedupeKey: input.dedupeKey ?? null, eventRef: input.eventRef ?? null,
  };
  let row: ClientNotification;
  if (data.dedupeKey) {
    // One insert, refused quietly if the key exists: the second of two racing callers gets the first's row.
    const { count } = await db.clientNotification.createMany({ data: [data], skipDuplicates: true });
    row = (await db.clientNotification.findUnique({ where: { dedupeKey: data.dedupeKey } }))!;
    if (count === 0) return { notification: row, deduped: true };
  } else {
    row = await db.clientNotification.create({ data });
  }

  const who = input.actor?.name ?? `rule ${input.rule ?? ""}`.trim();
  await audit({ userId: input.actor?.id ?? null, actor: input.actor?.name ?? "system (client notification rule)", action: draft ? "CLIENT_NOTIFICATION_DRAFTED" : "CLIENT_NOTIFICATION_CREATED", entity: "ClientNotification", entityId: row.id, details: { type: input.type, channel: input.channel, to: input.recipient, rule: input.rule ?? undefined, eventRef: input.eventRef ?? undefined } });

  if (draft) {
    await notify({
      type: "CLIENT_NOTIFICATION_APPROVAL", severity: NOTIFY_TYPES[input.type].sensitive ? "CRITICAL" : "WARNING",
      title: `Client message awaiting approval: ${NOTIFY_TYPES[input.type].label.toLowerCase()}`,
      body: `${input.ctx.site.name} (${input.ctx.client.name}). Drafted by ${who}. Nothing has been sent.`,
      guardId: input.ctx.guard?.id ?? null, shiftId: input.ctx.shift?.id ?? null, incidentId: input.ctx.incident?.id ?? null,
      url: input.ctx.incident ? `/incidents/${input.ctx.incident.id}` : `/locations/${input.ctx.site.id}#client-messages`,
    }).catch(() => undefined);
    if (input.ctx.shift && input.ctx.guard) {
      await recordEvent(input.ctx.shift.id, input.ctx.guard.id, "ADMIN_NOTE", { source: input.actor ? "ADMIN" : "SYSTEM", note: `Client message drafted for approval (${NOTIFY_TYPES[input.type].label.toLowerCase()}, ${CHANNEL_NAME[input.channel]} to ${input.recipient}). Not sent.` }).catch(() => undefined);
    }
    return { notification: row, deduped: false };
  }
  return { notification: await deliver(row, input.actor), deduped: false };
}

/** Hand a QUEUED message to the provider and store exactly what it said. Never throws for provider errors. */
async function deliver(row: ClientNotification, actor: { id: string; name: string } | null): Promise<ClientNotification> {
  let smsMessageId: string | null = null;
  let ok = false;
  let reason: string | null = null;
  try {
    if (row.channel === "SMS") {
      const m = await sendSms({ to: row.recipient, body: row.message, type: "CLIENT_UPDATE", guardId: row.guardId, shiftId: row.shiftId, locationId: row.locationId, clientId: row.clientId, actor: actor?.name ?? "system (client notification)", userId: actor?.id ?? null });
      smsMessageId = m.id; ok = m.status !== "FAILED"; reason = m.error ?? null;
    } else {
      const provider = getProvider();
      const fn = row.channel === "EMAIL" ? provider.sendEmail?.bind(provider) : undefined;
      const wa = row.channel === "WHATSAPP" ? provider.sendWhatsApp?.bind(provider) : undefined;
      const m = await db.smsMessage.create({ data: { channel: row.channel, subject: row.subject, direction: "OUTBOUND", fromNumber: process.env.SMS_SENDER_ID ?? "OMEGASEC", toNumber: row.recipient, body: row.message, type: "CLIENT_UPDATE", status: "QUEUED", provider: provider.name, guardId: row.guardId, shiftId: row.shiftId, locationId: row.locationId, clientId: row.clientId } });
      const r = fn ? await fn(row.recipient, row.subject ?? "Update from the control room", row.message) : wa ? await wa(row.recipient, row.message) : { ok: false, error: `${provider.name} cannot send ${CHANNEL_NAME[row.channel].toLowerCase()}`, providerMessageId: undefined };
      await db.smsMessage.update({ where: { id: m.id }, data: { status: r.ok ? "SENT" : "FAILED", providerMessageId: r.providerMessageId ?? null, error: r.error ?? null } });
      smsMessageId = m.id; ok = r.ok; reason = r.error ?? null;
    }
  } catch (e) {
    reason = (e as Error).message;
  }
  const now = new Date();
  const updated = await db.clientNotification.update({
    where: { id: row.id },
    data: { status: ok ? "SENT" : "FAILED", failureReason: ok ? null : reason ?? "unknown error", smsMessageId, sentAt: ok ? now : null },
  });
  await audit({ userId: actor?.id ?? null, actor: actor?.name ?? "system (client notification)", action: ok ? "CLIENT_NOTIFICATION_SENT" : "CLIENT_NOTIFICATION_FAILED", entity: "ClientNotification", entityId: row.id, details: { type: row.type, channel: row.channel, to: row.recipient, error: ok ? undefined : reason ?? undefined } });
  if (row.shiftId && row.guardId) {
    const what = NOTIFY_TYPES[row.type].label.toLowerCase();
    await recordEvent(row.shiftId, row.guardId, "CLIENT_NOTIFIED", {
      at: now, source: actor ? "ADMIN" : "SYSTEM", smsMessageId: row.channel === "SMS" ? smsMessageId : null,
      note: ok
        ? `Client message sent by ${CHANNEL_NAME[row.channel]} to ${row.recipient} (${what})${actor ? ` by ${actor.name}` : ""}. Awaiting delivery report.`
        : `Client message by ${CHANNEL_NAME[row.channel]} to ${row.recipient} failed (${what}): ${reason ?? "unknown error"}.`,
    }).catch(() => undefined);
  }
  if (row.incidentId && ok && (row.type === "EMERGENCY" || row.type === "ASSISTANCE")) {
    await db.incident.update({ where: { id: row.incidentId }, data: { clientNotifiedAt: now } }).catch(() => undefined);
  }
  return updated;
}

/** Send a draft. The approver may edit the text first. Only one approval wins. */
export async function approveClientNotification(id: string, actor: { id: string; name: string; role: Role }, edits?: { message?: string | null }): Promise<ClientNotification> {
  const row = await db.clientNotification.findUnique({ where: { id } });
  if (!row) throw new ClientNotificationError("Message not found", 404);
  if (row.status !== "PENDING_APPROVAL") throw new ClientNotificationError(`This message is already ${NOTIFY_STATUS[row.status].label.toLowerCase()}.`, 409);
  if (!canApprove(actor.role, row.type)) throw new ClientNotificationError(NOTIFY_TYPES[row.type].sensitive ? "Only the super admin can approve this message." : "Only an operations admin can approve this message.", 403);
  const message = edits?.message?.trim() || row.message;
  if (message.length < 10) throw new ClientNotificationError("The message is too short.");
  if (actor.role !== "SUPER_ADMIN" && containsCoordinates(message)) throw new ClientNotificationError("Remove the map coordinates. Client messages describe the post, not a position.");
  const claimed = await db.clientNotification.updateMany({ where: { id, status: "PENDING_APPROVAL" }, data: { status: "QUEUED", approvedById: actor.id, approvedAt: new Date(), message } });
  if (claimed.count === 0) throw new ClientNotificationError("Someone else has already acted on this message.", 409);
  await audit({ userId: actor.id, actor: actor.name, action: "CLIENT_NOTIFICATION_APPROVED", entity: "ClientNotification", entityId: id, details: { type: row.type, edited: message !== row.message } });
  return deliver({ ...row, status: "QUEUED", message }, actor);
}

export async function discardClientNotification(id: string, actor: { id: string; name: string; role: Role }): Promise<ClientNotification> {
  const row = await db.clientNotification.findUnique({ where: { id } });
  if (!row) throw new ClientNotificationError("Message not found", 404);
  if (!canApprove(actor.role, row.type)) throw new ClientNotificationError("You cannot discard this message.", 403);
  const r = await db.clientNotification.updateMany({ where: { id, status: "PENDING_APPROVAL" }, data: { status: "DISCARDED", approvedById: actor.id, approvedAt: new Date() } });
  if (r.count === 0) throw new ClientNotificationError("Only a draft can be discarded.", 409);
  await audit({ userId: actor.id, actor: actor.name, action: "CLIENT_NOTIFICATION_DISCARDED", entity: "ClientNotification", entityId: id, details: { type: row.type } });
  return (await db.clientNotification.findUnique({ where: { id } }))!;
}

/** A message from the composer: validates the recipient and the role, then sends or drafts. */
export async function sendFromComposer(input: { target: NotifyTarget; type: ClientNotificationType; channel: MessageChannel; recipient: string; message: string; subject?: string | null; idempotencyKey: string; actor: { id: string; name: string; role: Role } }) {
  if (!NOTIFY_TYPES[input.type]) throw new ClientNotificationError("Choose what the message is about.");
  if (!input.idempotencyKey || input.idempotencyKey.length < 8) throw new ClientNotificationError("Missing idempotency key.");
  if (!channelAvailable(input.channel)) throw new ClientNotificationError(`${CHANNEL_NAME[input.channel]} is not available with the current provider.`);
  const ctx = await resolveTarget(input.target);
  return createClientNotification({
    ctx, type: input.type, channel: input.channel, recipient: input.recipient, message: input.message,
    subject: input.channel === "EMAIL" ? (input.subject?.trim() || NOTIFY_TYPES[input.type].subject) : null,
    actor: input.actor, dedupeKey: manualKey(input.idempotencyKey, input.channel, input.recipient),
    eventRef: ctx.incident ? `incident:${ctx.incident.id}` : ctx.shift ? `shift:${ctx.shift.id}` : `site:${ctx.site.id}`,
  });
}

// ── delivery reports ────────────────────────────────────────────────────────────────────────────

/** Carry a provider delivery report from the SMS log to the client message it belongs to. */
export async function applyDeliveryToNotifications(smsMessageIds: string[], status: "DELIVERED" | "FAILED" | "SENT", error?: string | null): Promise<number> {
  if (!smsMessageIds.length || status === "SENT") return 0;
  const r = await db.clientNotification.updateMany({
    where: { smsMessageId: { in: smsMessageIds }, status: { in: ["SENT", "QUEUED"] } },
    data: status === "DELIVERED" ? { status: "DELIVERED" } : { status: "FAILED", failureReason: error ?? "The provider reported it undelivered." },
  });
  return r.count;
}

// ── history ─────────────────────────────────────────────────────────────────────────────────────

export type NotificationView = {
  id: string; type: ClientNotificationType; typeLabel: string; sensitive: boolean;
  channel: MessageChannel; recipient: string; message: string; subject: string | null;
  status: ClientNotification["status"]; statusLabel: string; tone: NotifyTone; failureReason: string | null;
  site: { id: string; name: string } | null; client: { id: string; name: string };
  guard: { id: string; name: string } | null; shiftId: string | null; incident: { id: string; incidentNo: string } | null;
  sentBy: string | null; approvedBy: string | null; rule: string | null; eventRef: string | null;
  createdAt: string; sentAt: string | null; approvedAt: string | null; settled: boolean;
};

const viewInclude = {
  client: { select: { id: true, name: true } },
  location: { select: { id: true, name: true } },
  guard: { select: { id: true, firstName: true, lastName: true } },
  sentBy: { select: { name: true } },
  approvedBy: { select: { name: true } },
} as const;

type Row = Prisma.ClientNotificationGetPayload<{ include: typeof viewInclude }>;

async function toViews(rows: Row[]): Promise<NotificationView[]> {
  const incIds = [...new Set(rows.map((r) => r.incidentId).filter(Boolean))] as string[];
  const incidents = incIds.length ? await db.incident.findMany({ where: { id: { in: incIds } }, select: { id: true, incidentNo: true } }) : [];
  return rows.map((r) => ({
    id: r.id, type: r.type, typeLabel: NOTIFY_TYPES[r.type].label, sensitive: NOTIFY_TYPES[r.type].sensitive,
    channel: r.channel, recipient: r.recipient, message: r.message, subject: r.subject,
    status: r.status, statusLabel: NOTIFY_STATUS[r.status].label, tone: NOTIFY_STATUS[r.status].tone, failureReason: r.failureReason,
    site: r.location, client: r.client, guard: r.guard ? { id: r.guard.id, name: `${r.guard.firstName} ${r.guard.lastName}` } : null,
    shiftId: r.shiftId, incident: incidents.find((i) => i.id === r.incidentId) ?? null,
    sentBy: r.sentBy?.name ?? null, approvedBy: r.approvedBy?.name ?? null, rule: r.rule, eventRef: r.eventRef,
    createdAt: r.createdAt.toISOString(), sentAt: r.sentAt?.toISOString() ?? null, approvedAt: r.approvedAt?.toISOString() ?? null, settled: isSettled(r.status),
  }));
}

export async function notificationHistory(where: { clientId?: string; locationId?: string; guardId?: string; shiftId?: string; incidentId?: string; status?: ClientNotification["status"] }, take = 50): Promise<NotificationView[]> {
  const rows = await db.clientNotification.findMany({ where, include: viewInclude, orderBy: { createdAt: "desc" }, take });
  return toViews(rows);
}

export async function describeNotification(id: string): Promise<NotificationView | null> {
  const r = await db.clientNotification.findUnique({ where: { id }, include: viewInclude });
  return r ? (await toViews([r]))[0] : null;
}
