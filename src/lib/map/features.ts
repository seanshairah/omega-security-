/**
 * Pure map data: domain rows in, GeoJSON and colours out. No browser, no renderer, no network, so
 * the Mapbox and Leaflet views draw the same thing from the same rules and the rules are testable.
 *
 * Coordinate order: this file emits GeoJSON, which is [longitude, latitude]. Leaflet's own API
 * takes [lat, lng]; that conversion stays in the Leaflet component.
 */
import type { IconName } from "@/components/ui/icons.generated";

export type GeofenceState = "INSIDE" | "OUTSIDE" | "UNKNOWN";
export type Freshness = "LIVE" | "RECENT" | "STALE";

/** A duty site and its geofence. */
export type MapSite = { id: string; name: string; lat: number; lng: number; radiusM: number; detail?: string; href?: string };

/**
 * One dated position. Every point on every portal map is one of these: a measurement with a time
 * and an uncertainty, never a live cursor.
 */
export type MapPointKind = "guard" | "latest" | "request" | "exit" | "return" | "check" | "call" | "unavailable" | "candidate" | "pin";
export type MapPoint = {
  id: string;
  lat: number;
  lng: number;
  /** First line of the popup and the hover tooltip. */
  label: string;
  kind: MapPointKind;
  state?: GeofenceState;
  freshness?: Freshness;
  accuracyM?: number | null;
  at?: string;
  detail?: string;
  href?: string;
  hrefLabel?: string;
  /** An open alert draws a red ring around the marker. */
  alert?: string | null;
  /** The point the view is about: drawn larger and labelled. */
  emphasis?: boolean;
};

/** A historical path, oldest point first. */
export type MapTrail = { id: string; points: { lat: number; lng: number }[] };

export const MAP_COLOUR = {
  site: "#2E7D32",
  inside: "#2E7D32",
  outside: "#C62828",
  unknown: "#8C948A",
  recent: "#C98A08",
  stale: "#8C948A",
  request: "#7B3FA0",
  call: "#3a50ad",
  candidate: "#7B3FA0",
  pin: "#1B5E20",
  trail: "#5E665C",
  alert: "#C62828",
} as const;

/**
 * Marker colour. Freshness beats geofence state: a two-hour-old fix inside the fence is not
 * evidence that the guard is there now, so it is never drawn in the "inside" colour.
 */
export function pointColour(p: MapPoint): string {
  if (p.kind === "request" || p.kind === "candidate") return MAP_COLOUR.request;
  if (p.kind === "call") return MAP_COLOUR.call;
  if (p.kind === "pin") return MAP_COLOUR.pin;
  if (p.kind === "exit") return MAP_COLOUR.outside;
  if (p.kind === "return") return MAP_COLOUR.inside;
  if (p.kind === "unavailable") return MAP_COLOUR.unknown;
  if (p.freshness === "STALE") return MAP_COLOUR.stale;
  if (p.freshness === "RECENT") return MAP_COLOUR.recent;
  if (p.state === "INSIDE") return MAP_COLOUR.inside;
  if (p.state === "OUTSIDE") return MAP_COLOUR.outside;
  if (p.state === "UNKNOWN") return MAP_COLOUR.unknown;
  return MAP_COLOUR.inside;
}

/** A stale fix is drawn hollow everywhere, so it cannot be mistaken for a current position. */
export const pointHollow = (p: MapPoint) => p.freshness === "STALE";

/** Glyph in the marker, from the same icon set as the rest of the interface. */
export function pointIcon(p: MapPoint): IconName {
  switch (p.kind) {
    case "guard": return "shield_person";
    case "request": case "candidate": return "my_location";
    case "call": return "call";
    case "exit": return "directions_run";
    case "return": return "where_to_vote";
    case "unavailable": return "location_off";
    case "pin": return "pin_drop";
    case "check": return "check";
    default: return "location_on";
  }
}

export const pointRadius = (p: MapPoint) => (p.emphasis ? 11 : p.kind === "check" || p.kind === "call" ? 6 : 8);

/** Legend rows for a map, built from the points actually drawn so nothing unused is explained. */
export function mapLegend(points: MapPoint[], hasSite: boolean): { label: string; colour: string; hollow?: boolean; ring?: boolean }[] {
  const rows: { label: string; colour: string; hollow?: boolean; ring?: boolean }[] = [];
  const kinds = new Set(points.map((p) => p.kind));
  const states = new Set(points.map((p) => p.state).filter(Boolean));
  const fresh = new Set(points.map((p) => p.freshness).filter(Boolean));
  if (hasSite) rows.push({ label: "Site and fence", colour: MAP_COLOUR.site });
  if (states.has("INSIDE") || fresh.has("LIVE")) rows.push({ label: "On site", colour: MAP_COLOUR.inside });
  if (states.has("OUTSIDE") || kinds.has("exit")) rows.push({ label: "Off site", colour: MAP_COLOUR.outside });
  if (fresh.has("RECENT")) rows.push({ label: "Recent fix", colour: MAP_COLOUR.recent });
  if (fresh.has("STALE") || states.has("UNKNOWN")) rows.push({ label: "Stale or unknown", colour: MAP_COLOUR.stale, hollow: true });
  if (kinds.has("request") || kinds.has("candidate")) rows.push({ label: "Requested fix", colour: MAP_COLOUR.request });
  if (kinds.has("call")) rows.push({ label: "Call", colour: MAP_COLOUR.call });
  if (points.some((p) => p.alert)) rows.push({ label: "Open alert", colour: MAP_COLOUR.alert, ring: true });
  return rows;
}

