"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap } from "leaflet";

export type LiveSite = { id: string; name: string; lat: number; lng: number; radiusM: number; href: string; guards: number };
export type LiveGuard = { id: string; name: string; lat: number; lng: number; state: "INSIDE" | "OUTSIDE" | "UNKNOWN"; at: string; freshness: string; accuracyM?: number | null; href: string; alert?: string | null };

const STATE_COLOUR: Record<LiveGuard["state"], string> = { INSIDE: "#2E7D32", OUTSIDE: "#C62828", UNKNOWN: "#8C948A" };

/**
 * Every active site with its fence and every Android guard's last fix, on one OpenStreetMap
 * view. A fix is a dated point with its accuracy, never a live stream; stale points are drawn
 * hollow so nobody reads a two-hour-old fix as "there now".
 */
export function LiveMap({ sites, guards, height = 520 }: { sites: LiveSite[]; guards: LiveGuard[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !ref.current || mapRef.current) return;
      const map = L.map(ref.current, { scrollWheelZoom: true }).setView([-17.8292, 31.0522], 12);
      mapRef.current = map;
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
      const bounds: [number, number][] = [];
      for (const s of sites) {
        L.circle([s.lat, s.lng], { radius: s.radiusM, color: "#2E7D32", weight: 2, fillColor: "#2E7D32", fillOpacity: 0.07 }).addTo(map).bindTooltip(`${s.name} · ${s.radiusM} m · ${s.guards} guard${s.guards === 1 ? "" : "s"} on shift`);
        L.circleMarker([s.lat, s.lng], { radius: 5, color: "#1B5E20", fillColor: "#1B5E20", fillOpacity: 1 }).addTo(map).bindPopup(`<strong>${s.name}</strong><br/><a href="${s.href}">Open site</a>`);
        bounds.push([s.lat, s.lng]);
      }
      for (const g of guards) {
        const stale = g.freshness === "STALE";
        const m = L.circleMarker([g.lat, g.lng], { radius: g.alert ? 11 : 8, color: g.alert ? "#C62828" : "#fff", weight: g.alert ? 3 : 1.5, fillColor: STATE_COLOUR[g.state], fillOpacity: stale ? 0.25 : 0.95 }).addTo(map);
        m.bindPopup(`<strong>${g.name}</strong><br/>${g.state.toLowerCase()}${g.accuracyM != null ? ` · ±${Math.round(g.accuracyM)} m` : ""}<br/>${g.at} · ${g.freshness.toLowerCase()}${g.alert ? `<br/><span style="color:#C62828;font-weight:600">${g.alert}</span>` : ""}<br/><a href="${g.href}">Open shift</a>`);
        if (g.alert) m.bindTooltip(`${g.name}: ${g.alert}`, { permanent: true, direction: "top", offset: [0, -10] });
        bounds.push([g.lat, g.lng]);
      }
      if (bounds.length > 1) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
      else if (bounds.length === 1) map.setView(bounds[0], 15);
    })();
    return () => { cancelled = true; try { mapRef.current?.remove(); } catch { /* gone */ } mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(sites), JSON.stringify(guards)]);
  return (
    <div>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <div ref={ref} style={{ height }} className="w-full overflow-hidden rounded-[12px] border border-line bg-surface-2" />
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-3">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: STATE_COLOUR.INSIDE }} />inside site</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: STATE_COLOUR.OUTSIDE }} />outside site</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: STATE_COLOUR.UNKNOWN }} />unknown</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full border-2 border-critical" />open alert</span>
        <span>hollow = stale fix · tiles © OpenStreetMap</span>
      </div>
    </div>
  );
}
