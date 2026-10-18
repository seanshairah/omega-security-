"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Map as LeafletMap, Marker as LeafletMarker, Circle as LeafletCircle } from "leaflet";
import { RADIUS_CHOICES } from "@/lib/geofence";
import { Field, Input, Select, Checkbox } from "@/components/ui/form";
import { Status } from "@/components/ui/status";

/**
 * Duty-site geofence picker for the admin portal (never shipped in the APK).
 *
 * With NEXT_PUBLIC_GOOGLE_MAPS_API_KEY set: Google Maps with Places search, a draggable pin and a
 * radius circle. Without it: the same controls on OpenStreetMap tiles (Leaflet) with Nominatim
 * search. Either way the form fields below the map are the source of truth: latitude, longitude,
 * radius and the coordinates' provenance (MAP / MANUAL / TEST) are ordinary inputs the server
 * action validates. Dragging the pin writes the inputs; typing in the inputs moves the pin.
 */
export type PickerNames = { lat: string; lng: string; radius: string; source?: string; placeId?: string };
export type PickerValue = { lat: number | null; lng: number | null; radiusM: number; source?: "MAP" | "MANUAL" | "TEST" | null; placeId?: string | null };

const DEFAULT_CENTRE = { lat: -17.8292, lng: 31.0522 }; // Harare
const LIMITS = { radiusMin: 20, radiusMax: 5000 };

type Engine = "google" | "leaflet";

