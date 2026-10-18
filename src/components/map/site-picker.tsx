"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Map as LeafletMap, Marker as LeafletMarker, Circle as LeafletCircle, CircleMarker as LeafletCircleMarker } from "leaflet";
import { RADIUS_CHOICES } from "@/lib/geofence";
import { Field, Input, Select, Checkbox } from "@/components/ui/form";
import { Status } from "@/components/ui/status";
import { accuracyVerdict, distanceM, fixFreshness, geolocationAvailability, geolocationErrorState, isValidLatLng, keepWatching, SOURCE_LABEL, deviceFixIsFresh, type PositionSource } from "@/lib/geo-position";
import { REQUEST_STATUS_META, FAILURE_META, isOpen } from "@/lib/location-request-state";
import { useLocationRequest } from "@/components/location/use-location-request";
import { tileLayerConfig, tileProviderName } from "./tiles";

/**
 * Duty-site geofence picker for the admin portal (never shipped in the APK).
 *
 * Three ways to get a position, kept strictly apart:
 *  1. The map: search, click, drag (source MAP / MANUAL). Tiles (MapTiler or OpenStreetMap, or
 *     Google Maps with a key) are pictures; the map centre is never used as a position.
 *  2. "Use my current location": the Geolocation API of the browser running the portal, i.e. the
 *     admin's own laptop or phone (source BROWSER). It is measured (getCurrentPosition then a short
 *     watchPosition to tighten accuracy), shown as a candidate with its accuracy circle, judged
 *     against the fence radius and only saved after an explicit confirmation.
 *  3. "Use guard phone location": a fresh fix requested from a registered guard phone through the
 *     gateway API (source GUARD_DEVICE). Same candidate → confirm flow.
 *
 * The form fields below the map are the source of truth: latitude, longitude, radius and the
 * coordinates' provenance are ordinary inputs the server action validates.
 */
export type PickerNames = { lat: string; lng: string; radius: string; source?: string; placeId?: string };
export type PickerValue = { lat: number | null; lng: number | null; radiusM: number; source?: PositionSource | null; placeId?: string | null };
export type PickerGuardDevice = { id: string; guardId: string; guardName: string; deviceName: string; status: string; lastSeenAt: string | null };
/** A guard-phone fix handed in by the page (e.g. "Use as site coordinates" from the guard panel); shown as a candidate, never saved silently. */
export type PickerCandidate = { lat: number; lng: number; accuracyM: number | null; capturedAt: string; source: "GUARD_DEVICE"; label: string; requestId: string };

const DEFAULT_CENTRE = { lat: -17.8292, lng: 31.0522 }; // Harare
const LIMITS = { radiusMin: 20, radiusMax: 5000 };
const WATCH_BUDGET_MS = 30_000;

type Engine = "google" | "leaflet";
type LocState = "idle" | "insecure_context" | "unsupported" | "requesting_permission" | "locating" | "acquired" | "accuracy_insufficient" | "permission_denied" | "timed_out" | "unavailable";
type Candidate = { lat: number; lng: number; accuracyM: number | null; timestamp: number; source: PositionSource; label: string; fresh: boolean; mock?: boolean; requestId?: string };

const LOC_STATE_LABEL: Record<LocState, { label: string; tone: "ok" | "warn" | "critical" | "neutral" | "info" | "muted" }> = {
  idle: { label: "Not requested", tone: "muted" }, insecure_context: { label: "Blocked: not a secure page", tone: "critical" }, unsupported: { label: "No geolocation in this browser", tone: "critical" },
  requesting_permission: { label: "Asking for permission…", tone: "info" }, locating: { label: "Locating…", tone: "info" }, acquired: { label: "Position acquired", tone: "ok" }, accuracy_insufficient: { label: "Acquired, accuracy too loose", tone: "warn" },
  permission_denied: { label: "Permission denied", tone: "critical" }, timed_out: { label: "Timed out", tone: "warn" }, unavailable: { label: "Position unavailable", tone: "warn" },
};

