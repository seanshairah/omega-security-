import type { SmsProvider, SendResult, WebhookRequest, InboundMessage } from "../provider";
import { parseBody, providerConfig } from "../provider";

/**
 * Generic HTTP gateway for local Zimbabwean providers (BulkSMS ZW, Clickatell, an Econet aggregator…).
 * Outbound: POST SMS_HTTP_SEND_URL with JSON { to, from, message } and Authorization: Bearer SMS_API_KEY.
 * Inbound:  any JSON or form body with from/sender/msisdn and body/text/message, protected by X-Webhook-Secret.
 */
export class HttpProvider implements SmsProvider {
  readonly name = "http";

  async sendSMS(to: string, body: string): Promise<SendResult> {
    const cfg = providerConfig();
    if (!cfg.httpSendUrl) return { ok: false, error: "SMS_HTTP_SEND_URL is not set" };
    try {
      const res = await fetch(cfg.httpSendUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({ to, from: cfg.senderId, message: body }),
      });
      const text = await res.text();
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
      let id: string | undefined;
      try {
        const j = JSON.parse(text);
        id = j.id ?? j.messageId ?? j.message_id;
      } catch {
        /* non-JSON ok */
      }
      return { ok: true, providerMessageId: id };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  async verifyWebhook(req: WebhookRequest): Promise<boolean> {
    const { webhookSecret } = providerConfig();
    if (!webhookSecret) return true;
    return req.headers.get("x-webhook-secret") === webhookSecret || new URL(req.url).searchParams.get("key") === webhookSecret;
  }

  async parseInbound(req: WebhookRequest): Promise<InboundMessage[]> {
    const b = parseBody(req);
    const from = b.from ?? b.sender ?? b.msisdn ?? b.From;
    const body = b.body ?? b.text ?? b.message ?? b.Body;
    if (!from || !body) return [];
    return [{ from, to: b.to ?? b.To, body, providerMessageId: b.id ?? b.messageId }];
  }

  webhookResponse(): Response {
    return Response.json({ ok: true });
  }
}
