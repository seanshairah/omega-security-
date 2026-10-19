"use client";

import { MapView } from "./map-view";
import type { MapPoint, MapSite } from "@/lib/map/features";

export type LiveSite = { id: string; name: string; lat: number; lng: number; radiusM: number; href: string; guards: number };
export type LiveGuard = { id: string; name: string; lat: number; lng: number; state: "INSIDE" | "OUTSIDE" | "UNKNOWN"; at: string; freshness: string; accuracyM?: number | null; href: string; alert?: string | null };

/**
 * The fleet view: every active site with its fence and every guard phone's last fix. Markers
 * cluster when guards share a site. A fix is a dated point with its accuracy, never a live
 * stream, so stale fixes are drawn hollow and say so.
 */
export function LiveMap({ sites, guards, height = 520 }: { sites: LiveSite[]; guards: LiveGuard[]; height?: number }) {
  const mapSites: MapSite[] = sites.map((s) => ({ id: s.id, name: s.name, lat: s.lat, lng: s.lng, radiusM: s.radiusM, href: s.href, detail: `${s.radiusM} m fence · ${s.guards} on shift` }));
  const points: MapPoint[] = guards.map((g) => ({
    id: g.id, lat: g.lat, lng: g.lng, label: g.name, kind: "guard", state: g.state,
    freshness: g.freshness === "STALE" ? "STALE" : g.freshness === "RECENT" ? "RECENT" : "LIVE",
    accuracyM: g.accuracyM ?? null, at: `${g.at} · ${g.freshness.toLowerCase()}`,
    detail: g.state === "INSIDE" ? "On site" : g.state === "OUTSIDE" ? "Off site" : "Position unknown",
    href: g.href, hrefLabel: "Open shift", alert: g.alert ?? null,
  }));
  return <MapView sites={mapSites} points={points} height={height} cluster allowSatellite autoFit={false} />;
}
