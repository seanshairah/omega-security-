/**
 * The four location concepts the guard workspace shows, kept apart on purpose:
 *
 *   connection   — can the phone talk to us? (heartbeat age)
 *   monitoring   — is the shift monitor running and what did it last conclude?
 *   position     — the last verified fix, with its source (monitoring or a requested fix), accuracy and age
 *   geofence     — what that position means against the assigned site, or why it cannot be assessed
 *
 * A valid requested fix is never called "unavailable" because monitoring is idle, and a guard is
 * never "inside" merely because a fix exists: the assessment reuses the accuracy-aware classifier.
 * Pure; unit-tested in tests/guard-status.test.ts.
 */
import { classifyFix } from "@/lib/geofence";

export type ConnectionState = "ONLINE" | "OFFLINE" | "DISABLED" | "REVOKED" | "NONE";
export type GpsMonitorState = "INSIDE" | "VERIFYING_OUTSIDE" | "OUTSIDE" | "UNAVAILABLE" | "CHECKING" | "OFF" | "UNKNOWN";
export type PositionSource = "MONITORING" | "REQUESTED";
export type Freshness = "LIVE" | "RECENT" | "STALE";
export type GeofenceAssessment = "INSIDE" | "OUTSIDE" | "UNCERTAIN" | "NOT_ASSESSED" | "STALE";
export type Tone = "ok" | "warn" | "critical" | "neutral" | "muted" | "info";

export type DeviceFacts = {
  status: "ONLINE" | "OFFLINE" | "DISABLED" | "REVOKED";
  activationStatus: "PENDING" | "ACTIVE" | "REVOKED";
  lastSeenAt: Date | null;
  shiftState: string | null;
  gpsState: string | null;
  gpsReason: string | null;
  monitoringState: string | null;
  lastLatitude: number | null;
  lastLongitude: number | null;
  lastAccuracyM: number | null;
  lastLocationAt: Date | null;
  locationPermission: string | null;
  mockLocationSeen: boolean;
};
export type RequestFacts = { status: string; latitude: number | null; longitude: number | null; accuracyM: number | null; capturedAt: Date | null; mock: boolean } | null;
export type SiteFacts = { name: string; latitude: number | null; longitude: number | null; radiusM: number } | null;

export type Presentation = {
  connection: { state: ConnectionState; label: string; tone: Tone; lastSeenAt: Date | null };
  monitoring: { onShift: boolean; active: boolean; gps: GpsMonitorState; label: string; detail: string; tone: Tone };
  position: { latitude: number; longitude: number; accuracyM: number | null; at: Date; ageSeconds: number; freshness: Freshness; source: PositionSource; mock: boolean } | null;
  geofence: { assessment: GeofenceAssessment; label: string; tone: Tone; distanceM: number | null; detail: string };
};

export function freshnessOf(at: Date, now: Date): Freshness {
  const min = (now.getTime() - at.getTime()) / 60_000;
  return min <= 15 ? "LIVE" : min <= 60 ? "RECENT" : "STALE";
}

const REASON: Record<string, string> = {
  poor_accuracy: "GPS accuracy worse than the limit; the reading is not counted.",
  no_fix: "No GPS fix was obtained.",
  location_disabled: "Location services are switched off on the phone.",
  permission_revoked: "Location permission was removed.",
  site_has_no_coordinates: "The duty site has no coordinates.",
  on_boundary: "The reading is too close to the fence to decide.",
};

