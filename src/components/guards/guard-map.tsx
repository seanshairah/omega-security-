"use client";

import { MapView } from "@/components/map/map-view";
import type { MapPoint } from "@/lib/map/features";

export type GuardMapProps = {
  site: { name: string; lat: number; lng: number; radiusM: number } | null;
  position: { lat: number; lng: number; accuracyM: number | null; source: "MONITORING" | "REQUESTED"; freshness: "LIVE" | "RECENT" | "STALE"; label: string } | null;
  /** A completed request older than the monitor's fix: drawn separately so both are visible. */
  requested?: { lat: number; lng: number; accuracyM: number | null; label: string } | null;
  /** Earlier fixes, newest first, drawn as a path behind the current position. */
  trail?: { lat: number; lng: number; at?: string }[];
  className?: string;
  /** Increment to re-fit the view. */
  fitKey?: number;
};

/**
 * The guard workspace map. It stays mounted for the life of the page: the 15-second status poll
 * and the 30-second feed refresh push new coordinates into it without re-creating the map, so the
 * operator's pan and zoom survive every refresh.
 */
export function GuardMap({ site, position, requested, trail = [], className, fitKey = 0 }: GuardMapProps) {
  const points: MapPoint[] = [];
  if (requested) points.push({ id: "requested", lat: requested.lat, lng: requested.lng, accuracyM: requested.accuracyM, label: requested.label, kind: "request" });
  if (position) points.push({ id: "position", lat: position.lat, lng: position.lng, accuracyM: position.accuracyM, label: position.label, kind: position.source === "REQUESTED" ? "request" : "latest", freshness: position.freshness, emphasis: true });
  return (
    <MapView
      className={className}
      sites={site ? [{ id: "site", name: site.name, lat: site.lat, lng: site.lng, radiusM: site.radiusM }] : []}
      points={points}
      trails={trail.length > 1 ? [{ id: "trail", points: [...trail].reverse() }] : []}
      fitKey={fitKey}
      allowSatellite
      testId="guard-map"
    />
  );
}
