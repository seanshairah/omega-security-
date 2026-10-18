/**
 * Pure helpers for the site location picker: judging a browser or device fix, explaining why
 * geolocation is unavailable, and keeping [longitude, latitude] (GeoJSON / MapTiler / Google
 * LngLat) and {latitude, longitude} (browser Geolocation, Leaflet, our database) straight.
 * Unit-tested in tests/geo-position.test.ts.
 */

export type LatLng = { latitude: number; longitude: number };

/** GeoJSON / MapTiler / Mapbox order is [lng, lat]. Never pass a LatLng where this is expected. */
export function toLngLat(p: LatLng): [number, number] { return [p.longitude, p.latitude]; }
export function fromLngLat([lng, lat]: [number, number]): LatLng { return { latitude: lat, longitude: lng }; }

export function isValidLatLng(p: Partial<LatLng> | null | undefined): p is LatLng {
  return !!p && typeof p.latitude === "number" && typeof p.longitude === "number" && Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180 && !(p.latitude === 0 && p.longitude === 0);
}

/** Where a site's coordinates came from. BROWSER = the portal user's own device; GUARD_DEVICE = a registered guard phone. */
export type PositionSource = "BROWSER" | "GUARD_DEVICE" | "MAP" | "MANUAL" | "TEST";

export const SOURCE_LABEL: Record<PositionSource, string> = {
  BROWSER: "This device's browser (the computer or phone running the portal)",
  GUARD_DEVICE: "A registered guard phone (fresh GPS fix)",
  MAP: "Placed on the map",
  MANUAL: "Typed or pasted",
  TEST: "TEST coordinates (temporary, not verified)",
};

/**
 * Is a fix precise enough to be the centre of a fence of this radius? The fence must be clearly
 * larger than the uncertainty of its own centre, or guards standing at the real centre will be
 * judged against the wrong circle.
 */
export type AccuracyVerdict = { level: "good" | "usable" | "poor" | "unknown"; label: string; detail: string };

export function accuracyVerdict(accuracyM: number | null | undefined, radiusM: number): AccuracyVerdict {
  if (accuracyM == null || !Number.isFinite(accuracyM)) return { level: "unknown", label: "Accuracy unknown", detail: "The position came without an accuracy estimate. Treat it as approximate." };
  const r = Math.max(20, radiusM);
  if (accuracyM <= Math.min(25, r / 5)) return { level: "good", label: `±${Math.round(accuracyM)} m · good`, detail: `Well inside a ${r} m fence; suitable as its centre.` };
  if (accuracyM <= r / 2) return { level: "usable", label: `±${Math.round(accuracyM)} m · usable`, detail: `Up to half the ${r} m fence. Acceptable if the pin is then checked against the map; retry for a tighter fix if you can.` };
  return { level: "poor", label: `±${Math.round(accuracyM)} m · too loose`, detail: `The uncertainty is as large as or larger than the ${r} m fence itself. Do not centre the fence on this; retry outdoors, use a guard phone's GPS, or place the pin by hand.` };
}

/** A browser fix is "fresh" when it was measured now, not served from a cache or an old watch. */
export function fixFreshness(timestampMs: number, nowMs = Date.now()): { fresh: boolean; ageSeconds: number; label: string } {
  const age = Math.max(0, Math.round((nowMs - timestampMs) / 1000));
  if (age <= 15) return { fresh: true, ageSeconds: age, label: "fresh (just measured)" };
  if (age <= 120) return { fresh: true, ageSeconds: age, label: `${age} s old` };
  return { fresh: false, ageSeconds: age, label: `${Math.round(age / 60)} min old · may be cached or stale` };
}

/** True when a guard phone's reported fix is recent enough to stand for "where the phone is now". */
export function deviceFixIsFresh(at: Date | string | null | undefined, maxAgeSeconds = 180, now = Date.now()): boolean {
  if (!at) return false;
  const t = typeof at === "string" ? new Date(at).getTime() : at.getTime();
  return Number.isFinite(t) && now - t <= maxAgeSeconds * 1000;
}

/**
 * Why the browser cannot or will not give a position, in words that say what to do. Browser
 * geolocation needs a secure context: https://, or http://localhost / 127.0.0.1 on the same machine.
 * A LAN address such as http://172.20.10.3:3000 is not secure, so a phone opening the portal that way
 * gets nothing.
 */
export function geolocationAvailability(env: { secureContext: boolean; hasGeolocation: boolean; origin: string }): { ok: boolean; reason?: "insecure_context" | "unsupported"; message?: string } {
  if (!env.hasGeolocation) return { ok: false, reason: "unsupported", message: "This browser has no geolocation support. Place the pin by hand or type the coordinates." };
  if (!env.secureContext) {
    const isLocalHttp = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(env.origin);
    return { ok: false, reason: "insecure_context", message: isLocalHttp
      ? "Browser location is blocked in this context. Open the portal at https://… (the Vercel address) or at http://localhost:3000 on this computer; a LAN address like http://172.20.10.3:3000 is never allowed by the browser."
      : `Browser location is blocked because ${env.origin} is not a secure origin. Open the portal at https://… (the Vercel address) or, on this computer only, at http://localhost:3000. A LAN address like http://172.20.10.3:3000 will never be allowed by the browser; for a phone, use the HTTPS address or an HTTPS tunnel.` };
  }
  return { ok: true };
}

/** Map a GeolocationPositionError code to a state and a plain explanation. */
export function geolocationErrorState(code: number): { state: "permission_denied" | "unavailable" | "timed_out"; message: string } {
  if (code === 1) return { state: "permission_denied", message: "Location permission was denied. Allow it in the browser's site settings (the lock icon in the address bar) and try again, or place the pin by hand." };
  if (code === 3) return { state: "timed_out", message: "The device did not produce a position in time. Move near a window or outdoors, make sure location services are on, then retry." };
  return { state: "unavailable", message: "The device could not determine its position (no GPS, Wi-Fi or network location available). Retry, or place the pin by hand." };
}

/** Decide whether a watch should keep running: stop once the fix is good, or when the budget is spent. */
export function keepWatching(bestAccuracyM: number | null, elapsedMs: number, radiusM: number, budgetMs = 30_000): boolean {
  if (elapsedMs >= budgetMs) return false;
  if (bestAccuracyM != null && bestAccuracyM <= Math.min(20, Math.max(20, radiusM) / 5)) return false;
  return true;
}

/** Distance in metres between two points (haversine), for "moved n m from the saved position". */
export function distanceM(a: LatLng, b: LatLng): number {
  const R = 6_371_000, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude), dLon = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
