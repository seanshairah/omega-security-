"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap } from "leaflet";
import { tileLayerConfig, tileProviderName } from "./tiles";

export type MapPoint = { lat: number; lng: number; label: string; kind: "latest" | "exit" | "return" | "check" | "unavailable" | "call" | "request"; at?: string; freshness?: string; /** GPS uncertainty drawn as a circle around the point. */ accuracyM?: number };

const COLOURS: Record<MapPoint["kind"], string> = { latest: "#2E7D32", exit: "#C62828", return: "#1B5E20", check: "#5E665C", unavailable: "#8C948A", call: "#3a50ad", request: "#7B3FA0" };

/**
 * OpenStreetMap tiles via Leaflet. Shows the site, its geofence and the guard's events. Loaded on
 * the client only; Leaflet does not render on the server.
 */
export function SiteMap({ site, points, className, height = 320 }: { site: { lat: number; lng: number; radiusM: number; name: string } | null; points: MapPoint[]; className?: string; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !ref.current || mapRef.current) return;
      const centre = site ?? (points[0] ? { lat: points[0].lat, lng: points[0].lng } : { lat: -17.8292, lng: 31.0522 });
      const map = L.map(ref.current, { scrollWheelZoom: false }).setView([centre.lat, centre.lng], 15);
      mapRef.current = map;
      const tiles = tileLayerConfig(); L.tileLayer(tiles.url, { maxZoom: tiles.maxZoom, attribution: tiles.attribution }).addTo(map);
      const bounds: [number, number][] = [];
      if (site) {
        L.circle([site.lat, site.lng], { radius: site.radiusM, color: "#2E7D32", weight: 2, fillColor: "#2E7D32", fillOpacity: 0.08 }).addTo(map).bindTooltip(`${site.name} · ${site.radiusM} m fence`);
        L.circleMarker([site.lat, site.lng], { radius: 6, color: "#1B5E20", fillColor: "#1B5E20", fillOpacity: 1 }).addTo(map);
        bounds.push([site.lat, site.lng]);
      }
      for (const p of points) {
        if (p.accuracyM != null && p.accuracyM > 0) L.circle([p.lat, p.lng], { radius: p.accuracyM, color: COLOURS[p.kind], weight: 1, dashArray: "4 4", fillColor: COLOURS[p.kind], fillOpacity: 0.08 }).addTo(map).bindTooltip(`±${Math.round(p.accuracyM)} m accuracy`);
        const m = L.circleMarker([p.lat, p.lng], { radius: p.kind === "latest" ? 9 : 6, color: "#fff", weight: 1.5, fillColor: COLOURS[p.kind], fillOpacity: 0.95 }).addTo(map);
        m.bindPopup(`<strong>${p.label}</strong>${p.at ? `<br/>${p.at}` : ""}${p.freshness ? `<br/>${p.freshness}` : ""}`);
        bounds.push([p.lat, p.lng]);
      }
      if (bounds.length > 1) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 17 });
      else if (site) map.fitBounds(L.circle([site.lat, site.lng], { radius: site.radiusM * 1.6 }).getBounds());
    })();
    return () => { cancelled = true; mapRef.current?.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(site), JSON.stringify(points)]);
  return (
    <div className={className}>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <div ref={ref} style={{ height }} className="w-full overflow-hidden rounded-[12px] border border-line bg-surface-2" />
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-3">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: COLOURS.latest }} />latest</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: COLOURS.exit }} />exit</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: COLOURS.return }} />return</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: COLOURS.check }} />check</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: COLOURS.call }} />call</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: COLOURS.request }} />requested fix</span>
        <span>· tiles © {tileProviderName()}</span>
      </div>
    </div>
  );
}
