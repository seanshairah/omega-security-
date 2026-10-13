import type { SmsProvider, SendResult, WebhookRequest, InboundMessage } from "../provider";
import { parseBody } from "../provider";

/**
 * Demo provider. Nothing leaves the server. Outbound messages are stored as SENT,
 * inbound messages arrive through POST /api/sms/simulate (admin session) or the
 * webhook with the shared secret.
 */
export class SimulatedProvider implements SmsProvider {
  readonly name = "simulated";

  async sendSMS(): Promise<SendResult> {
    return { ok: true, providerMessageId: `sim_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}` };
  }

  async verifyWebhook(req: WebhookRequest): Promise<boolean> {
    const secret = process.env.SMS_WEBHOOK_SECRET;
    if (!secret) return true;
    return req.headers.get("x-webhook-secret") === secret || new URL(req.url).searchParams.get("key") === secret;
  }

  async parseInbound(req: WebhookRequest): Promise<InboundMessage[]> {
    const b = parseBody(req);
    if (!b.from || !b.body) return [];
    return [{ from: b.from, to: b.to, body: b.body, providerMessageId: b.id }];
  }

  webhookResponse(): Response {
    return Response.json({ ok: true });
  }
}
