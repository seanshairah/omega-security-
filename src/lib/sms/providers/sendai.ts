import type { SmsProvider, SendResult, WebhookRequest, InboundMessage, DeliveryReport } from "../provider";
import { parseBody, providerConfig } from "../provider";

/**
 * Sendai (sendai.co.zw) — Zimbabwean SMS gateway covering Econet, NetOne and Telecel.
 *
 *   SMS_PROVIDER=sendai
 *   SMS_API_KEY=sk_…              bearer key from the Sendai dashboard
 *   SMS_SENDER_ID=OMEGASEC        an approved sender identity (`address` in the sender-ID list)
 *   SMS_WEBHOOK_SECRET=whsec_…    signing secret shown once when the webhook endpoint is created
 *   SENDAI_WHATSAPP_IDENTITY_ID   id of a verified WhatsApp sender identity (optional; auto-picked if one exists)
 *   SENDAI_EMAIL_IDENTITY_ID      id of a verified email sender identity (optional; auto-picked if one exists)
 *
 * WhatsApp: POST /api/v1/whatsapp { sender_identity_id, to, body_text }   (undocumented, discovered by probing)
 * Email:    POST /api/v1/email    { sender_identity_id, to, subject, body_text }
 * Both need the Sendai account's email verified and a verified identity for that channel.
 *
 * Outbound: POST https://api.sendai.co.zw/api/v1/sms { to, from, message } → 202 { id, status }.
 * Webhook:  POST /api/sms/webhook/sendai, signed with X-Sendai-Signature = HMAC-SHA256(raw body).
 *           Delivery events: message.delivered / message.failed.
 *           Inbound SMS is enabled per account by Sendai; its payload is parsed leniently
 *           (from | sender | msisdn, message | text | body) and keyed on an event name
 *           containing "received" or "inbound", or on the absence of an event name.
 */
const BASE = process.env.SMS_SENDAI_BASE_URL ?? "https://api.sendai.co.zw";

export class SendaiProvider implements SmsProvider {
  readonly name = "sendai";

  async sendSMS(to: string, body: string): Promise<SendResult> {
    const cfg = providerConfig();
    if (!cfg.apiKey) return { ok: false, error: "SMS_API_KEY is not set" };
    if (!cfg.senderId) return { ok: false, error: "SMS_SENDER_ID is not set (must be an approved Sendai sender identity)" };
    try {
      const res = await fetch(`${BASE}/api/v1/sms`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ to: to.replace(/^\+/, ""), from: cfg.senderId, message: body }),
      });
      const text = await res.text();
      let json: { id?: string; status?: string; error?: { type?: string; message?: string; description?: string } | string; message?: string; data?: { id?: string } } = {};
      try { json = JSON.parse(text); } catch { /* non-JSON */ }
      if (!res.ok) {
        const err = json.message || (typeof json.error === "string" ? json.error : json.error?.description ?? json.error?.message ?? json.error?.type) || text.slice(0, 160);
        return { ok: false, error: `Sendai ${res.status}: ${err}` };
      }
      return { ok: true, providerMessageId: json.id ?? json.data?.id };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  async sendWhatsApp(to: string, body: string): Promise<SendResult> {
    const id = await identityFor("whatsapp");
    if (!id) return { ok: false, error: "No verified WhatsApp sender identity on the Sendai account (set SENDAI_WHATSAPP_IDENTITY_ID or register one)" };
    return postChannel("/api/v1/whatsapp", { sender_identity_id: id, to: to.replace(/^\+/, ""), body_text: body });
  }

  async sendEmail(to: string, subject: string, body: string): Promise<SendResult> {
    const id = await identityFor("email");
    if (!id) return { ok: false, error: "No verified email sender identity on the Sendai account (set SENDAI_EMAIL_IDENTITY_ID or register one)" };
    return postChannel("/api/v1/email", { sender_identity_id: id, to, subject, body_text: body });
  }

  async verifyWebhook(req: WebhookRequest): Promise<boolean> {
    const { webhookSecret } = providerConfig();
    if (!webhookSecret) return true; // not configured yet: accept, but set it before going live
    const sig = req.headers.get("x-sendai-signature") ?? "";
    if (!sig) return false;
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(webhookSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(req.rawBody)));
    const hex = Array.from(mac).map((b) => b.toString(16).padStart(2, "0")).join("");
    const b64 = Buffer.from(mac).toString("base64");
    const given = sig.replace(/^(sha256=|v1=)/, "").trim();
    return timingSafeEqual(given, hex) || timingSafeEqual(given, b64);
  }

  async parseInbound(req: WebhookRequest): Promise<InboundMessage[]> {
    const b = flatten(parseBody(req));
    const event = (b.event ?? b.type ?? "").toLowerCase();
    if (event && !/received|inbound|incoming|mo\b/.test(event)) return [];
    const from = b.from ?? b.sender ?? b.msisdn ?? b.source;
    const body = b.message ?? b.text ?? b.body ?? b.content;
    if (!from || !body) return [];
    return [{ from, to: b.to ?? b.sender_id ?? b.destination, body, providerMessageId: b.id ?? b.message_id, receivedAt: b.received_at ? new Date(b.received_at) : undefined }];
  }

  async parseDeliveryReports(req: WebhookRequest): Promise<DeliveryReport[]> {
    const b = flatten(parseBody(req));
    const event = (b.event ?? b.type ?? "").toLowerCase();
    const id = b.id ?? b.message_id ?? b.sms_id;
    if (!id) return [];
    if (event === "message.delivered" || b.delivered_at) return [{ providerMessageId: id, status: "DELIVERED" }];
    if (event === "message.failed" || b.status === "failed") return [{ providerMessageId: id, status: "FAILED", error: b.operator_response ?? b.error ?? "failed" }];
    return [];
  }

  webhookResponse(): Response {
    return Response.json({ ok: true });
  }
}

