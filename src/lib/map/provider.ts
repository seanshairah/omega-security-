/**
 * One place that decides which renderer the portal maps use, and with which style.
 *
 * Mapbox GL JS (vector tiles, WebGL) is used when NEXT_PUBLIC_MAPBOX_TOKEN is set. Without a
 * token — or when the browser cannot start WebGL — the existing Leaflet raster maps keep working
 * unchanged, so a missing or exhausted Mapbox account never leaves operations without a map.
 *
 * The renderer is a picture. Guard positions, geofence state, distances and accuracy are computed
 * by this application's own backend (lib/geofence.ts, lib/geo-position.ts) and are never read back
 * from a map provider.
 */
export type MapProvider = "mapbox" | "leaflet";

/** Public (pk.*) token only: it is exposed to the browser, so it must be URL-restricted in the Mapbox account. */
export const mapboxToken = () => process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim() || "";

export const mapProvider = (): MapProvider => (mapboxToken() ? "mapbox" : "leaflet");

export type MapStyleKey = "streets" | "satellite";

/** NEXT_PUBLIC_MAPBOX_STYLE overrides the street style with a custom (company-themed) style. */
export const mapStyleUrl = (key: MapStyleKey): string =>
  key === "satellite"
    ? "mapbox://styles/mapbox/satellite-streets-v12"
    : process.env.NEXT_PUBLIC_MAPBOX_STYLE?.trim() || "mapbox://styles/mapbox/streets-v12";

export const MAP_STYLE_LABEL: Record<MapStyleKey, string> = { streets: "Street", satellite: "Satellite" };

/** Shown in the map footer so an operator always knows whose pictures they are reading. */
export const mapProviderName = (p: MapProvider = mapProvider()) =>
  p === "mapbox" ? "Mapbox" : process.env.NEXT_PUBLIC_MAPTILER_KEY ? "MapTiler" : "OpenStreetMap";