// ---------------------------------------------------------------- geometry

const EARTH_M = 6_378_137;
const DEG = Math.PI / 180;

/**
 * Ring of [lng, lat] approximating a circle of `radiusM` on the ground. Longitude degrees shrink
 * with latitude, so the ring is computed per vertex rather than as a square in degrees.
 */
export function circleRing(lat: number, lng: number, radiusM: number, steps = 64): [number, number][] {
  const ring: [number, number][] = [];
  const dLat = (radiusM / EARTH_M) / DEG;
  const dLng = dLat / Math.max(Math.cos(lat * DEG), 1e-6);
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    ring.push([lng + dLng * Math.cos(t), lat + dLat * Math.sin(t)]);
  }
  return ring;
}

export type FC<G, P> = { type: "FeatureCollection"; features: { type: "Feature"; id?: number; geometry: G; properties: P }[] };
type Poly = { type: "Polygon"; coordinates: [number, number][][] };
type Pt = { type: "Point"; coordinates: [number, number] };
type Line = { type: "LineString"; coordinates: [number, number][] };

export const hasCoords = (p: { lat: number; lng: number }) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

export function fenceFC(sites: MapSite[]): FC<Poly, { id: string; name: string; radiusM: number }> {
  return { type: "FeatureCollection", features: sites.filter(hasCoords).map((s) => ({ type: "Feature" as const, geometry: { type: "Polygon" as const, coordinates: [circleRing(s.lat, s.lng, Math.max(s.radiusM, 1))] }, properties: { id: s.id, name: s.name, radiusM: s.radiusM } })) };
}

export function siteFC(sites: MapSite[]): FC<Pt, { id: string; name: string; label: string; detail: string; href: string }> {
  return { type: "FeatureCollection", features: sites.filter(hasCoords).map((s) => ({ type: "Feature" as const, geometry: { type: "Point" as const, coordinates: [s.lng, s.lat] }, properties: { id: s.id, name: s.name, label: s.name, detail: s.detail ?? `${s.radiusM} m fence`, href: s.href ?? "" } })) };
}

/** Accuracy rings, for the points that reported an uncertainty. Separate from the markers so they can be hidden without touching them. */
export function accuracyFC(points: MapPoint[]): FC<Poly, { id: string; colour: string; accuracyM: number }> {
  return { type: "FeatureCollection", features: points.filter((p) => hasCoords(p) && p.accuracyM != null && p.accuracyM > 0).map((p) => ({ type: "Feature" as const, geometry: { type: "Polygon" as const, coordinates: [circleRing(p.lat, p.lng, p.accuracyM!)] }, properties: { id: p.id, colour: pointColour(p), accuracyM: Math.round(p.accuracyM!) } })) };
}

export type PointProps = { id: string; label: string; detail: string; at: string; colour: string; icon: IconName; radius: number; hollow: boolean; alert: string; href: string; hrefLabel: string; emphasis: boolean; kind: MapPointKind };

export function pointFC(points: MapPoint[]): FC<Pt, PointProps> {
  return {
    type: "FeatureCollection",
    features: points.filter(hasCoords).map((p, i) => ({
      type: "Feature" as const,
      id: i,
      geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
      properties: {
        id: p.id, label: p.label, detail: p.detail ?? "", at: p.at ?? "", colour: pointColour(p), icon: pointIcon(p), radius: pointRadius(p),
        hollow: pointHollow(p), alert: p.alert ?? "", href: p.href ?? "", hrefLabel: p.hrefLabel ?? "Open", emphasis: !!p.emphasis, kind: p.kind,
      },
    })),
  };
}

export function trailFC(trails: MapTrail[]): FC<Line, { id: string }> {
  return { type: "FeatureCollection", features: trails.map((t) => ({ type: "Feature" as const, geometry: { type: "LineString" as const, coordinates: t.points.filter(hasCoords).map((p) => [p.lng, p.lat] as [number, number]) }, properties: { id: t.id } })).filter((f) => f.geometry.coordinates.length > 1) };
}

export type Bounds = { west: number; south: number; east: number; north: number };

/**
 * Smallest box holding everything drawn, including each fence and accuracy ring, so fitting the
 * view never clips the uncertainty an operator is being asked to judge.
 */
export function boundsOf(sites: MapSite[], points: MapPoint[], trails: MapTrail[] = []): Bounds | null {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  const take = (lng: number, lat: number) => { west = Math.min(west, lng); east = Math.max(east, lng); south = Math.min(south, lat); north = Math.max(north, lat); };
  for (const s of sites.filter(hasCoords)) for (const [lng, lat] of circleRing(s.lat, s.lng, Math.max(s.radiusM, 1), 8)) take(lng, lat);
  for (const p of points.filter(hasCoords)) {
    if (p.accuracyM != null && p.accuracyM > 0) for (const [lng, lat] of circleRing(p.lat, p.lng, p.accuracyM, 8)) take(lng, lat);
    else take(p.lng, p.lat);
  }
  for (const t of trails) for (const p of t.points.filter(hasCoords)) take(p.lng, p.lat);
  return Number.isFinite(west) ? { west, south, east, north } : null;
}

/** Harare: only ever a starting view for an empty map, never a position. */
export const DEFAULT_CENTRE = { lat: -17.8292, lng: 31.0522 };