export function SitePicker({ names, initial, mapsKey, height = 340, showSource = true, radiusRequired = true, siteFallbackRadius }: { names: PickerNames; initial: PickerValue; mapsKey?: string; height?: number; showSource?: boolean; radiusRequired?: boolean; siteFallbackRadius?: number }) {
  const engine: Engine = mapsKey ? "google" : "leaflet";
  const [lat, setLat] = useState<string>(initial.lat != null ? String(initial.lat) : "");
  const [lng, setLng] = useState<string>(initial.lng != null ? String(initial.lng) : "");
  const [radius, setRadius] = useState<string>(String(initial.radiusM || 150));
  const [source, setSource] = useState<string>(initial.source ?? (initial.lat != null ? "MANUAL" : ""));
  const [placeId, setPlaceId] = useState<string>(initial.placeId ?? "");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>("");
  const [results, setResults] = useState<{ label: string; lat: number; lng: number; placeId?: string }[]>([]);
  const mapEl = useRef<HTMLDivElement>(null);
  const searchEl = useRef<HTMLDivElement>(null);
  const engineRef = useRef<{ setPin: (lat: number, lng: number, zoom?: boolean) => void; setRadius: (r: number) => void; clear: () => void; destroy: () => void } | null>(null);

  const latN = Number(lat), lngN = Number(lng), radiusN = Number(radius);
  const hasPin = lat !== "" && lng !== "" && Number.isFinite(latN) && Number.isFinite(lngN);
  const radiusOk = Number.isInteger(radiusN) && radiusN >= LIMITS.radiusMin && radiusN <= LIMITS.radiusMax;

  const place = useCallback((la: number, ln: number, how: "MAP" | "MANUAL", pid?: string) => {
    setLat(la.toFixed(6)); setLng(ln.toFixed(6));
    setSource((s) => (s === "TEST" ? "TEST" : how));
    if (pid !== undefined) setPlaceId(pid);
    engineRef.current?.setPin(la, ln, how === "MAP" && pid !== undefined);
  }, []);

  // ---- map engines ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!mapEl.current) return;
      // Load libraries first, then check `cancelled` before touching the DOM: React 19 dev mode runs
      // effects twice, and a second Leaflet map on the same element throws "already initialized".
      const leaflet = async () => {
        const L = (await import("leaflet")).default;
        if (cancelled || !mapEl.current || engineRef.current) return;
        engineRef.current = mountLeaflet(L, mapEl.current, hasPin ? { lat: latN, lng: lngN } : null, radiusOk ? radiusN : 150, (la, ln) => place(la, ln, "MAP", ""));
      };
      if (engine === "google") {
        try {
          await loadGoogleMaps(mapsKey!);
          const maps = (await google.maps.importLibrary("maps")) as google.maps.MapsLibrary;
          if (cancelled || !mapEl.current || engineRef.current) return;
          engineRef.current = mountGoogle(maps, mapEl.current, searchEl.current, hasPin ? { lat: latN, lng: lngN } : null, radiusOk ? radiusN : 150, (la, ln, pid) => place(la, ln, "MAP", pid), setStatus);
        } catch (e) {
          setStatus(`Google Maps could not load (${e instanceof Error ? e.message : "unknown error"}). Showing OpenStreetMap instead.`);
          await leaflet();
        }
      } else await leaflet();
    })();
    return () => { cancelled = true; engineRef.current?.destroy(); engineRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);

  useEffect(() => { if (radiusOk) engineRef.current?.setRadius(radiusN); }, [radiusN, radiusOk]);

  const onTyped = (which: "lat" | "lng", v: string) => {
    if (which === "lat") setLat(v); else setLng(v);
    const la = which === "lat" ? Number(v) : latN, ln = which === "lng" ? Number(v) : lngN;
    const other = which === "lat" ? lng : lat;
    if (v !== "" && other !== "" && Number.isFinite(la) && Number.isFinite(ln) && Math.abs(la) <= 90 && Math.abs(ln) <= 180) { setSource((s) => (s === "TEST" ? "TEST" : "MANUAL")); setPlaceId(""); engineRef.current?.setPin(la, ln, false); }
  };

  const clear = () => { setLat(""); setLng(""); setSource(""); setPlaceId(""); setResults([]); engineRef.current?.clear(); };

  const useMyLocation = () => {
    if (!navigator.geolocation) { setStatus("This browser cannot report your position."); return; }
    setStatus("Getting your position…");
    navigator.geolocation.getCurrentPosition((p) => { place(p.coords.latitude, p.coords.longitude, "MAP", ""); setStatus(`Pinned at your position (±${Math.round(p.coords.accuracy)} m). Drag the pin to the exact spot.`); }, (e) => setStatus(`Position not available: ${e.message}`), { enableHighAccuracy: true, timeout: 15000 });
  };

  const search = async () => {
    const q = query.trim();
    if (!q) return;
    setStatus("Searching…"); setResults([]);
    try {
      if (engine === "google" && window.google?.maps) {
        const geocoder = new google.maps.Geocoder();
        const r = await geocoder.geocode({ address: q, region: "zw" });
        const list = r.results.slice(0, 5).map((x) => ({ label: x.formatted_address, lat: x.geometry.location.lat(), lng: x.geometry.location.lng(), placeId: x.place_id }));
        setResults(list); setStatus(list.length ? `${list.length} result(s). Pick one, then drag the pin if needed.` : "No results. Try the street or suburb, or zoom and click the map.");
      } else {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=zw&q=${encodeURIComponent(q)}`, { headers: { Accept: "application/json" } });
        const list = ((await res.json()) as { display_name: string; lat: string; lon: string }[]).map((x) => ({ label: x.display_name, lat: Number(x.lat), lng: Number(x.lon) }));
        setResults(list); setStatus(list.length ? `${list.length} result(s) from OpenStreetMap. Pick one, then drag the pin if needed.` : "No results. Try the street or suburb, or zoom and click the map.");
      }
    } catch (e) { setStatus(`Search failed: ${e instanceof Error ? e.message : "unknown error"}`); }
  };

  const areaHa = radiusOk ? (Math.PI * radiusN * radiusN) / 10_000 : null;

  return (
    <div className="sm:col-span-2 space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="mb-1 block text-[12px] font-medium text-ink-2">Search for the site</label>
          {engine === "google" ? <div ref={searchEl} className="[&>gmp-place-autocomplete]:w-full" /> : null}
          <div className="flex gap-2">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); search(); } }} placeholder={engine === "google" ? "Street, suburb or landmark (or use the suggestions above)" : "Street, suburb or landmark in Zimbabwe"} />
            <button type="button" onClick={search} className="h-10 whitespace-nowrap rounded-[8px] border border-line bg-surface px-3 text-[13px] font-medium hover:bg-surface-2">Search</button>
          </div>
        </div>
        <button type="button" onClick={useMyLocation} className="h-10 whitespace-nowrap rounded-[8px] border border-line bg-surface px-3 text-[13px] font-medium hover:bg-surface-2">Use my position</button>
        <button type="button" onClick={clear} className="h-10 whitespace-nowrap rounded-[8px] border border-line bg-surface px-3 text-[13px] font-medium text-ink-2 hover:bg-surface-2">Clear pin</button>
      </div>
      {results.length > 0 && (
        <ul className="divide-y divide-line rounded-[8px] border border-line bg-surface text-[13px]">
          {results.map((r, i) => <li key={i}><button type="button" className="w-full px-3 py-2 text-left hover:bg-surface-2" onClick={() => { place(r.lat, r.lng, "MAP", r.placeId ?? ""); setResults([]); setQuery(r.label); engineRef.current?.setPin(r.lat, r.lng, true); }}>{r.label}</button></li>)}
        </ul>
      )}
      {engine === "leaflet" && <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />}
      <div ref={mapEl} style={{ height }} className="w-full overflow-hidden rounded-[12px] border border-line bg-surface-2" />
      <p className="text-[12px] text-ink-3">{status || (engine === "google" ? "Click the map or drag the pin to the exact centre of the site. The circle is the geofence." : "OpenStreetMap tiles (no Google Maps key configured). Click the map or drag the pin to the exact centre of the site. The circle is the geofence.")}</p>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Latitude" hint="−90 to 90"><Input name={names.lat} type="number" step="any" min={-90} max={90} value={lat} onChange={(e) => onTyped("lat", e.target.value)} placeholder="-17.8292" /></Field>
        <Field label="Longitude" hint="−180 to 180"><Input name={names.lng} type="number" step="any" min={-180} max={180} value={lng} onChange={(e) => onTyped("lng", e.target.value)} placeholder="31.0522" /></Field>
        <Field label="Geofence radius (m)" hint={radiusRequired ? "50 shop · 150 warehouse · 500 mine. 20–5000." : `Blank keeps the site's ${siteFallbackRadius ?? 150} m.`}>
          <Input name={names.radius} type="number" min={LIMITS.radiusMin} max={LIMITS.radiusMax} step={10} value={radius} onChange={(e) => setRadius(e.target.value)} list={`${names.radius}-choices`} />
          <datalist id={`${names.radius}-choices`}>{RADIUS_CHOICES.map((r) => <option key={r} value={r} />)}</datalist>
        </Field>
        {showSource && names.source && (
          <Field label="Coordinates are" hint="TEST marks temporary values that must not be trusted for verification." className="sm:col-span-2">
            <Select name={names.source} value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">— none —</option>
              <option value="MAP">Placed on the map (verified)</option>
              <option value="MANUAL">Typed or pasted by hand</option>
              <option value="TEST">TEST coordinates (temporary, not verified)</option>
            </Select>
          </Field>
        )}
        {names.placeId && <input type="hidden" name={names.placeId} value={placeId} />}
      </div>

      <div className="rounded-[8px] border border-dashed border-line bg-surface-2 px-3 py-2 text-[12.5px] text-ink-2">
        {hasPin ? (
          <span className="tnum">Preview: centre {latN.toFixed(5)}, {lngN.toFixed(5)}{radiusOk ? ` · radius ${radiusN} m · ≈ ${areaHa!.toFixed(areaHa! < 1 ? 2 : 1)} ha` : " · radius out of range"} · a guard within {radiusOk ? radiusN : "?"} m of the centre (plus GPS error) is on site.</span>
        ) : <span>No coordinates: GPS verification stays off for this {radiusRequired ? "site" : "shift's override"}; SMS checks continue as usual.</span>}
        {source === "TEST" && <div className="mt-1"><Status tone="warn">TEST coordinates: shown with a warning everywhere, never treated as verified</Status></div>}
      </div>
    </div>
  );
}

/** New-shift / shift page: tick to override the site's fence for this shift only. */
export function GeofenceOverrideSection({ initial, mapsKey, siteRadius, siteName }: { initial: { enabled: boolean; lat: number | null; lng: number | null; radiusM: number | null; note: string | null }; mapsKey?: string; siteRadius: number; siteName?: string }) {
  const [on, setOn] = useState(initial.enabled);
  return (
    <div className="sm:col-span-2 space-y-3">
      <Checkbox name="overrideGeofence" label="Use a different geofence for this shift" hint={`Only when the post is away from ${siteName ? `${siteName}'s` : "the site's"} centre (a gate, a car park, a patrol area). Otherwise the site's fence applies.`} checked={on} onChange={(e) => setOn(e.target.checked)} />
      {on && (
        <>
          <SitePicker names={{ lat: "geofenceLatitude", lng: "geofenceLongitude", radius: "geofenceRadiusM" }} initial={{ lat: initial.lat, lng: initial.lng, radiusM: initial.radiusM ?? siteRadius }} mapsKey={mapsKey} height={280} showSource={false} radiusRequired={false} siteFallbackRadius={siteRadius} />
          <Field label="Reason for the override" hint="Shown on the shift timeline." className="sm:col-span-2"><Input name="geofenceNote" defaultValue={initial.note ?? ""} placeholder="e.g. Guard is posted at the north gate" /></Field>
        </>
      )}
    </div>
  );
}

// ---------------- Google Maps ----------------

declare global { interface Window { google?: typeof google } }

let googleLoading: Promise<void> | null = null;
function loadGoogleMaps(key: string): Promise<void> {
  if (typeof window.google?.maps?.importLibrary === "function") return Promise.resolve();
  if (googleLoading) return googleLoading;
  googleLoading = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&region=ZW`;
    s.async = true;
    s.onerror = () => { googleLoading = null; reject(new Error("script blocked or key invalid")); };
    s.onload = () => {
      const started = Date.now();
      const tick = () => { if (typeof window.google?.maps?.importLibrary === "function") resolve(); else if (Date.now() - started > 15000) reject(new Error("timed out")); else setTimeout(tick, 50); };
      tick();
    };
    document.head.appendChild(s);
  });
  return googleLoading;
}

type PlaceAutocompleteEl = HTMLElement & { addEventListener(type: "gmp-select", listener: (ev: Event & { placePrediction: { toPlace(): { fetchFields(o: { fields: string[] }): Promise<unknown>; location: google.maps.LatLng | null; id: string; displayName?: string | null; formattedAddress?: string | null } } }) => void): void };

function mountGoogle({ Map }: google.maps.MapsLibrary, el: HTMLElement, searchHost: HTMLElement | null, pin: { lat: number; lng: number } | null, radiusM: number, onPin: (lat: number, lng: number, placeId?: string) => void, setStatus: (s: string) => void) {
  const map = new Map(el, { center: pin ?? DEFAULT_CENTRE, zoom: pin ? 16 : 12, mapTypeControl: true, streetViewControl: false, fullscreenControl: true, gestureHandling: "greedy" });
  const marker = new google.maps.Marker({ map, position: pin ?? undefined, draggable: true, title: "Site centre (drag me)" });
  const circle = new google.maps.Circle({ map: pin ? map : null, center: pin ?? DEFAULT_CENTRE, radius: radiusM, strokeColor: "#2E7D32", strokeWeight: 2, fillColor: "#2E7D32", fillOpacity: 0.08, clickable: false });
  const setPin = (lat: number, lng: number, zoom?: boolean) => { const p = { lat, lng }; marker.setPosition(p); marker.setMap(map); circle.setCenter(p); circle.setMap(map); if (zoom) { map.setCenter(p); map.setZoom(Math.max(map.getZoom() ?? 16, 16)); } };
  marker.addListener("dragend", () => { const p = marker.getPosition(); if (p) { circle.setCenter(p); onPin(p.lat(), p.lng(), ""); } });
  map.addListener("click", (e: google.maps.MapMouseEvent) => { if (e.latLng) { setPin(e.latLng.lat(), e.latLng.lng()); onPin(e.latLng.lat(), e.latLng.lng(), ""); } });
  // Places search box (new Places API web component). Falls back to the plain geocoder search when unavailable.
  if (searchHost) void (async () => {
    try {
      const places = (await google.maps.importLibrary("places")) as unknown as { PlaceAutocompleteElement?: new (o: { includedRegionCodes?: string[] }) => PlaceAutocompleteEl };
      if (places.PlaceAutocompleteElement) {
        const ac = new places.PlaceAutocompleteElement({ includedRegionCodes: ["zw"] });
        ac.style.width = "100%"; ac.style.marginBottom = "8px";
        searchHost.replaceChildren(ac);
        ac.addEventListener("gmp-select", async (ev) => {
          try {
            const pl = ev.placePrediction.toPlace();
            await pl.fetchFields({ fields: ["location", "displayName", "formattedAddress", "id"] });
            if (pl.location) { setPin(pl.location.lat(), pl.location.lng(), true); onPin(pl.location.lat(), pl.location.lng(), pl.id); setStatus(`Pinned at ${pl.displayName ?? pl.formattedAddress ?? "the selected place"}. Drag the pin to the exact centre if needed.`); }
          } catch (e) { setStatus(`Could not read that place: ${e instanceof Error ? e.message : "unknown error"}`); }
        });
      }
    } catch { /* Places not enabled on this key: the Search button still geocodes. */ }
  })();
  return {
    setPin,
    setRadius: (r: number) => circle.setRadius(r),
    clear: () => { marker.setMap(null); circle.setMap(null); },
    destroy: () => { marker.setMap(null); circle.setMap(null); el.replaceChildren(); },
  };
}

// ---------------- Leaflet / OpenStreetMap ----------------

function mountLeaflet(L: typeof import("leaflet"), el: HTMLElement, pin: { lat: number; lng: number } | null, radiusM: number, onPin: (lat: number, lng: number) => void) {
  const map: LeafletMap = L.map(el, { scrollWheelZoom: true }).setView([pin?.lat ?? DEFAULT_CENTRE.lat, pin?.lng ?? DEFAULT_CENTRE.lng], pin ? 16 : 12);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
  const icon = L.divIcon({ className: "", html: '<div style="width:18px;height:18px;border-radius:50%;background:#1B5E20;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
  let marker: LeafletMarker | null = null;
  let circle: LeafletCircle | null = null;
  const ensure = (lat: number, lng: number) => {
    if (!marker) {
      marker = L.marker([lat, lng], { draggable: true, icon }).addTo(map);
      marker.on("dragend", () => { const p = marker!.getLatLng(); circle?.setLatLng(p); onPin(p.lat, p.lng); });
    } else marker.setLatLng([lat, lng]);
    if (!circle) circle = L.circle([lat, lng], { radius: radiusM, color: "#2E7D32", weight: 2, fillColor: "#2E7D32", fillOpacity: 0.08 }).addTo(map);
    else circle.setLatLng([lat, lng]);
  };
  if (pin) ensure(pin.lat, pin.lng);
  map.on("click", (e) => { ensure(e.latlng.lat, e.latlng.lng); onPin(e.latlng.lat, e.latlng.lng); });
  return {
    setPin: (lat: number, lng: number, zoom?: boolean) => { ensure(lat, lng); if (zoom) map.setView([lat, lng], Math.max(map.getZoom(), 16)); },
    setRadius: (r: number) => { radiusM = r; circle?.setRadius(r); },
    clear: () => { marker?.remove(); circle?.remove(); marker = null; circle = null; },
    // Stop any running pan/zoom animation and detach layers first: a late animation frame on a
    // removed map throws inside Leaflet ("layerPointToLatLng of undefined").
    destroy: () => { try { map.stop(); map.off(); marker?.remove(); circle?.remove(); map.remove(); } catch { /* already gone */ } },
  };
}
