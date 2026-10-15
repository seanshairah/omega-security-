/**
 * Geofence arithmetic shared by the server, the simulator and the tests. The Android app
 * carries the same rules in Kotlin (android/.../geofence/GeofenceEngine.kt); keep them in step.
 *
 * GPS is not exact. A fix comes with an accuracy radius (metres, 68% confidence). A guard is
 * treated as OUTSIDE only when the fix is outside the fence by more than its accuracy, INSIDE
 * when inside by more than its accuracy, and UNKNOWN in the band between or when accuracy is
 * worse than the configured maximum.
 */
export type LocationState = "INSIDE" | "OUTSIDE" | "UNKNOWN";

const EARTH_RADIUS_M = 6_371_000;

export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

export type Classification = { state: LocationState; distanceM: number; reason?: string };

/** Classify one fix against a site. `accuracyMaxM` is the worst accuracy we will still decide on. */
export function classifyFix(fix: { latitude: number; longitude: number; accuracyM?: number | null }, site: { latitude: number; longitude: number; radiusM: number }, accuracyMaxM = 100): Classification {
  const distanceM = haversineM(fix.latitude, fix.longitude, site.latitude, site.longitude);
  const acc = fix.accuracyM ?? 0;
  if (acc > accuracyMaxM) return { state: "UNKNOWN", distanceM, reason: "poor_accuracy" };
  if (distanceM + acc <= site.radiusM) return { state: "INSIDE", distanceM };
  if (distanceM - acc > site.radiusM) return { state: "OUTSIDE", distanceM };
  // Fence falls inside the accuracy circle: cannot tell. Lean on the centre for display only.
  return { state: "UNKNOWN", distanceM, reason: "on_boundary" };
}

/** LIVE when the phone's timestamp is within the delay window of arrival; SYNCED_LATE beyond the late threshold. */
export function syncStatusFor(occurredAt: Date, receivedAt: Date, liveSeconds = 120, lateSeconds = 600): "LIVE" | "SYNCED" | "SYNCED_LATE" {
  const delay = (receivedAt.getTime() - occurredAt.getTime()) / 1000;
  if (delay <= liveSeconds) return "LIVE";
  if (delay <= lateSeconds) return "SYNCED";
  return "SYNCED_LATE";
}

/** Radius choices offered in the site form. */
export const RADIUS_CHOICES = [50, 100, 150, 250, 500];

export const LOCATION_STATE_META: Record<LocationState, { label: string; tone: "ok" | "critical" | "muted" }> = {
  INSIDE: { label: "Inside site", tone: "ok" },
  OUTSIDE: { label: "Outside assigned site", tone: "critical" },
  UNKNOWN: { label: "Location unavailable", tone: "muted" },
};

/** How fresh a fix is, for labels on maps and panels. Never show a stale coordinate as current. */
export function freshness(at: Date | null | undefined, now = new Date(), syncStatus?: "LIVE" | "SYNCED" | "SYNCED_LATE"): { label: "LIVE" | "RECENT" | "STALE" | "SYNCED LATE" | "NONE"; tone: "ok" | "warn" | "muted" | "info" } {
  if (!at) return { label: "NONE", tone: "muted" };
  if (syncStatus === "SYNCED_LATE") return { label: "SYNCED LATE", tone: "info" };
  const ageMin = (now.getTime() - at.getTime()) / 60000;
  if (ageMin <= 15) return { label: "LIVE", tone: "ok" };
  if (ageMin <= 60) return { label: "RECENT", tone: "warn" };
  return { label: "STALE", tone: "muted" };
}

/**
 * Pure shift-monitoring state machine, mirrored in Kotlin. Input: the previous state plus one
 * observation (a classified fix, or an unavailability reason). Output: the next state and the
 * events to record. Used by the simulator and the tests; the phone runs the Kotlin twin offline.
 */
export type MonitorState = { phase: "MONITORING" | "VERIFYING_OUTSIDE" | "OUTSIDE" | "LOCATION_UNAVAILABLE"; since: number; outsideSince: number | null; lastOutsideUpdate: number | null; lastInsideCheck: number | null };
export type MonitorPolicy = { checkMinutes: number; verifySeconds: number; outsideCheckMinutes: number; escalationMinutes: number };
export type Observation = { at: number; state: LocationState; distanceM?: number; reason?: string };
export type Emitted = { type: "LOCATION_CHECK" | "LOCATION_EXIT" | "LOCATION_OUTSIDE" | "LOCATION_RETURNED" | "LOCATION_UNAVAILABLE"; at: number; state: LocationState; distanceM?: number; reason?: string; durationOutsideSeconds?: number };

