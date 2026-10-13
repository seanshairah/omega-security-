/**
 * SMS provider abstraction.
 *
 * Every gateway is wrapped in an object that can send a message and parse an inbound webhook.
 * The active provider is chosen by SMS_PROVIDER. Business logic never talks to a gateway directly.
 */

export type SendResult = {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
};

export type InboundMessage = {
  from: string; // raw sender as the gateway gives it
  to?: string;
  body: string;
  providerMessageId?: string;
  receivedAt?: Date;
};

export type WebhookRequest = {
  headers: Headers;
  url: string;
  rawBody: string;
  contentType: string;
};

export interface SmsProvider {
  readonly name: string;
  /** Send one message. Must not throw for gateway errors — return ok:false. */
  sendSMS(to: string, body: string): Promise<SendResult>;
  /** Verify the inbound webhook is genuine. */
  verifyWebhook(req: WebhookRequest): Promise<boolean>;
  /** Turn an inbound webhook into zero or more messages. */
  parseInbound(req: WebhookRequest): Promise<InboundMessage[]>;
  /** Delivery reports carried by the same webhook, if the gateway sends them. */
  parseDeliveryReports?(req: WebhookRequest): Promise<DeliveryReport[]>;
  /** What the gateway expects back from the webhook. */
  webhookResponse(): Response;
}

export type DeliveryReport = { providerMessageId: string; status: "DELIVERED" | "FAILED" | "SENT"; error?: string };

export type ProviderConfig = {
  apiKey: string;
  apiSecret: string;
  senderId: string;
  webhookSecret: string;
  httpSendUrl: string;
};

export function providerConfig(): ProviderConfig {
  return {
    apiKey: process.env.SMS_API_KEY ?? "",
    apiSecret: process.env.SMS_API_SECRET ?? "",
    senderId: process.env.SMS_SENDER_ID ?? "SENTINEL",
    webhookSecret: process.env.SMS_WEBHOOK_SECRET ?? "",
    httpSendUrl: process.env.SMS_HTTP_SEND_URL ?? "",
  };
}

/** Parse a form-encoded or JSON webhook body into a flat record. */
export function parseBody(req: WebhookRequest): Record<string, string> {
  const out: Record<string, string> = {};
  if (!req.rawBody) return out;
  if (req.contentType.includes("application/json")) {
    try {
      const json = JSON.parse(req.rawBody);
      for (const [k, v] of Object.entries(json)) out[k] = typeof v === "string" ? v : JSON.stringify(v);
    } catch {
      /* ignore */
    }
    return out;
  }
  const params = new URLSearchParams(req.rawBody);
  params.forEach((v, k) => (out[k] = v));
  return out;
}