type EngineHandle = { setPin: (lat: number, lng: number, zoom?: boolean) => void; setRadius: (r: number) => void; clear: () => void; setCandidate: (lat: number, lng: number, accuracyM: number | null) => void; clearCandidate: () => void; destroy: () => void };

export function SitePicker({ names, initial, mapsKey, height = 340, showSource = true, radiusRequired = true, siteFallbackRadius, guardDevices, locationId, candidate: handedCandidate }: { names: PickerNames; initial: PickerValue; mapsKey?: string; height?: number; showSource?: boolean; radiusRequired?: boolean; siteFallbackRadius?: number; guardDevices?: PickerGuardDevice[]; locationId?: string | null; candidate?: PickerCandidate | null }) {
  const engine: Engine = mapsKey ? "google" : "leaflet";
  const [lat, setLat] = useState<string>(initial.lat != null ? String(initial.lat) : "");
  const [lng, setLng] = useState<string>(initial.lng != null ? String(initial.lng) : "");
  const [radius, setRadius] = useState<string>(String(initial.radiusM || 150));
  const [source, setSource] = useState<string>(initial.source ?? (initial.lat != null ? "MANUAL" : ""));
  const [placeId, setPlaceId] = useState<string>(initial.placeId ?? "");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>(handedCandidate ? `${handedCandidate.label}: confirm below to use it as the site centre.` : "");
  const [results, setResults] = useState<{ label: string; lat: number; lng: number; placeId?: string }[]>([]);
  const mapEl = useRef<HTMLDivElement>(null);
  const searchEl = useRef<HTMLDivElement>(null);
  const engineRef = useRef<EngineHandle | null>(null);

  // ---- browser geolocation state machine ----
  const [locState, setLocState] = useState<LocState>("idle");
  const [locMessage, setLocMessage] = useState<string>("");
  // A fix handed in by the page (from the guard panel) is the initial candidate, rendered on the server too so the confirmation is visible at once.
  const [candidate, setCandidate] = useState<Candidate | null>(() => handedCandidate ? { lat: handedCandidate.lat, lng: handedCandidate.lng, accuracyM: handedCandidate.accuracyM, timestamp: new Date(handedCandidate.capturedAt).getTime(), source: "GUARD_DEVICE", label: handedCandidate.label, fresh: deviceFixIsFresh(handedCandidate.capturedAt), requestId: handedCandidate.requestId } : null);
  const [acceptPoor, setAcceptPoor] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const watchId = useRef<number | null>(null);
  const watchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bestRef = useRef<GeolocationPosition | null>(null);

  const latN = Number(lat), lngN = Number(lng), radiusN = Number(radius);
  const hasPin = lat !== "" && lng !== "" && Number.isFinite(latN) && Number.isFinite(lngN);
  const radiusOk = Number.isInteger(radiusN) && radiusN >= LIMITS.radiusMin && radiusN <= LIMITS.radiusMax;
  const fenceR = radiusOk ? radiusN : (siteFallbackRadius ?? 150);

  const place = useCallback((la: number, ln: number, how: PositionSource, pid?: string) => {
    setLat(la.toFixed(6)); setLng(ln.toFixed(6));
    setSource((s) => (s === "TEST" ? "TEST" : how));
    if (pid !== undefined) setPlaceId(pid);
    engineRef.current?.setPin(la, ln, how !== "MANUAL");
  }, []);

  const stopWatch = useCallback(() => {
    if (watchId.current != null && typeof navigator !== "undefined" && navigator.geolocation) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    if (watchTimer.current) { clearTimeout(watchTimer.current); watchTimer.current = null; }
  }, []);

  // Secure-context check on mount; cleanup stops any watch on unmount.
  useEffect(() => {
    const avail = geolocationAvailability({ secureContext: window.isSecureContext, hasGeolocation: "geolocation" in navigator, origin: window.location.origin });
    if (!avail.ok) { setLocState(avail.reason === "unsupported" ? "unsupported" : "insecure_context"); setLocMessage(avail.message ?? ""); }
    return () => stopWatch();
  }, [stopWatch]);

  // Keep the candidate drawn once the engine exists.
  useEffect(() => { if (candidate) engineRef.current?.setCandidate(candidate.lat, candidate.lng, candidate.accuracyM); else engineRef.current?.clearCandidate(); }, [candidate]);

  // ---- map engines ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!mapEl.current) return;
      const leaflet = async () => {
        const L = (await import("leaflet")).default;
        if (cancelled || !mapEl.current || engineRef.current) return;
        engineRef.current = mountLeaflet(L, mapEl.current, hasPin ? { lat: latN, lng: lngN } : null, radiusOk ? radiusN : 150, (la, ln) => place(la, ln, "MAP", ""));
        if (candidate) engineRef.current.setCandidate(candidate.lat, candidate.lng, candidate.accuracyM);
      };
      if (engine === "google") {
        try {
          await loadGoogleMaps(mapsKey!);
          const maps = (await google.maps.importLibrary("maps")) as google.maps.MapsLibrary;
          if (cancelled || !mapEl.current || engineRef.current) return;
          engineRef.current = mountGoogle(maps, mapEl.current, searchEl.current, hasPin ? { lat: latN, lng: lngN } : null, radiusOk ? radiusN : 150, (la, ln, pid) => place(la, ln, "MAP", pid), setStatus);
          if (candidate) engineRef.current.setCandidate(candidate.lat, candidate.lng, candidate.accuracyM);
        } catch (e) {
          setStatus(`Google Maps could not load (${e instanceof Error ? e.message : "unknown error"}). Showing ${tileProviderName()} instead.`);
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
    if (v !== "" && other !== "" && isValidLatLng({ latitude: la, longitude: ln })) { setSource((s) => (s === "TEST" ? "TEST" : "MANUAL")); setPlaceId(""); engineRef.current?.setPin(la, ln, false); }
  };

  const clear = () => { setLat(""); setLng(""); setSource(""); setPlaceId(""); setResults([]); engineRef.current?.clear(); };

  // ---- "Use my current location" (the portal browser's own device) ----
  const applyBrowserFix = useCallback((p: GeolocationPosition) => {
    const acc = Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : null;
    const fr = fixFreshness(p.timestamp);
    const verdict = accuracyVerdict(acc, fenceR);
    setCandidate({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: acc, timestamp: p.timestamp, source: "BROWSER", label: "This device's browser", fresh: fr.fresh });
    setLocState(verdict.level === "poor" ? "accuracy_insufficient" : "acquired");
    setLocMessage(`${verdict.label}. ${verdict.detail}${fr.fresh ? "" : ` The reading is ${fr.label}.`}`);
  }, [fenceR]);

  const locateMe = useCallback((opts: { highAccuracy: boolean } = { highAccuracy: true }) => {
    const avail = geolocationAvailability({ secureContext: window.isSecureContext, hasGeolocation: "geolocation" in navigator, origin: window.location.origin });
    if (!avail.ok) { setLocState(avail.reason === "unsupported" ? "unsupported" : "insecure_context"); setLocMessage(avail.message ?? ""); return; }
    stopWatch();
    bestRef.current = null;
    setAcceptPoor(false);
    setAttempts((n) => n + 1);
    setLocState("requesting_permission");
    setLocMessage(opts.highAccuracy ? "Waiting for the browser's permission prompt, then for the device's GPS/Wi-Fi position. Nothing is saved until you confirm." : "Retrying with network location (less precise) because the high-accuracy attempt timed out.");
    const started = Date.now();
    navigator.geolocation.getCurrentPosition(
      (p) => {
        bestRef.current = p;
        applyBrowserFix(p);
        // Tighten the fix for a short while: a first GPS reading is often coarse. Stops when good enough, when the budget is spent, on confirm/cancel, or on unmount.
        if (!keepWatching(p.coords.accuracy, Date.now() - started, fenceR, WATCH_BUDGET_MS)) return;
        setLocState("locating"); setLocMessage(`First reading ±${Math.round(p.coords.accuracy)} m. Improving the fix for up to ${Math.round(WATCH_BUDGET_MS / 1000)} s…`);
        watchId.current = navigator.geolocation.watchPosition((q) => {
          const best = bestRef.current;
          if (!best || q.coords.accuracy < best.coords.accuracy) { bestRef.current = q; }
          if (!keepWatching(bestRef.current!.coords.accuracy, Date.now() - started, fenceR, WATCH_BUDGET_MS)) { stopWatch(); applyBrowserFix(bestRef.current!); }
          else setLocMessage(`Best so far ±${Math.round(bestRef.current!.coords.accuracy)} m · ${Math.round((Date.now() - started) / 1000)} s…`);
        }, () => { /* a watch error after a successful first fix keeps the first fix */ }, { enableHighAccuracy: true, maximumAge: 0, timeout: WATCH_BUDGET_MS });
        watchTimer.current = setTimeout(() => { stopWatch(); if (bestRef.current) applyBrowserFix(bestRef.current); }, WATCH_BUDGET_MS + 500);
      },
      (e) => {
        const s = geolocationErrorState(e.code);
        if (s.state === "timed_out" && opts.highAccuracy) { locateMe({ highAccuracy: false }); return; }
        setLocState(s.state); setLocMessage(s.message);
      },
      { enableHighAccuracy: opts.highAccuracy, timeout: opts.highAccuracy ? 20_000 : 15_000, maximumAge: 0 },
    );
  }, [applyBrowserFix, fenceR, stopWatch]);

  const cancelCandidate = () => { stopWatch(); setCandidate(null); setAcceptPoor(false); if (locState !== "insecure_context" && locState !== "unsupported") { setLocState("idle"); setLocMessage(""); } };

  const confirmCandidate = () => {
    if (!candidate) return;
    if (candidate.mock) { setStatus("A mock (fake) location provider was reported for this fix. It cannot be used as a site centre."); return; }
    stopWatch();
    place(candidate.lat, candidate.lng, candidate.source, "");
    const moved = hasPin ? Math.round(distanceM({ latitude: latN, longitude: lngN }, { latitude: candidate.lat, longitude: candidate.lng })) : null;
    setStatus(`Site centre set from ${SOURCE_LABEL[candidate.source].toLowerCase()}${candidate.accuracyM != null ? ` (±${Math.round(candidate.accuracyM)} m)` : ""}${moved != null && moved > 0 ? `, ${moved} m from the previous centre` : ""}. Check the pin against the map, then save the form.`);
    setCandidate(null); setAcceptPoor(false);
    if (locState === "acquired" || locState === "accuracy_insufficient") { setLocState("idle"); setLocMessage(""); }
  };

  // ---- "Use guard phone location" ----
  const devices = guardDevices ?? [];
  const [deviceId, setDeviceId] = useState<string>(devices[0]?.id ?? "");
  const dev = devices.find((d) => d.id === deviceId) ?? null;
  const req = useLocationRequest(dev?.guardId ?? null);
  useEffect(() => {
    const r = req.request;
    if (!r || r.status !== "COMPLETED" || r.latitude == null || r.longitude == null || !r.capturedAt) return;
    const fresh = deviceFixIsFresh(r.capturedAt);
    setCandidate({ lat: r.latitude, lng: r.longitude, accuracyM: r.accuracyM, timestamp: new Date(r.capturedAt).getTime(), source: "GUARD_DEVICE", label: `${dev?.guardName ?? "guard"}'s phone (${dev?.deviceName ?? "device"})`, fresh, mock: r.mock, requestId: r.id });
    setAcceptPoor(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req.request?.status, req.request?.id]);

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
  const candVerdict = candidate ? accuracyVerdict(candidate.accuracyM, fenceR) : null;
  const candMoved = candidate && hasPin ? Math.round(distanceM({ latitude: latN, longitude: lngN }, { latitude: candidate.lat, longitude: candidate.lng })) : null;
  const confirmBlocked = !!candidate && (candidate.mock || (candVerdict?.level === "poor" && !acceptPoor));
  const geoBlocked = locState === "insecure_context" || locState === "unsupported";
  const locBusy = locState === "requesting_permission" || locState === "locating";
  const btn = "h-10 whitespace-nowrap rounded-[8px] border border-line bg-surface px-3 text-[13px] font-medium hover:bg-surface-2 disabled:opacity-50";

  return (
    <div className="sm:col-span-2 space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="mb-1 block text-[12px] font-medium text-ink-2">Search for the site</label>
          {engine === "google" ? <div ref={searchEl} className="[&>gmp-place-autocomplete]:w-full" /> : null}
          <div className="flex gap-2">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); search(); } }} placeholder={engine === "google" ? "Street, suburb or landmark (or use the suggestions above)" : "Street, suburb or landmark in Zimbabwe"} />
            <button type="button" onClick={search} className={btn}>Search</button>
          </div>
        </div>
        <button type="button" onClick={() => locateMe()} disabled={geoBlocked || locBusy} title={geoBlocked ? locMessage : "Measure the position of the device running this portal (your laptop or phone)"} className={`${btn} border-accent/60 bg-accent/10 text-accent-strong hover:bg-accent/15`}>{locBusy ? "Locating…" : "Use my current location"}</button>
        <button type="button" onClick={clear} className={`${btn} text-ink-2`}>Clear pin</button>
      </div>
      {results.length > 0 && (
        <ul className="divide-y divide-line rounded-[8px] border border-line bg-surface text-[13px]">
          {results.map((r, i) => <li key={i}><button type="button" className="w-full px-3 py-2 text-left hover:bg-surface-2" onClick={() => { place(r.lat, r.lng, "MAP", r.placeId ?? ""); setResults([]); setQuery(r.label); engineRef.current?.setPin(r.lat, r.lng, true); }}>{r.label}</button></li>)}
        </ul>
      )}
      {engine === "leaflet" && <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />}
      <div ref={mapEl} style={{ height }} className="w-full overflow-hidden rounded-[12px] border border-line bg-surface-2" />
      <p className="text-[12px] text-ink-3">{status || (engine === "google" ? "Click the map or drag the pin to the exact centre of the site. The green circle is the geofence." : `${tileProviderName()} tiles${mapsKey ? "" : " (no Google Maps key configured)"}. Click the map or drag the pin to the exact centre of the site. The green circle is the geofence; a dashed purple circle is a measured position's accuracy, waiting for your confirmation.`)}</p>

      {/* Browser-location status: always visible so the admin knows which device is being located and why it may be blocked. */}
      <div className="rounded-[8px] border border-line bg-surface px-3 py-2 text-[12.5px]" data-testid="browser-location">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-ink">Your device&apos;s location</span>
          <Status tone={LOC_STATE_LABEL[locState].tone} pulse={locBusy}>{LOC_STATE_LABEL[locState].label}</Status>
          <span className="text-ink-3">This is the position of the computer or phone running the portal, not of any guard.</span>
          {(locState === "timed_out" || locState === "unavailable" || locState === "accuracy_insufficient" || locState === "acquired") && <button type="button" onClick={() => locateMe()} className="ml-auto h-8 rounded-[6px] border border-line bg-surface px-2.5 text-[12px] font-medium hover:bg-surface-2">Retry for better accuracy</button>}
          {locState === "permission_denied" && <button type="button" onClick={() => locateMe()} className="ml-auto h-8 rounded-[6px] border border-line bg-surface px-2.5 text-[12px] font-medium hover:bg-surface-2">Try again</button>}
        </div>
        {locMessage && <p className={`mt-1 ${geoBlocked || locState === "permission_denied" ? "text-critical" : "text-ink-2"}`} data-testid="browser-location-message">{locMessage}</p>}
        {attempts > 1 && locBusy && <p className="mt-1 text-ink-3">Attempt {attempts}.</p>}
      </div>

      {/* Guard phone location (admin portal only; the phone measures, the admin confirms). */}
      {devices.length > 0 && (
        <div className="rounded-[8px] border border-line bg-surface px-3 py-2 text-[12.5px]" data-testid="guard-device-location">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="mb-1 block text-[12px] font-medium text-ink-2">Use a guard phone standing at the site</label>
              <Select value={deviceId} onChange={(e) => { setDeviceId(e.target.value); req.reset(); }} disabled={!!req.request && isOpen(req.request.status)}>
                {devices.map((d) => <option key={d.id} value={d.id}>{d.guardName} · {d.deviceName} · {d.status.toLowerCase()}{d.lastSeenAt ? "" : " · never seen"}</option>)}
              </Select>
            </div>
            {req.request && isOpen(req.request.status)
              ? <button type="button" onClick={() => req.cancel()} disabled={req.busy} className={btn}>Cancel request</button>
              : <button type="button" onClick={() => { setCandidate(null); req.start({ purpose: "SITE_SETUP", locationId: locationId ?? null }); }} disabled={!dev || req.busy} className={`${btn} border-accent/60 bg-accent/10 text-accent-strong hover:bg-accent/15`}>{req.request && !isOpen(req.request.status) ? "Request again" : "Request guard phone position"}</button>}
          </div>
          <p className="mt-1 text-ink-3">The guard phone measures a fresh GPS fix and sends it back; it is shown here for confirmation only. The guard sees the request in the app. Nothing is tracked outside this request.</p>
          {req.error && <p className="mt-1 text-critical">{req.error}</p>}
          {req.request && (
            <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="guard-request-status">
              <Status tone={REQUEST_STATUS_META[req.request.status].tone} pulse={isOpen(req.request.status)}>{REQUEST_STATUS_META[req.request.status].label}</Status>
              <span className="text-ink-2">{req.request.status === "FAILED" && req.request.failureReason ? FAILURE_META[req.request.failureReason] : REQUEST_STATUS_META[req.request.status].detail}{isOpen(req.request.status) ? ` ${req.request.secondsLeft} s left.` : ""}</span>
              {dev?.status !== "ONLINE" && isOpen(req.request.status) && <span className="text-warn">The phone is not online right now; the request waits for it or expires.</span>}
            </div>
          )}
        </div>
      )}

      {/* Candidate: a measured position awaiting confirmation. */}
      {candidate && (
        <div className="rounded-[10px] border-2 border-[#7B3FA0]/50 bg-[#7B3FA0]/5 px-3 py-3 text-[13px]" data-testid="candidate">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-ink">Measured position, not yet saved</span>
            <Status tone="info">Source: {candidate.label}</Status>
            {candVerdict && <Status tone={candVerdict.level === "good" ? "ok" : candVerdict.level === "usable" ? "warn" : candVerdict.level === "poor" ? "critical" : "muted"}>{candVerdict.label}</Status>}
            <Status tone={candidate.fresh ? "ok" : "warn"}>{candidate.fresh ? "fresh" : "stale"}</Status>
            {candidate.mock && <Status tone="critical">Mock location reported</Status>}
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 tnum sm:grid-cols-4">
            <div><dt className="text-[11px] uppercase tracking-wide text-ink-3">Latitude</dt><dd>{candidate.lat.toFixed(6)}</dd></div>
            <div><dt className="text-[11px] uppercase tracking-wide text-ink-3">Longitude</dt><dd>{candidate.lng.toFixed(6)}</dd></div>
            <div><dt className="text-[11px] uppercase tracking-wide text-ink-3">Accuracy</dt><dd>{candidate.accuracyM != null ? `±${Math.round(candidate.accuracyM)} m` : "unknown"}</dd></div>
            <div><dt className="text-[11px] uppercase tracking-wide text-ink-3">Measured at</dt><dd suppressHydrationWarning>{new Date(candidate.timestamp).toLocaleTimeString("en-GB", { timeZone: "Africa/Harare" })} · {fixFreshness(candidate.timestamp).label}</dd></div>
          </dl>
          <p className="mt-2 text-ink-2">{candVerdict?.detail}{candMoved != null ? ` This would move the site centre ${candMoved} m from its current position.` : " The site has no coordinates yet."} The fence radius is {fenceR} m.</p>
          {candVerdict?.level === "poor" && !candidate.mock && <label className="mt-2 flex items-start gap-2 text-ink"><input type="checkbox" checked={acceptPoor} onChange={(e) => setAcceptPoor(e.target.checked)} className="mt-0.5" /><span>I understand the uncertainty (±{Math.round(candidate.accuracyM ?? 0)} m) is too large for a {fenceR} m fence and I will check the pin against the map before saving.</span></label>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={confirmCandidate} disabled={confirmBlocked} className="h-10 rounded-[8px] bg-accent px-4 text-[13px] font-semibold text-white hover:bg-accent-strong disabled:opacity-50" data-testid="confirm-candidate">{hasPin ? "Replace site centre with this position" : "Use this position as the site centre"}</button>
            <button type="button" onClick={cancelCandidate} className={btn}>Discard</button>
            {candidate.source === "BROWSER" && <button type="button" onClick={() => locateMe()} className={btn}>Retry for better accuracy</button>}
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Latitude" hint="−90 to 90"><Input name={names.lat} type="number" step="any" min={-90} max={90} value={lat} onChange={(e) => onTyped("lat", e.target.value)} placeholder="-17.8292" /></Field>
        <Field label="Longitude" hint="−180 to 180"><Input name={names.lng} type="number" step="any" min={-180} max={180} value={lng} onChange={(e) => onTyped("lng", e.target.value)} placeholder="31.0522" /></Field>
        <Field label="Geofence radius (m)" hint={radiusRequired ? "50 shop · 150 warehouse · 500 mine. 20–5000." : `Blank keeps the site's ${siteFallbackRadius ?? 150} m.`}>
          <Input name={names.radius} type="number" min={LIMITS.radiusMin} max={LIMITS.radiusMax} step={10} value={radius} onChange={(e) => setRadius(e.target.value)} list={`${names.radius}-choices`} />
          <datalist id={`${names.radius}-choices`}>{RADIUS_CHOICES.map((r) => <option key={r} value={r} />)}</datalist>
        </Field>
        {showSource && names.source && (
          <Field label="Coordinates are" hint="Set automatically by the map, your device or a guard phone. TEST marks temporary values that must not be trusted for verification." className="sm:col-span-2">
            <Select name={names.source} value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">— none —</option>
              <option value="MAP">Placed on the map (verified)</option>
              <option value="MANUAL">Typed or pasted by hand</option>
              <option value="BROWSER">Measured by this device&apos;s browser (admin&apos;s laptop/phone)</option>
              <option value="GUARD_DEVICE">Measured by a guard phone at the site (GPS)</option>
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
        {source === "BROWSER" && <div className="mt-1"><Status tone="warn">Measured by the admin&apos;s own device, not by a guard phone</Status></div>}
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

const CAND = "#7B3FA0";

function mountGoogle({ Map }: google.maps.MapsLibrary, el: HTMLElement, searchHost: HTMLElement | null, pin: { lat: number; lng: number } | null, radiusM: number, onPin: (lat: number, lng: number, placeId?: string) => void, setStatus: (s: string) => void): EngineHandle {
  const map = new Map(el, { center: pin ?? DEFAULT_CENTRE, zoom: pin ? 16 : 12, mapTypeControl: true, streetViewControl: false, fullscreenControl: true, gestureHandling: "greedy" });
  const marker = new google.maps.Marker({ map, position: pin ?? undefined, draggable: true, title: "Site centre (drag me)" });
  const circle = new google.maps.Circle({ map: pin ? map : null, center: pin ?? DEFAULT_CENTRE, radius: radiusM, strokeColor: "#2E7D32", strokeWeight: 2, fillColor: "#2E7D32", fillOpacity: 0.08, clickable: false });
  const candMarker = new google.maps.Marker({ map: null, title: "Measured position (not saved)", icon: { path: google.maps.SymbolPath.CIRCLE, scale: 7, fillColor: CAND, fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2 } });
  const candCircle = new google.maps.Circle({ map: null, radius: 0, strokeColor: CAND, strokeWeight: 1, fillColor: CAND, fillOpacity: 0.1, clickable: false });
  const setPin = (lat: number, lng: number, zoom?: boolean) => { const p = { lat, lng }; marker.setPosition(p); marker.setMap(map); circle.setCenter(p); circle.setMap(map); if (zoom) { map.setCenter(p); map.setZoom(Math.max(map.getZoom() ?? 16, 16)); } };
  marker.addListener("dragend", () => { const p = marker.getPosition(); if (p) { circle.setCenter(p); onPin(p.lat(), p.lng(), ""); } });
  map.addListener("click", (e: google.maps.MapMouseEvent) => { if (e.latLng) { setPin(e.latLng.lat(), e.latLng.lng()); onPin(e.latLng.lat(), e.latLng.lng(), ""); } });
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
    setCandidate: (lat, lng, acc) => { const p = { lat, lng }; candMarker.setPosition(p); candMarker.setMap(map); candCircle.setCenter(p); candCircle.setRadius(acc ?? 0); candCircle.setMap(acc ? map : null); map.panTo(p); if ((map.getZoom() ?? 0) < 15) map.setZoom(16); },
    clearCandidate: () => { candMarker.setMap(null); candCircle.setMap(null); },
    destroy: () => { marker.setMap(null); circle.setMap(null); candMarker.setMap(null); candCircle.setMap(null); el.replaceChildren(); },
  };
}

// ---------------- Leaflet (MapTiler or OpenStreetMap tiles) ----------------

function mountLeaflet(L: typeof import("leaflet"), el: HTMLElement, pin: { lat: number; lng: number } | null, radiusM: number, onPin: (lat: number, lng: number) => void): EngineHandle {
  // Leaflet takes [lat, lng]; GeoJSON/MapTiler vector APIs take [lng, lat]. Only Leaflet order appears here.
  const map: LeafletMap = L.map(el, { scrollWheelZoom: true }).setView([pin?.lat ?? DEFAULT_CENTRE.lat, pin?.lng ?? DEFAULT_CENTRE.lng], pin ? 16 : 12);
  const tiles = tileLayerConfig();
  L.tileLayer(tiles.url, { maxZoom: tiles.maxZoom, attribution: tiles.attribution }).addTo(map);
  const icon = L.divIcon({ className: "", html: '<div style="width:18px;height:18px;border-radius:50%;background:#1B5E20;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
  let marker: LeafletMarker | null = null;
  let circle: LeafletCircle | null = null;
  let cand: LeafletCircleMarker | null = null;
  let candCircle: LeafletCircle | null = null;
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
    setCandidate: (lat, lng, acc) => {
      if (!cand) cand = L.circleMarker([lat, lng], { radius: 8, color: "#fff", weight: 2, fillColor: CAND, fillOpacity: 1 }).addTo(map).bindTooltip("Measured position (not saved)"); else cand.setLatLng([lat, lng]);
      if (acc && acc > 0) { if (!candCircle) candCircle = L.circle([lat, lng], { radius: acc, color: CAND, weight: 1, dashArray: "4 4", fillColor: CAND, fillOpacity: 0.1 }).addTo(map); else { candCircle.setLatLng([lat, lng]); candCircle.setRadius(acc); } }
      else { candCircle?.remove(); candCircle = null; }
      const target = candCircle ? candCircle.getBounds() : L.latLng(lat, lng).toBounds(200);
      map.fitBounds(marker ? target.extend(marker.getLatLng()) : target, { padding: [30, 30], maxZoom: 18 });
    },
    clearCandidate: () => { cand?.remove(); candCircle?.remove(); cand = null; candCircle = null; },
    destroy: () => { try { map.stop(); map.off(); marker?.remove(); circle?.remove(); cand?.remove(); candCircle?.remove(); map.remove(); } catch { /* already gone */ } },
  };
}
