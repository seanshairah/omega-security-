"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as MapboxMapType, GeoJSONSource, Popup as PopupType } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { ICON_PATHS, type IconName } from "@/components/ui/icons.generated";
import { mapboxToken, mapStyleUrl, type MapStyleKey } from "@/lib/map/provider";
import { accuracyFC, boundsOf, DEFAULT_CENTRE, fenceFC, MAP_COLOUR, pointFC, siteFC, trailFC, type MapPoint, type MapSite, type MapTrail } from "@/lib/map/features";

export type MapboxMapProps = {
  sites: MapSite[];
  points: MapPoint[];
  trails?: MapTrail[];
  /** Cluster the markers. For the fleet view, where several guards can share a site. */
  cluster?: boolean;
  styleKey?: MapStyleKey;
  /** Scroll-wheel zoom. Off for small maps inside a scrolling page, on for a map that is the workspace. */
  scrollZoom?: boolean;
  /** Clicking empty map returns the coordinate (site picker). */
  onPick?: (lat: number, lng: number) => void;
  /** Bumped by the parent to re-fit the view. */
  fitKey?: number;
  /** Re-fit when the drawn coordinates change (default), or only when fitKey changes. */
  autoFit?: boolean;
  className?: string;
  /** Called once if WebGL or the token fails, so the caller can fall back to the raster map. */
  onUnavailable?: (reason: string) => void;
};

const SRC = { fence: "omega-fences", site: "omega-sites", acc: "omega-accuracy", trail: "omega-trails", point: "omega-points" } as const;
const GLYPH_PX = 40;

/** Material Symbol rendered to a canvas so markers use the same glyphs as the rest of the interface. */
function glyphImage(name: IconName, colour: string): ImageData | null {
  const c = document.createElement("canvas");
  c.width = c.height = GLYPH_PX;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const inset = GLYPH_PX * 0.2;
  const s = (GLYPH_PX - inset * 2) / 960;
  ctx.setTransform(s, 0, 0, s, inset, inset + s * 960);
  ctx.fillStyle = colour;
  ctx.fill(new Path2D(ICON_PATHS[name][1]));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return ctx.getImageData(0, 0, GLYPH_PX, GLYPH_PX);
}

/**
 * The portal's Mapbox GL view. One map instance for the life of the component: data changes are
 * pushed into GeoJSON sources with setData, so a 15-second status poll or a 30-second feed refresh
 * never tears down or re-creates the map, loses the operator's pan and zoom, or re-downloads tiles.
 *
 * Everything drawn comes from lib/map/features.ts, which the Leaflet fallback also uses, so both
 * renderers agree on what a stale fix or an accuracy ring looks like. Mapbox renders; it is never
 * asked where a guard is.
 */
