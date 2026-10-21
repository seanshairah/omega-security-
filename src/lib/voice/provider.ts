/**
 * Programmable voice, behind one interface, so welfare calls with a key-press menu (IVR) can use a
 * real provider once one is contracted, without touching the welfare logic.
 *
 * No real provider is integrated. A normal Android phone cannot answer a call, play a prompt or read
 * keys, so IVR needs a provider (or a PBX). Candidates must be checked for Zimbabwe (+263) coverage,
 * per-minute cost and webhook signing before one is chosen; that is a cost the owner approves.
 * Until then VOICE_PROVIDER is unset, voice checks fall back to SMS, and only the simulated provider
 * exists, for tests. Nothing simulated is ever shown as a real response.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type PlaceCallResult = { ok: true; providerCallId: string } | { ok: false; error: string };

/**
 * One status report about one call. `reference` is the welfare check id the call was placed for,
 * passed to the provider as call metadata and echoed back: it finds the check even when the report
 * is for an earlier attempt whose call id has since been replaced.
 */
export type VoiceReport = { eventId: string; providerCallId: string; status: string; digits: string | null; at: Date; reference?: string | null };

export interface VoiceProvider {
  readonly name: string;
  /** Simulated providers never produce real evidence; everything they report is flagged. */
  readonly simulated: boolean;
  placeWelfareCall(input: { to: string; guardName: string; reference: string }): Promise<PlaceCallResult>;
  /** Parses a webhook body that has already passed `verifyVoiceWebhook`. */
  parseReport(body: unknown): VoiceReport | null;
}

/** The menu read to the guard. Kept here so the provider's script and the portal agree. */
export const WELFARE_PROMPT = "Omega Protection Services shift verification. Press 1 if your shift is going well. Press 2 if you need assistance. Press 3 for an emergency.";

class SimulatedVoiceProvider implements VoiceProvider {
  readonly name = "simulated";
  readonly simulated = true;
  async placeWelfareCall(input: { to: string; reference: string }): Promise<PlaceCallResult> {
    if (!input.to) return { ok: false, error: "no number" };
    return { ok: true, providerCallId: `simvoice_${input.reference}_${Date.now().toString(36)}` };
  }
  parseReport(body: unknown): VoiceReport | null {
    const b = body as Record<string, unknown>;
    if (!b || typeof b.eventId !== "string" || typeof b.callId !== "string" || typeof b.status !== "string") return null;
    const at = typeof b.at === "string" ? new Date(b.at) : new Date();
    return { eventId: b.eventId, providerCallId: b.callId, status: b.status, digits: typeof b.digits === "string" ? b.digits : null, at: Number.isNaN(at.getTime()) ? new Date() : at, reference: typeof b.reference === "string" ? b.reference : null };
  }
}

const REGISTRY: Record<string, () => VoiceProvider> = { simulated: () => new SimulatedVoiceProvider() };

/**
 * The simulated provider is refused in a production build unless ALLOW_SIMULATED_VOICE=1, so a
 * stray VOICE_PROVIDER=simulated on the live site can never produce welfare "responses".
 */
function allowed(name: string): boolean {
  if (name !== "simulated") return true;
  return process.env.NODE_ENV !== "production" || process.env.ALLOW_SIMULATED_VOICE === "1";
}

/** The configured provider, or null: then voice welfare checks are not placed and fall back to SMS. */
export function voiceProvider(): VoiceProvider | null {
  const name = (process.env.VOICE_PROVIDER ?? "").trim().toLowerCase();
  if (!name || !allowed(name)) return null;
  const make = REGISTRY[name];
  return make ? make() : null;
}

/** Only the configured provider's webhooks are accepted. */
export function voiceProviderByName(name: string): VoiceProvider | null {
  const configured = voiceProvider();
  return configured && configured.name === name ? configured : null;
}

/** Webhooks older or newer than this are refused: a captured request cannot be replayed later. */
export const WEBHOOK_MAX_SKEW_MS = 5 * 60_000;

export function signVoiceWebhook(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

/**
 * Check a webhook's signature and age. HMAC-SHA256 of "<timestamp>.<raw body>" with
 * VOICE_WEBHOOK_SECRET, in `x-voice-signature`, the Unix-millisecond timestamp in
 * `x-voice-timestamp`. No secret configured: every webhook is refused.
 */
export function verifyVoiceWebhook(secret: string | undefined, signature: string | null, timestamp: string | null, rawBody: string, now = Date.now()): { ok: true } | { ok: false; reason: string } {
  if (!secret) return { ok: false, reason: "no webhook secret configured" };
  if (!signature || !timestamp) return { ok: false, reason: "unsigned" };
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > WEBHOOK_MAX_SKEW_MS) return { ok: false, reason: "stale or future timestamp" };
  const expected = Buffer.from(signVoiceWebhook(secret, timestamp, rawBody), "hex");
  const given = Buffer.from(signature, "hex");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "bad signature" };
  return { ok: true };
}