export const DEFAULT_POLICY: MonitorPolicy = { checkMinutes: 10, verifySeconds: 60, outsideCheckMinutes: 3, escalationMinutes: 10 };

export function initialMonitor(at: number): MonitorState {
  return { phase: "MONITORING", since: at, outsideSince: null, lastOutsideUpdate: null, lastInsideCheck: null };
}

export function stepMonitor(s: MonitorState, o: Observation, p: MonitorPolicy = DEFAULT_POLICY): { next: MonitorState; events: Emitted[]; nextCheckSeconds: number } {
  const ev: Emitted[] = [];
  const normal = p.checkMinutes * 60;
  const outsideEvery = p.outsideCheckMinutes * 60;
  switch (o.state) {
    case "UNKNOWN": {
      if (s.phase === "OUTSIDE") {
        // Keep the exit open; just note we cannot see the guard right now.
        ev.push({ type: "LOCATION_UNAVAILABLE", at: o.at, state: "UNKNOWN", reason: o.reason ?? "no_fix" });
        return { next: s, events: ev, nextCheckSeconds: outsideEvery };
      }
      if (s.phase !== "LOCATION_UNAVAILABLE") ev.push({ type: "LOCATION_UNAVAILABLE", at: o.at, state: "UNKNOWN", reason: o.reason ?? "no_fix" });
      return { next: { ...s, phase: "LOCATION_UNAVAILABLE", since: s.phase === "LOCATION_UNAVAILABLE" ? s.since : o.at }, events: ev, nextCheckSeconds: Math.min(normal, 5 * 60) };
    }
    case "INSIDE": {
      if (s.phase === "OUTSIDE") {
        ev.push({ type: "LOCATION_RETURNED", at: o.at, state: "INSIDE", distanceM: o.distanceM, durationOutsideSeconds: Math.round((o.at - (s.outsideSince ?? o.at)) / 1000) });
        return { next: { phase: "MONITORING", since: o.at, outsideSince: null, lastOutsideUpdate: null, lastInsideCheck: o.at }, events: ev, nextCheckSeconds: normal };
      }
      // A single OUTSIDE reading that did not confirm is dropped silently; normal checks are recorded.
      ev.push({ type: "LOCATION_CHECK", at: o.at, state: "INSIDE", distanceM: o.distanceM });
      return { next: { phase: "MONITORING", since: s.phase === "MONITORING" ? s.since : o.at, outsideSince: null, lastOutsideUpdate: null, lastInsideCheck: o.at }, events: ev, nextCheckSeconds: normal };
    }
    case "OUTSIDE": {
      if (s.phase === "OUTSIDE") {
        const due = s.lastOutsideUpdate == null || o.at - s.lastOutsideUpdate >= outsideEvery * 1000 - 1000;
        if (due) ev.push({ type: "LOCATION_OUTSIDE", at: o.at, state: "OUTSIDE", distanceM: o.distanceM });
        return { next: { ...s, lastOutsideUpdate: due ? o.at : s.lastOutsideUpdate }, events: ev, nextCheckSeconds: outsideEvery };
      }
      if (s.phase === "VERIFYING_OUTSIDE") {
        if (o.at - s.since >= p.verifySeconds * 1000 - 1000) {
          ev.push({ type: "LOCATION_EXIT", at: o.at, state: "OUTSIDE", distanceM: o.distanceM });
          return { next: { phase: "OUTSIDE", since: o.at, outsideSince: s.since, lastOutsideUpdate: o.at, lastInsideCheck: s.lastInsideCheck }, events: ev, nextCheckSeconds: outsideEvery };
        }
        return { next: s, events: ev, nextCheckSeconds: p.verifySeconds };
      }
      // First outside reading: verify before anything is recorded.
      return { next: { phase: "VERIFYING_OUTSIDE", since: o.at, outsideSince: null, lastOutsideUpdate: null, lastInsideCheck: s.lastInsideCheck }, events: ev, nextCheckSeconds: p.verifySeconds };
    }
  }
}
