# Mapbox in the portal

Mapbox GL JS renders every map in the admin portal. It is a **picture layer only**. Guard
positions, geofence state, distance from a site centre and accuracy judgements are computed by
this application (`src/lib/geofence.ts`, `src/lib/geo-position.ts`) from fixes measured by guard
phones. No operational decision depends on a Mapbox API, so an exhausted or suspended Mapbox
account degrades the pictures, never the monitoring.

## Architecture

| File | Role |
|---|---|
| `src/lib/map/provider.ts` | Chooses the renderer and the style. Mapbox when `NEXT_PUBLIC_MAPBOX_TOKEN` is set, otherwise Leaflet. |
| `src/lib/map/features.ts` | Pure model: domain rows in, GeoJSON and colours out. No browser, no network. Unit-tested in `tests/map-features.test.ts`. |
| `src/components/map/mapbox-map.tsx` | The Mapbox GL view. One map instance per mount; data arrives through `setData`. |
| `src/components/map/leaflet-map.tsx` | The raster fallback, reading the same model so both renderers agree. |
| `src/components/map/map-view.tsx` | Picks a renderer, draws the legend and the street/satellite switch, falls back at runtime if WebGL fails. |
| `src/components/map/site-map.tsx`, `live-map.tsx`, `guards/guard-map.tsx` | Thin adapters that keep each page's existing props. |
| `src/components/map/site-picker.tsx` | Duty-site picker. Mapbox engine first, then Google Maps if a Google key is set, then Leaflet. |

### The map is never re-created

The guard workspace polls status every 15 seconds and the activity feed every 30 seconds. The map
component is created once and keeps its own instance for the life of the mount; each refresh calls
`setData` on the GeoJSON sources. An operator's pan and zoom survive every refresh, and no tiles
are re-downloaded. `scripts/dev/map-e2e.mjs` asserts this by counting canvases across a refresh.

### Layers

`omega-fence-fill`, `omega-fence-line`, `omega-trail`, `omega-accuracy-fill`, `omega-accuracy-line`,
`omega-site-dot`, `omega-site-label`, `omega-alert-ring`, `omega-cluster`, `omega-cluster-count`,
`omega-point`, `omega-point-glyph`, `omega-point-label`. Markers carry Material Symbols glyphs,
rendered to canvas images from the same icon set as the rest of the interface.

Clustering is on for the fleet map (`cluster` prop), where several guards can share one site. It is
off on single-guard maps, where every point matters.

## Configuration

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_MAPBOX_TOKEN` | **Public** token (`pk.…`). Reaches the browser, so restrict it by URL in the Mapbox account to the portal's domains. |
| `NEXT_PUBLIC_MAPBOX_STYLE` | Optional. A custom style URL replacing Mapbox Streets, for company theming. |
| `NEXT_PUBLIC_MAPTILER_KEY` | Unchanged. Only used by the Leaflet fallback. |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Unchanged. Only used by the site picker when no Mapbox token is set. |

Never put a secret (`sk.…`) token in any `NEXT_PUBLIC_*` variable; those are compiled into the
browser bundle. The portal needs no secret token: it uses styles, tiles and forward geocoding only.

### Token restriction checklist

1. Mapbox account → Tokens → the public token → **URL restrictions**: add the production domain and
   any preview domains. An unrestricted public token can be lifted from the bundle and billed to
   this account.
2. Scopes: `styles:read`, `styles:tiles`, `fonts:read`, `datasets:read` are enough. The portal does
   not need `uploads:*`, `tilesets:*` or any write scope.
3. Rotate the token if it ever appears in a screenshot, a support ticket or a public repository.

## Cost, limits and billing alerts

Mapbox bills per **map load** (one `new mapboxgl.Map(...)`) and per geocoding request. Mapbox's free
allowance and prices change, so treat the numbers on <https://www.mapbox.com/pricing> as the source
of truth and read them before launch. What matters for this portal:

- **A map load is a mount, not a refresh.** Because the map instance survives polling, a supervisor
  who leaves the guard workspace open all shift costs one map load, not one every 15 seconds. This
  is the single largest cost control in the implementation.
- Opening a guard, a site, a shift, a device page or the fleet map is one load each. A control room
  with five operators moving between pages is in the low hundreds of loads per day.
- The street/satellite switch calls `setStyle`, which is **not** a new map load.
- Forward geocoding is billed per search in the site picker. It is only called when an administrator
  presses Search while setting up a site, which is a rare, deliberate action.
- Set a **billing alert** in the Mapbox account (Account → Billing) at a figure the business is
  willing to pay, and a hard usage limit if Mapbox offers one for the plan in use. Do this before
  the portal is opened to operators. Without an alert, a misconfigured page or an unrestricted
  token is discovered on the invoice.
- Watch usage weekly for the first month (Mapbox account → Statistics), then monthly.

If the account is suspended or the allowance is spent, maps stop drawing and the portal keeps
working: the renderer falls back to Leaflet raster tiles only when the token is absent, so for an
exhausted token remove `NEXT_PUBLIC_MAPBOX_TOKEN` to return the whole portal to MapTiler or
OpenStreetMap immediately, with no code change.

## Terms and telemetry

- Mapbox GL JS v3 is distributed under the **Mapbox Terms of Service**, not an open-source licence.
  Using it requires a Mapbox account and an access token, and the attribution control must stay
  visible. The portal keeps `attributionControl: true`; do not hide it.
- Mapbox GL JS reports anonymous map-usage telemetry to `events.mapbox.com`. This cannot be
  switched off within Mapbox's terms, and the portal does not attempt to. What is sent is map
  interaction data (map loads, style, viewport, SDK version) tied to the access token. **No guard
  name, guard identifier, device identifier, shift, site name or alert content is sent**, because
  none of that is given to the map renderer: markers carry only coordinates and display strings,
  and the only identifiers in the GeoJSON are internal row ids used for popups.
- Even so, a guard's coordinates are personal data, and viewport telemetry reveals where operators
  are looking. Record Mapbox as a sub-processor in the company's data-protection notes, alongside
  Neon and the SMS provider, and keep `collectResourceTiming: false` (set in `mapbox-map.tsx`) so
  resource timing is not added to it.
- The Leaflet fallback sends tile requests to MapTiler or OpenStreetMap, which also see the viewport
  and so the approximate area of interest. There is no renderer that sees nothing.

## Fallback behaviour

| Situation | Result |
|---|---|
| No `NEXT_PUBLIC_MAPBOX_TOKEN` | Leaflet raster maps everywhere. The footer under each map names the provider. |
| Token set, WebGL unavailable (old machine, blocked GPU) | `MapboxMap` reports failure, `MapView` swaps to Leaflet and the footer reads "(fallback)". |
| Token set, Mapbox returns 401/429 | The map draws nothing and logs `[map]`. Remove the token to fall back deliberately. |
| Token set, site picker fails to start Mapbox | The picker shows the reason and mounts Leaflet, keeping the form and the position state machine intact. |

## Verification

```bash
npm test                       # includes tests/map-features.test.ts (geometry, colours, bounds)
node scripts/dev/map-e2e.mjs   # WebGL, layers, tiles, no-remount-on-refresh, picker, fallback
node scripts/dev/layout-e2e.mjs
```
