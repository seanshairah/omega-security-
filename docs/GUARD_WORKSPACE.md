# Guard operations workspace

Date: 2026-10-19. The guard detail page (`/guards/<id>`) is now a viewport-aware operations workspace instead of a long scrolling profile.

## Before → after

| | Before | After |
|---|---|---|
| Identity | page header; scrolled away with the metrics strip | sticky identity bar: name, status, guard number, phone, device, connection with heartbeat age, shift and site, battery, open alerts, actions |
| Map | only inside the Location tab, below a 7-metric strip and the tab card | centre panel, always visible on desktop; site, fence, last verified fix with accuracy circle, an older requested fix when it differs, the recent path on request, legend, street/satellite switch, recenter, copy, "Request fix", "Set site centre" |
| Status feed | per-tab tables (calls, messages, location events) loaded on every request | right panel "Live operations": one merged timeline (alerts, geofence, GPS, GPS requests, shift check-ins, SMS, calls, device online/offline) with category chips, severity and period filters, newest first, 50 per page, "Load older events"; scrolls inside its own panel |
| Location state | "Location unavailable" (monitoring) next to a valid requested fix | four separate concepts in the profile panel: **Device connection**, **Automatic monitoring**, **Last verified position** (with its source: automatic monitoring or requested GPS fix), **Geofence assessment** (inside · outside · uncertain · not assessed · stale) |
| Detail tables | a tab card that grows the page | bottom detail region (31 % of the workspace on desktop, collapsible) with the same tabs: Shifts & attendance, Incidents, SMS, Calls, Communication, Location events, Audit; the active tab's rows only |
| Refresh | none (or whole-page `AutoRefresh`) | the header/location block/map read `/api/guards/<id>/status` every 15 s; the feed reads `/api/guards/<id>/activity?since=` every 30 s; the page itself never reloads |
| Device selection | two queries (page vs panel) | one rule, `eligibleDeviceForGuard`: GUARD mode, activated, not disabled or revoked, most recently seen |

## Scrolling hierarchy (desktop, ≥ 1280 px)

```
Workspace  = calc(100dvh − 6.75rem)        no page scroll
 ├ identity bar (auto)
 ├ grid [240 | 1fr | 300] (1fr, min-h-0)
 │   ├ Guard profile   scrolls
 │   ├ Live map        fills, ResizeObserver → invalidateSize
 │   └ Live operations scrolls (sticky filter row)
 └ detail region (31 %, min 190 px) tabs fixed, table scrolls
```
Laptop 1280×720 and desktop 1440×900 are verified by `npm run test:layout` (no page overflow, all regions visible, feed scroll leaves identity and map in place). Below 1280 px the columns stack: map (≥ 400 px), feed (max 70 vh, own scroll), profile, detail tables; the page scrolls normally. Phone 390 px: no horizontal overflow, full-width map, request controls present.

## Location-state model

`src/lib/guard-status.ts` (`presentGuardLocation`, unit-tested):

- **Connection** from the heartbeat age against `gateway.offlineMinutes`, never from the stored status alone; REVOKED/DISABLED/NONE are explicit.
- **Monitoring** from the phone's reported shift and GPS state; off outside shifts; reasons spelled out (poor accuracy, no fix, location off, permission, site without coordinates).
- **Position**: the newer of the monitor's last fix and the last COMPLETED request; source labelled; freshness LIVE ≤ 15 min, RECENT ≤ 60 min, else STALE.
- **Geofence**: `classifyFix` (unchanged, accuracy-aware) against the assigned site; stale positions are marked stale rather than judged; mock fixes are never trusted; no site coordinates → not assessed.

## Reusable patterns introduced

`src/components/workspace/panel.tsx`: `Workspace`, `Panel` (header + optional scrolling body, tone border), `Fact`, `MetricStrip`, `EmptyState`, `Skeleton`. `src/components/guards/guard-map.tsx`: a persistent, resize-aware Leaflet map that replaces markers without re-creating the map.

## Performance

Before: 7 queries for every tab plus 60 calls, 40 shifts, 30 messages and 20 audit rows on every request. After: the snapshot (6 small indexed reads), the first feed page, and the active tab's rows. Polling is two small JSON reads; the feed asks only for rows newer than the newest it holds.


## Renderer (added 2026-10-19)

The map is Mapbox GL JS when `NEXT_PUBLIC_MAPBOX_TOKEN` is set, and the previous Leaflet raster map
otherwise; both read the same model in `src/lib/map/features.ts`, so the two renderers cannot drift
apart on what a stale fix or an accuracy ring looks like. See [MAPBOX.md](MAPBOX.md).

The map instance is created once per mount. The 15-second status poll and the 30-second feed poll
push new coordinates into its GeoJSON sources, so **the operator's pan and zoom survive every
refresh** and no tiles are re-fetched. `scripts/dev/map-e2e.mjs` asserts this by counting map
canvases across a refresh and by checking that the application's own layers exist in the style.

Two controls were added to the map panel:

| Control | Behaviour |
|---|---|
| **Street / Satellite** | Switches the Mapbox style in place. Hidden on the raster fallback. The application layers are re-added when the new style loads |
| **Path** | Draws the last 25 recorded positions as a dashed line behind the current fix. Mock fixes are excluded, because they are not evidence of where anyone walked. Shown only when there is more than one position to join |

Icons throughout the workspace are Material Symbols from `src/components/ui/icon.tsx`; the status
words are unchanged, because an icon never carries a state on its own. See [ICONS.md](ICONS.md).

## Guard Monitoring (v1.8)

`/monitoring` uses the same workspace for one guard at a time. A list of guards sits beside it: those
pinned with Watch, then everyone on duty, with open alerts and check-in exceptions first. Each entry
shows the site, the hours, the shift state and the start-of-shift check-in. Below 1536 px the list is
a horizontal strip above the workspace, so the map keeps its width on a laptop.

The identity bar shows connection and heartbeat, shift, battery, the check-in status and open alerts.
Under it, one row of actions: **Call guard** (`PORTAL_CALLING.md`), **Notify client**
(`CLIENT_NOTIFICATIONS.md`), **Record incident**, **View shift**, **Escalate** and **Watch / Stop
watching**. **Request location** stays on the map. Escalate needs a reason. It sends a critical alert
to every portal user's devices and writes it on the shift timeline and in the audit log. It does not
contact the client.

The activity feed also carries start-of-shift attendance, calls requested from the portal,
incidents and client messages, each with its own filter. The guard page and Monitoring load the
workspace through `lib/services/guard-workspace-data.ts`. On both pages the actions have a row of
their own, because inline they squeezed the guard's name.
