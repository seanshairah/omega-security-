"use client";

import { useCallback, useEffect, useRef } from "react";
import type { Map as LeafletMapInstance, Layer } from "leaflet";
import { tileLayerConfig } from "./tiles";
import { boundsOf, DEFAULT_CENTRE, hasCoords, MAP_COLOUR, pointColour, pointHollow, pointRadius, type MapPoint, type MapSite, type MapTrail } from "@/lib/map/features";

export type LeafletMapProps = {
  sites: MapSite[];
  points: MapPoint[];
  trails?: MapTrail[];
  scrollZoom?: boolean;
  onPick?: (lat: number, lng: number) => void;
  fitKey?: number;
  autoFit?: boolean;
  className?: string;
};

/**
 * Raster fallback for every portal map, used when no Mapbox token is configured or when the
 * browser cannot start WebGL. It reads the same lib/map/features.ts model as the Mapbox view, so
 * a stale fix, an accuracy ring and a fence look the same in both and nothing is lost by falling
 * back. Leaflet takes [lat, lng]; the shared model is GeoJSON order, converted here.
 */
export function LeafletMap({ sites, points, trails = [], scrollZoom = true, onPick, fitKey = 0, autoFit = true, className }: LeafletMapProps) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMapInstance | null>(null);
  const L = useRef<typeof import("leaflet") | null>(null);
  const drawn = useRef<Layer[]>([]);
  const data = useRef({ sites, points, trails });
  data.current = { sites, points, trails };
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  const draw = useCallback((fit: boolean) => {
    const m = map.current, leaflet = L.current;
    if (!m || !leaflet) return;
    for (const l of drawn.current) l.remove();
    drawn.current = [];
    const { sites: ss, points: pp, trails: tt } = data.current;
    for (const s of ss.filter(hasCoords)) {
      drawn.current.push(leaflet.circle([s.lat, s.lng], { radius: Math.max(s.radiusM, 1), color: MAP_COLOUR.site, weight: 2, fillColor: MAP_COLOUR.site, fillOpacity: 0.08 }).addTo(m).bindTooltip(`${s.name} · ${s.radiusM} m fence`));
      drawn.current.push(leaflet.circleMarker([s.lat, s.lng], { radius: 5, color: "#fff", weight: 1.5, fillColor: "#1B5E20", fillOpacity: 1 }).addTo(m).bindPopup(popupHtml(s.name, [s.detail ?? `${s.radiusM} m fence`], s.href)));
    }
    for (const t of tt) {
      const line = t.points.filter(hasCoords).map((p) => [p.lat, p.lng] as [number, number]);
      if (line.length > 1) drawn.current.push(leaflet.polyline(line, { color: MAP_COLOUR.trail, weight: 2, opacity: 0.75, dashArray: "6 4" }).addTo(m));
    }
    for (const p of pp.filter(hasCoords)) {
      const colour = pointColour(p);
      const hollow = pointHollow(p);
      if (p.accuracyM != null && p.accuracyM > 0) drawn.current.push(leaflet.circle([p.lat, p.lng], { radius: p.accuracyM, color: colour, weight: 1, dashArray: "4 4", fillColor: colour, fillOpacity: 0.1 }).addTo(m).bindTooltip(`±${Math.round(p.accuracyM)} m accuracy`));
      if (p.alert) drawn.current.push(leaflet.circleMarker([p.lat, p.lng], { radius: pointRadius(p) + 4, color: MAP_COLOUR.alert, weight: 3, fill: false }).addTo(m));
      const marker = leaflet.circleMarker([p.lat, p.lng], { radius: pointRadius(p), color: hollow ? colour : "#fff", weight: 2, fillColor: hollow ? "#fff" : colour, fillOpacity: hollow ? 0.85 : 1 }).addTo(m);
      marker.bindTooltip(p.label);
      marker.bindPopup(popupHtml(p.label, [p.at ?? "", p.detail ?? "", p.accuracyM != null ? `±${Math.round(p.accuracyM)} m` : "", p.alert ?? ""], p.href, p.hrefLabel));
      drawn.current.push(marker);
    }
    if (!fit) return;
    const b = boundsOf(ss, pp, tt);
    if (!b) return;
    if (b.west === b.east && b.south === b.north) m.setView([b.south, b.west], Math.max(m.getZoom(), 15));
    else m.fitBounds([[b.south, b.west], [b.north, b.east]], { padding: [36, 36], maxZoom: 17 });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let ro: ResizeObserver | null = null;
    (async () => {
      const leaflet = (await import("leaflet")).default;
      if (cancelled || !host.current || map.current) return;
      L.current = leaflet;
      const m = leaflet.map(host.current, { scrollWheelZoom: scrollZoom, zoomControl: true }).setView([DEFAULT_CENTRE.lat, DEFAULT_CENTRE.lng], 11);
      const t = tileLayerConfig();
      leaflet.tileLayer(t.url, { maxZoom: t.maxZoom, attribution: t.attribution }).addTo(m);
      map.current = m;
      m.on("click", (e) => onPickRef.current?.(e.latlng.lat, e.latlng.lng));
      ro = new ResizeObserver(() => { try { m.invalidateSize(); } catch { /* unmounted */ } });
      ro.observe(host.current);
      draw(true);
    })();
    return () => { cancelled = true; ro?.disconnect(); try { map.current?.stop(); map.current?.off(); map.current?.remove(); } catch { /* gone */ } map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sig = JSON.stringify({ s: sites.map((s) => [s.id, s.lat, s.lng, s.radiusM]), p: points.map((p) => [p.id, p.lat, p.lng, p.accuracyM, p.freshness, p.state, p.alert]), t: trails.map((t) => [t.id, t.points.length]) });
  const lastSig = useRef("");
  useEffect(() => { const changed = sig !== lastSig.current; lastSig.current = sig; draw(changed && autoFit); }, [sig, draw, autoFit]);
  useEffect(() => { if (fitKey > 0) draw(true); }, [fitKey, draw]);
  useEffect(() => { const m = map.current; if (!m) return; if (scrollZoom) m.scrollWheelZoom.enable(); else m.scrollWheelZoom.disable(); }, [scrollZoom]);

  return (
    <>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <div ref={host} className={className} data-testid="leaflet-map" />
    </>
  );
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
function popupHtml(title: string, lines: string[], href?: string, hrefLabel = "Open") {
  return `<strong>${esc(title)}</strong>${lines.filter(Boolean).map((l) => `<br/>${esc(l)}`).join("")}${href ? `<br/><a href="${esc(href)}">${esc(hrefLabel)}</a>` : ""}`;
}
