import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { voiceProviderByName, verifyVoiceWebhook } from "@/lib/voice/provider";
import { applyVoiceReport } from "@/lib/welfare/scheduled";

/**
 * Call status and key presses from the voice provider placing welfare calls.
 * Signed with VOICE_WEBHOOK_SECRET (HMAC-SHA256 of "<timestamp>.<raw body>"), at most five minutes
 * old, and applied once per event id. Only the configured provider is accepted.
 */
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: name } = await params;
  const provider = voiceProviderByName(name);
  if (!provider) return NextResponse.json({ error: "unknown provider" }, { status: 404 });
  const rawBody = await req.text();
  const check = verifyVoiceWebhook(process.env.VOICE_WEBHOOK_SECRET, req.headers.get("x-voice-signature"), req.headers.get("x-voice-timestamp"), rawBody);
  if (!check.ok) {
    await audit({ actor: "voice provider", action: "VOICE_WEBHOOK_REJECTED", details: { provider: name, reason: check.reason } });
    return NextResponse.json({ error: check.reason }, { status: 401 });
  }
  let body: unknown;
  try { body = JSON.parse(rawBody); } catch { return NextResponse.json({ error: "not JSON" }, { status: 400 }); }
  const report = provider.parseReport(body);
  if (!report) return NextResponse.json({ error: "not a call report" }, { status: 400 });
  try {
    const result = await applyVoiceReport(provider.name, provider.simulated, report);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    // Forget the event id and answer 500, so the provider's retry is applied rather than dropped as a duplicate.
    console.error("voice webhook failed", (e as Error).message);
    await db.voiceWebhookEvent.deleteMany({ where: { provider: provider.name, eventId: report.eventId } }).catch(() => undefined);
    await audit({ actor: "voice provider", action: "VOICE_WEBHOOK_ERROR", details: { provider: name, eventId: report.eventId, error: (e as Error).message } });
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}
