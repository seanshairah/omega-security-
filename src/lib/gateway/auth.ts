/**
 * Gateway device authentication.
 *
 * A device is created in the portal with a short activation code. The phone exchanges the
 * code once for a long random token; only the SHA-256 hash of the token is stored. Every
 * later request carries `Authorization: Bearer <token>`. Revoking or disabling a device
 * makes its token useless immediately because every request re-reads the device row.
 */
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import type { GatewayDevice } from "@prisma/client";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I

export function generateActivationCode(length = 6): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

export function generateDeviceToken(): string {
  return "gw_" + randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type GatewayAuthResult = { device: GatewayDevice; error?: undefined } | { device?: undefined; error: string; status: 401 | 403 };

/** Resolve the device behind a request. Rejects revoked and disabled devices. */
export async function authenticateGateway(req: Request): Promise<GatewayAuthResult> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return { error: "Missing device token", status: 401 };
  const device = await db.gatewayDevice.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!device || device.activationStatus !== "ACTIVE") return { error: "Unknown or inactive device token", status: 401 };
  if (device.status === "REVOKED") return { error: "This gateway has been revoked", status: 403 };
  if (device.status === "DISABLED") return { error: "This gateway is disabled", status: 403 };
  return { device };
}

export function clientIp(req: Request): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? null;
}

// ── Rate limiting: a fixed window per key, kept in memory. On serverless hosts each instance
// keeps its own counters, so this is a brake on abuse rather than a precise quota.
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 5000) for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    return { ok: true, retryAfterSeconds: 0 };
  }
  b.count++;
  if (b.count > limit) return { ok: false, retryAfterSeconds: Math.ceil((b.resetAt - now) / 1000) };
  return { ok: true, retryAfterSeconds: 0 };
}

/** Test hook. */
export function resetRateLimits() {
  buckets.clear();
}
