import type { SmsProvider, SendResult, WebhookRequest, InboundMessage } from "../provider";
import { parseBody, providerConfig } from "../provider";

/**
 * Twilio. SMS_API_KEY = Account SID, SMS_API_SECRET = Auth Token, SMS_SENDER_ID = Twilio number.
 * Inbound webhook is verified with X-Twilio-Signature (HMAC-SHA1 of url + sorted form params).
 */
export class TwilioProvider implements SmsProvider {
  readonly name = "twilio";

  async sendSMS(to: string, body: string): Promise<SendResult> {
    const cfg = providerConfig();
    try {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${cfg.apiKey}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: "Basic " + Buffer.from(`${cfg.apiKey}:${cfg.apiSecret}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: to, From: cfg.senderId, Body: body }),
      });
      const json = (await res.json()) as { sid?: string; message?: string };
      if (!res.ok) return { ok: false, error: json.message ?? `HTTP ${res.status}` };
      return { ok: true, providerMessageId: json.sid };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  async verifyWebhook(req: WebhookRequest): Promise<boolean> {
    const cfg = providerConfig();
    const sig = req.headers.get("x-twilio-signature");
    if (!cfg.apiSecret || !sig) return !cfg.apiSecret;
    const params = parseBody(req);
    const data = req.url + Object.keys(params).sort().map((k) => k + params[k]).join("");
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(cfg.apiSecret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
    const expected = Buffer.from(mac).toString("base64");
    return expected === sig;
  }

  async parseInbound(req: WebhookRequest): Promise<InboundMessage[]> {
    const b = parseBody(req);
    if (!b.From || !b.Body) return [];
    return [{ from: b.From, to: b.To, body: b.Body, providerMessageId: b.MessageSid }];
  }

  webhookResponse(): Response {
    // Empty TwiML: we reply via the API, not inline.
    return new Response("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>", { headers: { "Content-Type": "text/xml" } });
  }
}