export function presentGuardLocation(input: { device: DeviceFacts | null; lastRequest: RequestFacts; site: SiteFacts; offlineMinutes: number; accuracyMaxM: number; now?: Date }): Presentation {
  const now = input.now ?? new Date();
  const d = input.device;

  // 1. Connection
  let connection: Presentation["connection"];
  if (!d) connection = { state: "NONE", label: "No guard phone", tone: "muted", lastSeenAt: null };
  else if (d.status === "REVOKED" || d.activationStatus === "REVOKED") connection = { state: "REVOKED", label: "Revoked", tone: "critical", lastSeenAt: d.lastSeenAt };
  else if (d.status === "DISABLED") connection = { state: "DISABLED", label: "Disabled", tone: "critical", lastSeenAt: d.lastSeenAt };
  else if (d.activationStatus !== "ACTIVE" || !d.lastSeenAt) connection = { state: "OFFLINE", label: "Never connected", tone: "warn", lastSeenAt: d.lastSeenAt };
  else if (now.getTime() - d.lastSeenAt.getTime() <= input.offlineMinutes * 60_000) connection = { state: "ONLINE", label: "Online", tone: "ok", lastSeenAt: d.lastSeenAt };
  else connection = { state: "OFFLINE", label: "Offline", tone: "warn", lastSeenAt: d.lastSeenAt };

  // 2. Monitoring (what the shift monitor is doing), independent of any one fix
  const onShift = d?.shiftState === "ACTIVE";
  const gpsRaw = (d?.gpsState ?? "").toUpperCase();
  const gps: GpsMonitorState = !d || !onShift ? "OFF"
    : gpsRaw === "MONITORING" || gpsRaw === "INSIDE" ? "INSIDE"
    : gpsRaw === "VERIFYING_OUTSIDE" ? "VERIFYING_OUTSIDE"
    : gpsRaw === "OUTSIDE" ? "OUTSIDE"
    : gpsRaw === "LOCATION_UNAVAILABLE" ? "UNAVAILABLE"
    : gpsRaw === "CHECKING" ? "CHECKING"
    : "UNKNOWN";
  const active = onShift && connection.state === "ONLINE" && gps !== "OFF";
  const monitoring: Presentation["monitoring"] = {
    onShift, active, gps,
    label: gps === "OFF" ? (d?.shiftState === "UPCOMING" ? "Waiting for shift" : "Not on shift") : gps === "INSIDE" ? "Monitoring · inside" : gps === "VERIFYING_OUTSIDE" ? "Monitoring · confirming an outside reading" : gps === "OUTSIDE" ? "Monitoring · outside" : gps === "UNAVAILABLE" ? "Monitoring · no usable fix" : gps === "CHECKING" ? "Monitoring · checking" : "Monitoring · no verdict yet",
    detail: gps === "OFF" ? "Automatic checks run only during shifts." : gps === "UNAVAILABLE" ? (REASON[d?.gpsReason ?? ""] ?? "The last automatic check produced no usable position.") : connection.state !== "ONLINE" ? "The phone is not reporting; the last state may be old." : "Automatic checks every few minutes, offline too.",
    tone: gps === "INSIDE" ? "ok" : gps === "OUTSIDE" ? "critical" : gps === "OFF" ? "muted" : gps === "VERIFYING_OUTSIDE" || gps === "UNAVAILABLE" || gps === "UNKNOWN" ? "warn" : "info",
  };

  // 3. Last verified position: a completed request newer than (or equal to) the monitor's fix is the requested one
  let position: Presentation["position"] = null;
  const r = input.lastRequest;
  const reqOk = r && r.status === "COMPLETED" && r.latitude != null && r.longitude != null && r.capturedAt;
  const devOk = d && d.lastLatitude != null && d.lastLongitude != null && d.lastLocationAt;
  if (reqOk && (!devOk || r!.capturedAt!.getTime() >= d!.lastLocationAt!.getTime() - 1000)) {
    position = { latitude: r!.latitude!, longitude: r!.longitude!, accuracyM: r!.accuracyM, at: r!.capturedAt!, ageSeconds: Math.max(0, Math.round((now.getTime() - r!.capturedAt!.getTime()) / 1000)), freshness: freshnessOf(r!.capturedAt!, now), source: "REQUESTED", mock: r!.mock };
  } else if (devOk) {
    position = { latitude: d!.lastLatitude!, longitude: d!.lastLongitude!, accuracyM: d!.lastAccuracyM, at: d!.lastLocationAt!, ageSeconds: Math.max(0, Math.round((now.getTime() - d!.lastLocationAt!.getTime()) / 1000)), freshness: freshnessOf(d!.lastLocationAt!, now), source: "MONITORING", mock: d!.mockLocationSeen && false };
  }

  // 4. Geofence assessment of that position against the site, with the same accuracy-aware classifier as the server intake
  let geofence: Presentation["geofence"];
  const site = input.site;
  if (!position) geofence = { assessment: "NOT_ASSESSED", label: "Not assessed", tone: "muted", distanceM: null, detail: "No verified position yet." };
  else if (!site || site.latitude == null || site.longitude == null) geofence = { assessment: "NOT_ASSESSED", label: "Not assessed", tone: "muted", distanceM: null, detail: site ? `${site.name} has no coordinates.` : "No assigned site." };
  else {
    const c = classifyFix({ latitude: position.latitude, longitude: position.longitude, accuracyM: position.accuracyM ?? undefined }, { latitude: site.latitude, longitude: site.longitude, radiusM: site.radiusM }, input.accuracyMaxM);
    const distanceM = Math.round(c.distanceM);
    if (position.mock) geofence = { assessment: "UNCERTAIN", label: "Mock location", tone: "critical", distanceM, detail: "The phone reported a mock provider; the position is not trusted." };
    else if (position.freshness === "STALE") geofence = { assessment: "STALE", label: `Stale · was ${c.state === "INSIDE" ? "inside" : c.state === "OUTSIDE" ? "outside" : "uncertain"}`, tone: "muted", distanceM, detail: `${distanceM} m from ${site.name} when measured; too old to stand for now.` };
    else if (c.state === "INSIDE") geofence = { assessment: "INSIDE", label: "Inside the site", tone: "ok", distanceM, detail: `${distanceM} m from the centre of ${site.name} (fence ${site.radiusM} m).` };
    else if (c.state === "OUTSIDE") geofence = { assessment: "OUTSIDE", label: "Outside the site", tone: "critical", distanceM, detail: `${distanceM} m from the centre of ${site.name} (fence ${site.radiusM} m).` };
    else geofence = { assessment: "UNCERTAIN", label: "Uncertain", tone: "warn", distanceM, detail: c.reason === "poor_accuracy" ? `Accuracy ±${Math.round(position.accuracyM ?? 0)} m is worse than the ${input.accuracyMaxM} m limit.` : `The fence lies inside the ±${Math.round(position.accuracyM ?? 0)} m accuracy circle.` };
  }
  return { connection, monitoring, position, geofence };
}
