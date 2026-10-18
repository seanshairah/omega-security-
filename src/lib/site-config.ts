/**
 * Duty-site geofence configuration: provenance of coordinates, the effective fence for a shift
 * (site default or shift override) and the config version guard phones echo back. Pure helpers,
 * unit-tested in tests/site-config.test.ts.
 */
import type { CoordinatesSource } from "@prisma/client";

export type GeofenceSite = { latitude: number; longitude: number; radiusM: number };

export const COORDINATES_SOURCE_META: Record<CoordinatesSource, { label: string; tone: "ok" | "neutral" | "warn"; description: string }> = {
  MAP: { label: "Placed on map", tone: "ok", description: "Pinned with the map picker." },
  MANUAL: { label: "Typed", tone: "neutral", description: "Latitude and longitude typed or pasted by hand." },
  TEST: { label: "TEST coordinates", tone: "warn", description: "Temporary values for testing. Not verified; replace before relying on GPS verification at this site." },
};

/** Both coordinates or neither; a stray single value is a data-entry error, not a fence. */
export function coordinatePairError(lat: number | null | undefined, lng: number | null | undefined): string | null {
  const hasLat = lat != null && Number.isFinite(lat);
  const hasLng = lng != null && Number.isFinite(lng);
  if (hasLat !== hasLng) return "Enter both latitude and longitude, or leave both empty.";
  if (hasLat && (lat! < -90 || lat! > 90)) return "Latitude must be between -90 and 90.";
  if (hasLng && (lng! < -180 || lng! > 180)) return "Longitude must be between -180 and 180.";
  if (hasLat && lat === 0 && lng === 0) return "0, 0 is in the Atlantic Ocean; pick the site on the map.";
  return null;
}

export const GEOFENCE_RADIUS_MIN = 20;
export const GEOFENCE_RADIUS_MAX = 5000;

export function radiusError(r: number | null | undefined): string | null {
  if (r == null) return null;
  if (!Number.isInteger(r)) return "Radius must be a whole number of metres.";
  if (r < GEOFENCE_RADIUS_MIN || r > GEOFENCE_RADIUS_MAX) return `Radius must be between ${GEOFENCE_RADIUS_MIN} and ${GEOFENCE_RADIUS_MAX} m.`;
  return null;
}

/** Did the fence move or resize? Only then does the site's config version increase. */
export function geofenceChanged(before: { latitude: number | null; longitude: number | null; geofenceRadiusM: number }, after: { latitude: number | null; longitude: number | null; geofenceRadiusM: number }): boolean {
  return before.latitude !== after.latitude || before.longitude !== after.longitude || before.geofenceRadiusM !== after.geofenceRadiusM;
}

export type ShiftGeofenceFields = { geofenceLatitude: number | null; geofenceLongitude: number | null; geofenceRadiusM: number | null };
export type LocationGeofenceFields = { latitude: number | null; longitude: number | null; geofenceRadiusM: number };

/**
 * The fence a shift is judged against: the shift's own override when it has one, else the site.
 * Returns null when neither has coordinates.
 */
export function effectiveGeofence(shift: ShiftGeofenceFields | null | undefined, site: LocationGeofenceFields): { fence: GeofenceSite; source: "SHIFT_OVERRIDE" | "SITE" } | null {
  if (shift && shift.geofenceLatitude != null && shift.geofenceLongitude != null) return { fence: { latitude: shift.geofenceLatitude, longitude: shift.geofenceLongitude, radiusM: shift.geofenceRadiusM ?? site.geofenceRadiusM }, source: "SHIFT_OVERRIDE" };
  if (site.latitude != null && site.longitude != null) return { fence: { latitude: site.latitude, longitude: site.longitude, radiusM: site.geofenceRadiusM }, source: "SITE" };
  return null;
}

/** "<siteVersion>.<shiftVersion>" — what the phone caches and echoes in heartbeats. */
export function configVersionString(siteVersion: number, shiftVersion: number): string {
  return `${siteVersion}.${shiftVersion}`;
}

/** Is the phone running the current config? Unknown (null) counts as not applied. */
export function configApplied(current: string, applied: string | null | undefined): boolean {
  return applied != null && applied === current;
}