export function MapboxMap({ sites, points, trails = [], cluster = false, styleKey = "streets", scrollZoom = true, onPick, fitKey = 0, autoFit = true, className, onUnavailable }: MapboxMapProps) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<MapboxMapType | null>(null);
  const popup = useRef<PopupType | null>(null);
  const ready = useRef(false);
  // `style.load` fires before isStyleLoaded() flips, so readiness is tracked here rather than asked for.
  const styleReady = useRef(false);
  const data = useRef({ sites, points, trails, cluster });
  data.current = { sites, points, trails, cluster };
  const [failed, setFailed] = useState(false);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  // ---- layers and data, re-applied whenever a style finishes loading ----
  const paint = useCallback(() => {
    const m = map.current;
    if (!m || !styleReady.current) return;
    const { sites: ss, points: pp, trails: tt, cluster: cl } = data.current;

    const src = (id: string, fc: object, extra: object = {}) => {
      const existing = m.getSource(id) as GeoJSONSource | undefined;
      if (existing) existing.setData(fc as GeoJSON.FeatureCollection);
      else m.addSource(id, { type: "geojson", data: fc as GeoJSON.FeatureCollection, ...extra });
    };
    src(SRC.fence, fenceFC(ss));
    src(SRC.site, siteFC(ss));
    src(SRC.acc, accuracyFC(pp));
    src(SRC.trail, trailFC(tt));
    src(SRC.point, pointFC(pp), cl ? { cluster: true, clusterRadius: 44, clusterMaxZoom: 15 } : {});

    for (const p of pp) {
      for (const [suffix, colour] of [["w", "#ffffff"], ["d", "#161616"]] as const) {
        const id = `omega-${p.kind}-${suffix}`;
        if (m.hasImage(id)) continue;
        const img = glyphImage(({ guard: "shield_person", request: "my_location", candidate: "my_location", call: "call", exit: "directions_run", return: "where_to_vote", unavailable: "location_off", pin: "pin_drop", check: "check", latest: "location_on" } as Record<string, IconName>)[p.kind] ?? "location_on", colour);
        if (img) m.addImage(id, img, { pixelRatio: 2 });
      }
    }

    if (m.getLayer("omega-fence-fill")) return; // layers exist for this style; only data changed
    m.addLayer({ id: "omega-fence-fill", type: "fill", source: SRC.fence, paint: { "fill-color": MAP_COLOUR.site, "fill-opacity": 0.08 } });
    m.addLayer({ id: "omega-fence-line", type: "line", source: SRC.fence, paint: { "line-color": MAP_COLOUR.site, "line-width": 2 } });
    m.addLayer({ id: "omega-trail", type: "line", source: SRC.trail, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": MAP_COLOUR.trail, "line-width": 2, "line-opacity": 0.75, "line-dasharray": [2, 1.5] } });
    m.addLayer({ id: "omega-accuracy-fill", type: "fill", source: SRC.acc, paint: { "fill-color": ["get", "colour"], "fill-opacity": 0.1 } });
    m.addLayer({ id: "omega-accuracy-line", type: "line", source: SRC.acc, paint: { "line-color": ["get", "colour"], "line-width": 1, "line-dasharray": [3, 2], "line-opacity": 0.8 } });
    m.addLayer({ id: "omega-site-dot", type: "circle", source: SRC.site, paint: { "circle-radius": 5, "circle-color": "#1B5E20", "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.5 } });
    m.addLayer({ id: "omega-site-label", type: "symbol", source: SRC.site, minzoom: 12, layout: { "text-field": ["get", "name"], "text-size": 11, "text-offset": [0, 1.1], "text-anchor": "top", "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"] }, paint: { "text-color": "#2b2b2b", "text-halo-color": "#ffffff", "text-halo-width": 1.4 } });
    m.addLayer({ id: "omega-alert-ring", type: "circle", source: SRC.point, filter: ["all", ["!", ["has", "point_count"]], ["!=", ["get", "alert"], ""]], paint: { "circle-radius": ["+", ["get", "radius"], 5], "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": MAP_COLOUR.alert, "circle-stroke-width": 3 } });
    if (cl) {
      // A cluster is a count, not a state: it stays neutral so a group of guards is never read as "on site".
      m.addLayer({ id: "omega-cluster", type: "circle", source: SRC.point, filter: ["has", "point_count"], paint: { "circle-color": "#2b2b2b", "circle-opacity": 0.92, "circle-radius": ["step", ["get", "point_count"], 15, 5, 19, 15, 24], "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } });
      m.addLayer({ id: "omega-cluster-count", type: "symbol", source: SRC.point, filter: ["has", "point_count"], layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12, "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"] }, paint: { "text-color": "#ffffff" } });
    }
    const unclustered = ["!", ["has", "point_count"]] as unknown as never;
    m.addLayer({ id: "omega-point", type: "circle", source: SRC.point, filter: unclustered, paint: { "circle-radius": ["get", "radius"], "circle-color": ["case", ["get", "hollow"], "#ffffff", ["get", "colour"]], "circle-stroke-color": ["case", ["get", "hollow"], ["get", "colour"], "#ffffff"], "circle-stroke-width": 2 } });
    m.addLayer({ id: "omega-point-glyph", type: "symbol", source: SRC.point, filter: unclustered, layout: { "icon-image": ["concat", "omega-", ["get", "kind"], ["case", ["get", "hollow"], "-d", "-w"]], "icon-size": ["case", ["get", "emphasis"], 0.5, 0.38], "icon-allow-overlap": true }, paint: {} });
    m.addLayer({ id: "omega-point-label", type: "symbol", source: SRC.point, filter: ["all", unclustered, ["get", "emphasis"]], minzoom: 11, layout: { "text-field": ["get", "label"], "text-size": 11, "text-offset": [0, 1.3], "text-anchor": "top", "text-max-width": 18, "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"] }, paint: { "text-color": "#161616", "text-halo-color": "#ffffff", "text-halo-width": 1.6 } });

    for (const layer of ["omega-point", "omega-point-glyph", "omega-site-dot", "omega-cluster"]) {
      if (!m.getLayer(layer)) continue;
      m.on("mouseenter", layer, () => { m.getCanvas().style.cursor = "pointer"; });
      m.on("mouseleave", layer, () => { m.getCanvas().style.cursor = ""; });
    }
    // Popups are built as DOM nodes with textContent: guard names and device names are data, never markup.
    for (const layer of ["omega-point", "omega-point-glyph", "omega-site-dot"]) {
      if (!m.getLayer(layer)) continue;
      m.on("click", layer, (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const pr = f.properties as Record<string, string> | null;
        if (!pr) return;
        const box = document.createElement("div");
        box.className = "omega-popup";
        const title = document.createElement("strong");
        title.textContent = pr.label || pr.name || "Position";
        box.append(title);
        for (const line of [pr.at, pr.detail, pr.accuracyM ? `±${pr.accuracyM} m` : "", pr.alert].filter(Boolean)) {
          const p = document.createElement("div");
          p.textContent = line;
          if (line === pr.alert) p.style.color = MAP_COLOUR.alert;
          box.append(p);
        }
        if (pr.href) {
          const a = document.createElement("a");
          a.href = pr.href;
          a.textContent = pr.hrefLabel || "Open";
          box.append(a);
        }
        const geom = f.geometry as GeoJSON.Point;
        void (async () => {
          const mod = await import("mapbox-gl");
          popup.current?.remove();
          popup.current = new mod.Popup({ closeButton: true, offset: 12, maxWidth: "260px" }).setLngLat(geom.coordinates as [number, number]).setDOMContent(box).addTo(m);
        })();
      });
    }
    if (m.getLayer("omega-cluster")) m.on("click", "omega-cluster", (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const source = m.getSource(SRC.point) as GeoJSONSource;
      source.getClusterExpansionZoom(f.properties!.cluster_id as number, (err, z) => { if (err || z == null) return; m.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom: z }); });
    });
  }, []);

  const fit = useCallback(() => {
    const m = map.current;
    if (!m) return;
    const { sites: ss, points: pp, trails: tt } = data.current;
    const b = boundsOf(ss, pp, tt);
    if (!b) return;
    if (b.west === b.east && b.south === b.north) m.easeTo({ center: [b.west, b.south], zoom: Math.max(m.getZoom(), 15), duration: 400 });
    else m.fitBounds([[b.west, b.south], [b.east, b.north]], { padding: 48, maxZoom: 17, duration: 400 });
  }, []);

  // ---- create once ----
  useEffect(() => {
    let cancelled = false;
    let ro: ResizeObserver | null = null;
    (async () => {
      const token = mapboxToken();
      if (!token) { setFailed(true); onUnavailable?.("no Mapbox token"); return; }
      try {
        const mod = (await import("mapbox-gl")).default;
        if (cancelled || !host.current || map.current) return;
        mod.accessToken = token;
        const m = new mod.Map({
          container: host.current,
          style: mapStyleUrl(styleKey),
          center: [DEFAULT_CENTRE.lng, DEFAULT_CENTRE.lat],
          zoom: 11,
          scrollZoom,
          attributionControl: true,
          // Mapbox's own anonymous usage telemetry is switched off: this is an operational tool.
          collectResourceTiming: false,
          pitch: 0,
        });
        map.current = m;
        m.addControl(new mod.NavigationControl({ visualizePitch: false }), "top-right");
        m.addControl(new mod.ScaleControl({ maxWidth: 90, unit: "metric" }), "bottom-left");
        m.on("style.load", () => { styleReady.current = true; paint(); if (!ready.current) { ready.current = true; fit(); } });
        // Test hook: the browser suites assert on the real layers and sources rather than on pixels.
        (window as unknown as { __omegaMap?: unknown }).__omegaMap = m;
        m.on("error", (e) => { if (e.error?.message) console.warn("[map]", e.error.message); });
        m.on("click", (e) => { const hit = m.queryRenderedFeatures(e.point, { layers: ["omega-point", "omega-point-glyph", "omega-site-dot", "omega-cluster"].filter((l) => m.getLayer(l)) }); if (!hit.length) onPickRef.current?.(e.lngLat.lat, e.lngLat.lng); });
        ro = new ResizeObserver(() => { try { m.resize(); } catch { /* unmounted */ } });
        ro.observe(host.current);
      } catch (e) {
        setFailed(true);
        onUnavailable?.(e instanceof Error ? e.message : "WebGL unavailable");
      }
    })();
    return () => {
      cancelled = true;
      ro?.disconnect();
      popup.current?.remove();
      try { map.current?.remove(); } catch { /* already gone */ }
      map.current = null;
      ready.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- data in, no remount ----
  const sig = JSON.stringify({ s: sites.map((s) => [s.id, s.lat, s.lng, s.radiusM]), p: points.map((p) => [p.id, p.lat, p.lng, p.accuracyM, p.freshness, p.state, p.alert]), t: trails.map((t) => [t.id, t.points.length]) });
  const lastSig = useRef("");
  useEffect(() => {
    paint();
    const changed = sig !== lastSig.current;
    lastSig.current = sig;
    if (changed && autoFit && ready.current) fit();
  }, [sig, paint, fit, autoFit]);
  useEffect(() => { if (fitKey > 0) fit(); }, [fitKey, fit]);
  useEffect(() => { const m = map.current; if (m && ready.current) { styleReady.current = false; m.setStyle(mapStyleUrl(styleKey)); } }, [styleKey]);
  useEffect(() => { const m = map.current; if (!m) return; if (scrollZoom) m.scrollZoom.enable(); else m.scrollZoom.disable(); }, [scrollZoom]);

  if (failed) return null;
  return <div ref={host} className={className} data-testid="mapbox-map" />;
}
