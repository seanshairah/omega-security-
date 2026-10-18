/**
 * Pure rules for "where is this guard phone right now?" requests (DeviceLocationRequest).
 * No database, no Android: shared by the server, the portal and the unit tests.
 *
 *   PENDING ──► DELIVERED ──► PROCESSING ──► COMPLETED | FAILED
 *      │            │              │
 *      └────────────┴──────────────┴──► EXPIRED (deadline passed) | CANCELLED (operations)
 *
 * A phone may answer straight from PENDING or DELIVERED (it acquired before acknowledging), so
 * COMPLETED/FAILED are reachable from any open state. Terminal states never change again:
 * a redelivered or replayed result is a no-op, and a stale answer cannot overwrite a newer one.
 */
import type { LocationRequestFailure, LocationRequestStatus } from "@prisma/client";

export type RequestStatus = LocationRequestStatus;
export type FailureReason = LocationRequestFailure;

export const OPEN_STATES: readonly RequestStatus[] = ["PENDING", "DELIVERED", "PROCESSING"];
export const TERMINAL_STATES: readonly RequestStatus[] = ["COMPLETED", "FAILED", "EXPIRED", "CANCELLED"];
export const FAILURE_REASONS: readonly FailureReason[] = ["PERMISSION_DENIED", "LOCATION_DISABLED", "GPS_TIMEOUT", "POOR_ACCURACY", "DEVICE_UNAVAILABLE", "REQUEST_EXPIRED", "SERVICE_RESTRICTED", "INTERNAL_ERROR"];

const TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  PENDING: ["DELIVERED", "PROCESSING", "COMPLETED", "FAILED", "EXPIRED", "CANCELLED"],
  DELIVERED: ["PROCESSING", "COMPLETED", "FAILED", "EXPIRED", "CANCELLED"],
  PROCESSING: ["COMPLETED", "FAILED", "EXPIRED", "CANCELLED"],
  COMPLETED: [], FAILED: [], EXPIRED: [], CANCELLED: [],
};

export const isOpen = (s: RequestStatus) => OPEN_STATES.includes(s);
export const isTerminalRequest = (s: RequestStatus) => TERMINAL_STATES.includes(s);
export const canTransition = (from: RequestStatus, to: RequestStatus) => TRANSITIONS[from].includes(to);

/** Limits that keep the feature cheap for the phone and honest for operations. */
export const REQUEST_LIMITS = {
  ttlSecondsDefault: 180, ttlSecondsMin: 60, ttlSecondsMax: 600,
  maxAccuracyMDefault: 100, maxAccuracyMMin: 10, maxAccuracyMMax: 1000,
  /** A result whose capturedAt is this long after expiresAt is still accepted (it was late on the network, not late on the GPS). */
  lateResultGraceSeconds: 60,
  /** Phone clocks drift; a capturedAt this far in the future is still believed. */
  clockSkewSeconds: 120,
  /** Requests per device per hour before the server says "slow down". */
  perDevicePerHour: 12,
  commandPollSecondsDefault: 30, commandPollSecondsMin: 15, commandPollSecondsMax: 300,
} as const;

/** The command the phone receives. Nothing in it is a coordinate: the phone measures, the server never suggests. */
export type LocationCommand = { id: string; type: "REQUEST_LOCATION"; requestedAt: string; expiresAt: string; maxAccuracyM: number; requireFreshFix: boolean };

export function commandFor(r: { id: string; requestedAt: Date; expiresAt: Date; maxAccuracyM: number; requireFreshFix: boolean }): LocationCommand {
  return { id: r.id, type: "REQUEST_LOCATION", requestedAt: r.requestedAt.toISOString(), expiresAt: r.expiresAt.toISOString(), maxAccuracyM: r.maxAccuracyM, requireFreshFix: r.requireFreshFix };
}

export const isExpired = (r: { expiresAt: Date }, now = new Date()) => r.expiresAt.getTime() <= now.getTime();

/**
 * Is a phone's claimed capture time believable for this request? It must fall after the request
 * was made (minus clock skew), before the deadline plus the late-network grace, and not in the
 * future beyond clock skew. A device cannot answer a request with a fix it took yesterday.
 */
export function capturePlausible(capturedAt: Date, r: { requestedAt: Date; expiresAt: Date }, now = new Date()): { ok: boolean; why?: string } {
  const t = capturedAt.getTime();
  if (!Number.isFinite(t)) return { ok: false, why: "capturedAt is not a time" };
  const skew = REQUEST_LIMITS.clockSkewSeconds * 1000;
  if (t < r.requestedAt.getTime() - skew) return { ok: false, why: "fix predates the request" };
  if (t > r.expiresAt.getTime() + REQUEST_LIMITS.lateResultGraceSeconds * 1000) return { ok: false, why: "fix taken after the deadline" };
  if (t > now.getTime() + skew) return { ok: false, why: "fix is in the future" };
  return { ok: true };
}

/** Portal wording and colours for each state. */
export const REQUEST_STATUS_META: Record<RequestStatus, { label: string; tone: "ok" | "warn" | "critical" | "neutral" | "muted" | "info"; detail: string }> = {
  PENDING: { label: "Queued", tone: "neutral", detail: "Waiting for the phone's next check-in. The phone polls for commands every half minute while it is online; if it is offline the request waits until it reconnects or expires." },
  DELIVERED: { label: "Delivered", tone: "info", detail: "The phone has received the request and is about to start the GPS." },
  PROCESSING: { label: "Locating", tone: "info", detail: "The phone is acquiring a fresh GPS fix. This takes up to a minute outdoors, longer indoors." },
  COMPLETED: { label: "Position received", tone: "ok", detail: "A fresh fix within the accuracy limit arrived from the phone." },
  FAILED: { label: "Failed", tone: "critical", detail: "The phone could not produce a usable position; the reason is shown." },
  EXPIRED: { label: "Expired", tone: "warn", detail: "No answer before the deadline. The phone may be off, offline, or restricted by its battery manager." },
  CANCELLED: { label: "Cancelled", tone: "muted", detail: "Withdrawn by operations before the phone answered." },
};

export const FAILURE_META: Record<FailureReason, string> = {
  PERMISSION_DENIED: "Location permission is denied on the phone. The guard must allow it (Always) in the app's settings.",
  LOCATION_DISABLED: "Location services are switched off on the phone.",
  GPS_TIMEOUT: "No fix within the time allowed. Indoors or underground GPS may not work at all.",
  POOR_ACCURACY: "A fix arrived but its accuracy was worse than the limit for this request. It is shown for information only.",
  DEVICE_UNAVAILABLE: "The phone could not run the request (service not running or no location provider).",
  REQUEST_EXPIRED: "The phone saw the request only after its deadline and did not start the GPS.",
  SERVICE_RESTRICTED: "Android restricted the app in the background (battery manager). Exempt the app from battery optimisation.",
  INTERNAL_ERROR: "The app hit an unexpected error. Check the phone's Diagnostics screen.",
};
