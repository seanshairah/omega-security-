"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { mapProvider, MAP_STYLE_LABEL, mapProviderName, type MapStyleKey } from "@/lib/map/provider";
import { mapLegend, type MapPoint, type MapSite, type MapTrail } from "@/lib/map/features";
import { MapboxMap } from "./mapbox-map";
import { LeafletMap } from "./leaflet-map";
import { cn } from "@/lib/cn";

export type MapViewProps = {
  sites: MapSite[];
  points: MapPoint[];
  trails?: MapTrail[];
  cluster?: boolean;
  scrollZoom?: boolean;
  onPick?: (lat: number, lng: number) => void;
  fitKey?: number;
  autoFit?: boolean;
  /** Fixed pixel height, or omit and let the parent's layout size the map (the guard workspace does). */
  height?: number;
  /** Street/satellite switch. Mapbox only; hidden on the raster fallback. */
  allowSatellite?: boolean;
  /** Colour key under the map. Off for small maps that only show one site. */
  legend?: boolean;
  /** Stable hook for the layout tests, independent of which renderer is active. */
  testId?: string;
  className?: string;
};

/**
 * Every map in the portal renders through here: it picks Mapbox GL when a token is configured,
 * falls back to the raster Leaflet map when there is no token or WebGL fails at runtime, and draws
 * the legend and the satellite switch around either one. Callers pass the same model to both.
 */
export function MapView({ sites, points, trails = [], cluster, scrollZoom = true, onPick, fitKey, autoFit, height, allowSatellite = false, legend = true, testId, className }: MapViewProps) {
  const [fellBack, setFellBack] = useState(false);
  const [style, setStyle] = useState<MapStyleKey>("streets");
  const useMapbox = mapProvider() === "mapbox" && !fellBack;
  const rows = legend ? mapLegend(points, sites.length > 0) : [];
  const frame = "absolute inset-0 h-full w-full";

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      {/* With an explicit height the box must not be a flex item on the main axis: `flex-1` sets
          flex-basis to 0 and would collapse it to nothing. Without one, the parent's layout sizes it. */}
      <div data-testid={testId} className={cn("relative overflow-hidden rounded-[12px] border border-line bg-surface-2", height ? "shrink-0" : "min-h-0 flex-1")} style={height ? { height } : undefined}>
        {useMapbox ? (
          <MapboxMap sites={sites} points={points} trails={trails} cluster={cluster} styleKey={style} scrollZoom={scrollZoom} onPick={onPick} fitKey={fitKey} autoFit={autoFit} className={frame} onUnavailable={() => setFellBack(true)} />
        ) : (
          <LeafletMap sites={sites} points={points} trails={trails} scrollZoom={scrollZoom} onPick={onPick} fitKey={fitKey} autoFit={autoFit} className={frame} />
        )}
        {useMapbox && allowSatellite && (
          <div className="absolute left-2 top-2 flex overflow-hidden rounded-[8px] border border-line bg-surface shadow-sm">
            {(["streets", "satellite"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setStyle(k)} aria-pressed={style === k} className={cn("inline-flex h-7 items-center gap-1 px-2 text-[12px] font-medium", style === k ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2")}>
                <Icon name={k === "satellite" ? "satellite_alt" : "map"} size="sm" filled={style === k} />
                {MAP_STYLE_LABEL[k]}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="mt-2 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-3">
        {rows.map((r) => (
          <span key={r.label} className="inline-flex items-center gap-1">
            <span className={cn("inline-block h-2 w-2 rounded-full", (r.hollow || r.ring) && "border-2")} style={r.hollow || r.ring ? { borderColor: r.colour } : { background: r.colour }} />
            {r.label}
          </span>
        ))}
        <span className="ml-auto">{mapProviderName(useMapbox ? "mapbox" : "leaflet")}{fellBack ? " (fallback)" : ""}</span>
      </div>
    </div>
  );
}
