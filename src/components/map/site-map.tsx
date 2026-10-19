"use client";

import { MapView } from "./map-view";
import type { MapPoint } from "@/lib/map/features";

/** Kept for the existing callers (device, site, shift pages); the kinds map onto the shared model. */
export type SiteMapPoint = { lat: number; lng: number; label: string; kind: "latest" | "exit" | "return" | "check" | "unavailable" | "call" | "request"; at?: string; freshness?: string; accuracyM?: number };

/**
 * A single site with its fence and the fixes recorded around it. Renders through MapView, so it is
 * a Mapbox vector map when a token is configured and the raster map otherwise.
 */
export function SiteMap({ site, points, className, height = 320, trail = false }: { site: { lat: number; lng: number; radiusM: number; name: string } | null; points: SiteMapPoint[]; className?: string; height?: number; trail?: boolean }) {
  const mapped: MapPoint[] = points.map((p, i) => ({
    id: `p${i}`, lat: p.lat, lng: p.lng, label: p.label, kind: p.kind, accuracyM: p.accuracyM ?? null,
    at: p.at, detail: p.freshness, emphasis: p.kind === "latest",
    freshness: p.freshness === "STALE" ? "STALE" : p.freshness === "RECENT" ? "RECENT" : undefined,
  }));
  return (
    <MapView
      className={className}
      height={height}
      scrollZoom={false}
      sites={site ? [{ id: "site", name: site.name, lat: site.lat, lng: site.lng, radiusM: site.radiusM }] : []}
      points={mapped}
      trails={trail && mapped.length > 1 ? [{ id: "history", points: [...mapped].reverse().map((p) => ({ lat: p.lat, lng: p.lng })) }] : []}
    />
  );
}
