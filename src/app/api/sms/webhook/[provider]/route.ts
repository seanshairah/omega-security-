import { NextResponse } from "next/server";
import { applyDeliveryToNotifications } from "@/lib/client-notifications/service";
import { db } from "@/lib/db";
import { getProvider, PROVIDER_NAMES } from "@/lib/sms";
import type { WebhookRequest } from "@/lib/sms/provider";
import { processIncomingMessage } from "@/lib/sms/pipeline";
import { audit } from "@/lib/audit";

/**
 * Inbound SMS and delivery reports from the gateway.
 * Always answers 2xx once the request is authenticated, so the gateway never retries a business error.
 */
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: name } = await params;
  if (!PROVIDER_NAMES.includes(name)) return NextResponse.json({ error: "unknown provider" }, { status: 404 });
  const provider = getProvider(name);
  const wreq: WebhookRequest = { headers: req.headers, url: req.url, rawBody: await req.text(), contentType: req.headers.get("content-type") ?? "" };

  if (!(await provider.verifyWebhook(wreq))) {
    await audit({ actor: "sms gateway", action: "SMS_WEBHOOK_REJECTED", details: { provider: name, reason: "signature" } });
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const results: unknown[] = [];
  try {
    for (const report of (await provider.parseDeliveryReports?.(wreq)) ?? []) {
      const r = await db.smsMessage.updateMany({ where: { providerMessageId: report.providerMessageId, provider: name }, data: { status: report.status, error: report.error ?? null } });
      results.push({ delivery: report, updated: r.count });
      // A client message takes its status from the provider's report, never from having been queued.
      if (r.count) {
        try {
          const ids = (await db.smsMessage.findMany({ where: { providerMessageId: report.providerMessageId, provider: name }, select: { id: true } })).map((m) => m.id);
          await applyDeliveryToNotifications(ids, report.status, report.error);
        } catch (e) {
          console.error("client notification delivery update failed", e);
        }
      }
    }
    for (const msg of await provider.parseInbound(wreq)) {
      const r = await processIncomingMessage({ from: msg.from, body: msg.body, provider: name, providerMessageId: msg.providerMessageId, receivedAt: msg.receivedAt });
      results.push({ inbound: { interpreted: r.interpreted, action: r.action } });
    }
  } catch (e) {
    console.error("webhook processing failed", e);
    await audit({ actor: "sms gateway", action: "SMS_WEBHOOK_ERROR", details: { provider: name, error: (e as Error).message } });
  }
  if (results.length === 0) await audit({ actor: "sms gateway", action: "SMS_WEBHOOK_IGNORED", details: { provider: name, body: wreq.rawBody.slice(0, 500) } });
  return provider.webhookResponse();
}

export async function GET() {
  return NextResponse.json({ ok: true, providers: PROVIDER_NAMES });
}
