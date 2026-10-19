"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap, Layer } from "leaflet";
import { tileLayerConfig, tileProviderName } from "@/components/map/tiles";

export type GuardMapProps = {
  site: { name: string; lat: number; lng: number; radiusM: number } | null;
  position: { lat: number; lng: number; accuracyM: number | null; source: "MONITORING" | "REQUESTED"; freshness: "LIVE" | "RECENT" | "STALE"; label: string } | null;
  /** A completed request that is older than the monitor's fix: drawn separately so both are visible. */
  requested?: { lat: number; lng: number; accuracyM: number | null; label: string } | null;
  className?: string;
  /** Increment to re-fit the view (recenter). */
  fitKey?: number;
};

const COLOUR = { site: "#2E7D32", live: "#2E7D32", recent: "#C98A08", stale: "#8C948A", requested: "#7B3FA0" };

/**
 * Persistent Leaflet map for the guard workspace. Created once; markers are replaced when props
 * change; `invalidateSize` runs on every container resize so the map never ends up half-drawn
 * when the panel next to it grows or the window changes. Tiles only draw pictures: every point is
 * a dated fix with its accuracy circle.
 */
export function GuardMap({ site, position, requested, className, fitKey = 0 }: GuardMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const layers = useRef<Layer[]>([]);
  const L = useRef<typeof import("leaflet") | null>(null);

  // Create once.
  useEffect(() => {
    let cancelled = false;
    let ro: ResizeObserver | null = null;
    (async () => {
      const leaflet = (await import("leaflet")).default;
      if (cancelled || !el.current || map.current) return;
      L.current = leaflet;
      const m = leaflet.map(el.current, { scrollWheelZoom: true, zoomControl: true }).setView([-17.8292, 31.0522], 12);
      const t = tileLayerConfig();
      leaflet.tileLayer(t.url, { maxZoom: t.maxZoom, attribution: t.attribution }).addTo(m);
      map.current = m;
      ro = new ResizeObserver(() => { try { m.invalidateSize(); } catch { /* unmounted */ } });
      ro.observe(el.current);
      draw(true);
    })();
    return () => { cancelled = true; ro?.disconnect(); try { map.current?.stop(); map.current?.off(); map.current?.remove(); } catch { /* gone */ } map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function draw(fit: boolean) {
    const m = map.current, leaflet = L.current;
    if (!m || !leaflet) return;
    for (const l of layers.current) l.remove();
    layers.current = [];
    const bounds: [number, number][] = [];
    if (site) {
      layers.current.push(leaflet.circle([site.lat, site.lng], { radius: site.radiusM, color: COLOUR.site, weight: 2, fillColor: COLOUR.site, fillOpacity: 0.08 }).addTo(m).bindTooltip(`${site.name} · ${site.radiusM} m fence`));
      layers.current.push(leaflet.circleMarker([site.lat, site.lng], { radius: 5, color: "#1B5E20", fillColor: "#1B5E20", fillOpacity: 1 }).addTo(m));
      bounds.push([site.lat, site.lng]);
    }
    if (requested) {
      if (requested.accuracyM) layers.current.push(leaflet.circle([requested.lat, requested.lng], { radius: requested.accuracyM, color: COLOUR.requested, weight: 1, dashArray: "4 4", fillColor: COLOUR.requested, fillOpacity: 0.08 }).addTo(m));
      layers.current.push(leaflet.circleMarker([requested.lat, requested.lng], { radius: 7, color: "#fff", weight: 1.5, fillColor: COLOUR.requested, fillOpacity: 0.95 }).addTo(m).bindTooltip(requested.label));
      bounds.push([requested.lat, requested.lng]);
    }
    if (position) {
      const c = position.freshness === "LIVE" ? (position.source === "REQUESTED" ? COLOUR.requested : COLOUR.live) : position.freshness === "RECENT" ? COLOUR.recent : COLOUR.stale;
      if (position.accuracyM) layers.current.push(leaflet.circle([position.lat, position.lng], { radius: position.accuracyM, color: c, weight: 1, dashArray: "4 4", fillColor: c, fillOpacity: 0.1 }).addTo(m).bindTooltip(`±${Math.round(position.accuracyM)} m accuracy`));
      layers.current.push(leaflet.circleMarker([position.lat, position.lng], { radius: 9, color: "#fff", weight: 2, fillColor: position.freshness === "STALE" ? "#fff" : c, fillOpacity: position.freshness === "STALE" ? 0.2 : 1 }).addTo(m).bindTooltip(position.label));
      if (position.freshness === "STALE") layers.current.push(leaflet.circleMarker([position.lat, position.lng], { radius: 9, color: c, weight: 2, fill: false }).addTo(m));
      bounds.push([position.lat, position.lng]);
    }
    if (fit) {
      if (bounds.length > 1) m.fitBounds(bounds, { padding: [36, 36], maxZoom: 17 });
      else if (site) m.fitBounds(leaflet.circle([site.lat, site.lng], { radius: Math.max(site.radiusM, 100) * 1.8 }).getBounds());
      else if (bounds.length === 1) m.setView(bounds[0], 16);
    }
  }

  // Redraw on data change; fit only when the set of points changes or recenter is pressed.
  const key = JSON.stringify({ s: site, p: position && [position.lat, position.lng, position.accuracyM, position.freshness, position.source], r: requested && [requested.lat, requested.lng] });
  const lastKey = useRef<string>("");
  useEffect(() => { const changed = key !== lastKey.current; lastKey.current = key; draw(changed); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (fitKey > 0) draw(true); }, [fitKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={className}>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <div ref={el} className="h-full w-full" data-testid="guard-map" />
      <div className="pointer-events-none absolute bottom-2 left-2 flex flex-wrap gap-x-3 gap-y-1 rounded-[8px] bg-surface/90 px-2 py-1 text-[11px] text-ink-2 shadow-sm">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: COLOUR.live }} />live fix</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: COLOUR.recent }} />recent</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full border-2" style={{ borderColor: COLOUR.stale }} />stale</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: COLOUR.requested }} />requested fix</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: COLOUR.site }} />site · fence</span>
        <span>· {tileProviderName()}</span>
      </div>
    </div>
  );
}