/** Sendai envelopes some payloads as { status, data: {…} } — lift `data` to the top level. */
function flatten(b: Record<string, string>): Record<string, string> {
  if (b.data) {
    try {
      const inner = JSON.parse(b.data) as Record<string, unknown>;
      const out: Record<string, string> = { ...b };
      for (const [k, v] of Object.entries(inner)) out[k] = typeof v === "string" ? v : v == null ? "" : JSON.stringify(v);
      return out;
    } catch { /* data was not JSON */ }
  }
  return b;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

type SendaiError = { status?: string; message?: string; error?: { type?: string; description?: string; code?: string } | string; data?: { field?: string; code?: string; message?: string }[] };

function describeError(status: number, json: SendaiError, text: string): string {
  if (Array.isArray(json.data) && json.data.length) return `Sendai ${status}: ${json.data.map((d) => d.message ?? d.code).join("; ")}`;
  const err = json.message || (typeof json.error === "string" ? json.error : json.error?.description ?? json.error?.type ?? json.error?.code) || text.slice(0, 160);
  return `Sendai ${status}: ${err}`;
}

async function postChannel(path: string, payload: Record<string, string>): Promise<SendResult> {
  const cfg = providerConfig();
  if (!cfg.apiKey) return { ok: false, error: "SMS_API_KEY is not set" };
  try {
    const res = await fetch(`${BASE}${path}`, { method: "POST", headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(payload) });
    const text = await res.text();
    let json: SendaiError & { id?: string; data?: never } = {};
    try { json = JSON.parse(text); } catch { /* non-JSON */ }
    if (!res.ok) return { ok: false, error: describeError(res.status, json as SendaiError, text) };
    const d = (json as { data?: { id?: string } }).data;
    return { ok: true, providerMessageId: json.id ?? d?.id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type SendaiIdentity = { id: string; channel: string; name: string; address: string; status: string; verification: string };

let identityCache: { at: number; items: SendaiIdentity[] } | null = null;

/** All sender identities on the account (SMS sender IDs, WhatsApp numbers, email addresses). */
export async function sendaiIdentities(): Promise<SendaiIdentity[]> {
  if (identityCache && Date.now() - identityCache.at < 60_000) return identityCache.items;
  const cfg = providerConfig();
  if (!cfg.apiKey) return [];
  try {
    const h = { Authorization: `Bearer ${cfg.apiKey}`, Accept: "application/json" };
    const tokens = (await (await fetch(`${BASE}/api/v1/api-tokens`, { headers: h })).json()) as { data?: { AccountId?: string }[] };
    const accountId = tokens.data?.[0]?.AccountId;
    if (!accountId) return [];
    const ids = (await (await fetch(`${BASE}/api/v1/accounts/${accountId}/channel-identities`, { headers: h })).json()) as { data?: { id: string; channel: string; name: string; address: string; status: string; verification_status: string }[] };
    const items = (ids.data ?? []).map((i) => ({ id: i.id, channel: i.channel, name: i.name, address: i.address, status: i.status, verification: i.verification_status }));
    identityCache = { at: Date.now(), items };
    return items;
  } catch {
    return [];
  }
}

async function identityFor(channel: "whatsapp" | "email"): Promise<string | null> {
  const fromEnv = channel === "whatsapp" ? process.env.SENDAI_WHATSAPP_IDENTITY_ID : process.env.SENDAI_EMAIL_IDENTITY_ID;
  if (fromEnv) return fromEnv;
  const ids = await sendaiIdentities();
  return ids.find((i) => i.channel === channel && i.status === "active" && i.verification === "verified")?.id ?? ids.find((i) => i.channel === channel)?.id ?? null;
}

/** Account status for the Settings page: balances and usable sender IDs. */
export async function sendaiAccountStatus(): Promise<{ ok: boolean; error?: string; balances: { currency: string; amount: number }[]; senderIds: { address: string; status: string; verification: string }[]; identities: SendaiIdentity[] }> {
  const cfg = providerConfig();
  if (!cfg.apiKey) return { ok: false, error: "SMS_API_KEY is not set", balances: [], senderIds: [], identities: [] };
  try {
    const h = { Authorization: `Bearer ${cfg.apiKey}`, Accept: "application/json" };
    const tokens = (await (await fetch(`${BASE}/api/v1/api-tokens`, { headers: h })).json()) as { data?: { AccountId?: string }[] };
    const accountId = tokens.data?.[0]?.AccountId;
    if (!accountId) return { ok: false, error: "Key accepted but no account id returned", balances: [], senderIds: [], identities: [] };
    const [bal, ids] = await Promise.all([
      fetch(`${BASE}/api/v1/accounts/${accountId}/balances`, { headers: h }).then((r) => r.json()) as Promise<{ data?: { currency: string; amount: number }[] }>,
      fetch(`${BASE}/api/v1/accounts/${accountId}/channel-identities`, { headers: h }).then((r) => r.json()) as Promise<{ data?: { id: string; name: string; address: string; status: string; verification_status: string; channel: string }[] }>,
    ]);
    const identities = (ids.data ?? []).map((i) => ({ id: i.id, channel: i.channel, name: i.name, address: i.address, status: i.status, verification: i.verification_status }));
    identityCache = { at: Date.now(), items: identities };
    return {
      ok: true,
      balances: (bal.data ?? []).map((b) => ({ currency: b.currency, amount: b.amount / 10000 })),
      senderIds: identities.filter((i) => i.channel === "sms").map((i) => ({ address: i.address, status: i.status, verification: i.verification })),
      identities,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message, balances: [], senderIds: [], identities: [] };
  }
}
