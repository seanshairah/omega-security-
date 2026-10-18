# Device location, guard-phone location requests and site setup

Date: 2026-10-19 · Portal on `claude/brave-hopper-92o6rw` · App v1.5.0 (versionCode 6)

This document covers the fix for "Use my current location", the remote **Request current location** feature for guard phones, and how a guard phone's GPS fix becomes a duty site's coordinates.

## 1. Root cause: why the site was 14.7 km from the guard

| Finding | Evidence | Consequence |
|---|---|---|
| There was no MapTiler integration in the repository. Maps were Leaflet on OpenStreetMap tiles, or Google Maps with a key. | `grep -ri maptiler` found nothing before this change. | The "MapTiler GPS" problem description could not be a tile-provider bug; the position pipeline was the issue. |
| "Use my position" in the old picker read `navigator.geolocation.getCurrentPosition` of **the browser running the portal** (the administrator's laptop or phone) and applied it to the site **immediately**, without showing accuracy, without confirmation and with the source recorded as `MAP` ("placed on the map, verified"). | old `site-picker.tsx` `useMyLocation()` | A laptop's Wi-Fi/IP-based estimate (often hundreds of metres to many kilometres off) became a "verified" site centre. The guard phone, standing at the real site, was then 14.7 km from the configured centre. |
| On an insecure LAN origin (`http://172.20.10.3:3000`) the browser refuses geolocation; the old code showed only "Position not available". | browser secure-context rule | Staff retried or typed coordinates by hand; nothing explained that HTTPS or `localhost` is required. |
| Nothing in the system could ask the **guard's** phone for a position; only automatic shift checks existed. | no request table, no command path | The only "device location" available to operations was the admin's own device. |
| EOP-02 and similar sites carry `TEST` coordinates. | `CoordinatesSource.TEST` | Any GPS result at those sites is meaningless until real coordinates are set. |

Coordinate order was checked: the database, browser Geolocation and Leaflet use `{latitude, longitude}` / `[lat, lng]`; GeoJSON/MapTiler/Google LngLat use `[lng, lat]`. The helpers `toLngLat`/`fromLngLat` in `src/lib/geo-position.ts` are the only conversion point and are unit-tested. No swap was found in the existing code; the 14.7 km error was a wrong source, not a swapped axis.

## 2. What changed

### Portal: site picker (`src/components/map/site-picker.tsx`)
- **Use my current location** now runs a state machine: `requesting_permission → locating → acquired | accuracy_insufficient | permission_denied | timed_out | unavailable`, plus `insecure_context` and `unsupported` detected on mount. It uses `getCurrentPosition({ enableHighAccuracy: true, timeout: 20000, maximumAge: 0 })`, then a temporary `watchPosition` for up to 30 s to tighten the fix; the watch is cleared on confirm, discard, retry and unmount. A high-accuracy timeout retries once with network location, labelled as such.
- The result is a **candidate**, drawn on the map as a purple point with a dashed accuracy circle, with latitude, longitude, ±accuracy, measurement time, fresh/stale and the **source** ("This device's browser"). Nothing is written to the form until **Replace site centre with this position / Use this position as the site centre** is clicked. Discard removes it.
- **Accuracy verdict** against the fence radius (`accuracyVerdict`): good ≤ min(25 m, r/5); usable ≤ r/2; otherwise too loose. A too-loose fix cannot be confirmed until the administrator ticks an explicit acknowledgement; "Retry for better accuracy" is always offered.
- The confirmation text states how far the new centre is from the current one. Existing coordinates are never replaced silently.
- Saved provenance is now `BROWSER` (admin's device) or `GUARD_DEVICE` (guard phone), shown with distinct labels everywhere `COORDINATES_SOURCE_META` is used; `BROWSER` carries a warning badge. `coordinatesVerifiedAt` is set for `MAP` and `GUARD_DEVICE` only.
- Secure-context guidance: on `http://<LAN-IP>:3000` the button is disabled and the message names the origin, says to use the HTTPS address or `http://localhost:3000` on the same machine, and that a LAN address will never be allowed. HTTPS is not weakened anywhere.
- **Use a guard phone standing at the site**: pick an activated guard device, request a fix, watch the request state, and confirm the returned position the same way. A mock-flagged fix can never be confirmed.
- Tiles: `src/components/map/tiles.ts` uses MapTiler Streets when `NEXT_PUBLIC_MAPTILER_KEY` is set, OpenStreetMap otherwise; Google Maps still takes over when `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is set. Tiles are pictures; no position is ever taken from the map centre or the IP.

### Portal: shift workflow
- New shift: the site selector (`ShiftSiteSelect`) shows the chosen site's coordinates, radius, config version and provenance, or a warning with a link to configure the site. It never changes the site.

### Remote guard-phone location requests (Feature A–G of the master prompt)
- Table `DeviceLocationRequest` with the state machine `PENDING → DELIVERED → PROCESSING → COMPLETED | FAILED`, and `EXPIRED` / `CANCELLED` from any open state (`src/lib/location-request-state.ts`, unit-tested). Terminal states never change; a replayed or late result is a no-op.
- Command `REQUEST_LOCATION { id, type, requestedAt, expiresAt, maxAccuracyM, requireFreshFix }` is delivered in the heartbeat response and by `GET /api/gateways/commands`, only to the addressed device (Bearer token). First delivery marks `DELIVERED`. The phone acknowledges `PROCESSING` with `POST /api/gateways/commands/{id}/ack` and answers with a `LOCATION_REQUEST_RESULT` **event** through the normal outbox (`POST /api/gateways/events`), so retries, offline queuing and `eventId` replay protection are unchanged. The result is bound to the request only if the device matches, the request is open, `capturedAt` is plausible (not before the request, not after the deadline plus 60 s grace, not in the future beyond clock skew) and accuracy is within `maxAccuracyM`; otherwise `FAILED` with `POOR_ACCURACY` / `REQUEST_EXPIRED` and the coordinates kept for information only.
- Structured failure reasons: `PERMISSION_DENIED, LOCATION_DISABLED, GPS_TIMEOUT, POOR_ACCURACY, DEVICE_UNAVAILABLE, REQUEST_EXPIRED, SERVICE_RESTRICTED, INTERNAL_ERROR`. Mock fixes complete but are flagged, mark the device and never update "last known location" or qualify as a site candidate.
- Admin API: `GET/POST /api/guards/{id}/location-requests`, `GET/DELETE /api/guards/{id}/location-requests/{requestId}` (supervisors read, admins create/cancel; every read is audited `LOCATION_VIEWED`, every request `LOCATION_REQUESTED`). One open request per device (idempotent), 12 requests per device per hour, deadline from `location.requestTtlSeconds` (default 180 s, 60–600), accuracy limit from `geofence.accuracyMaxM`. The automation tick expires overdue requests.
- Dashboard panel (`GuardLocationPanel`) on the guard's Location tab and on the device page: guard, device, online state, heartbeat age, site, shift, request status, last verified position with accuracy, time, age, provider, distance from site and geofence classification; actions Request current location, Refresh, View on map (with accuracy circle), Copy coordinates, Retry failed request, Cancel, **Use as site coordinates…** (opens the site form with the fix as a candidate that still needs confirmation).

### Android app (v1.5.0)
- `DeviceCommand` model; `LocationRequestPolicy` (pure, unit-tested): expired commands never start the GPS; a shift-monitoring fix ≤ 30 s old within the limit is reused; otherwise a fresh acquisition runs through the **same** `LocationMonitor` behind one acquisition lock (no second GPS pipeline, never cancelling a running shift check); a fix worse than the limit is reported as `POOR_ACCURACY`; no cached last-known fix is ever used to answer a request.
- `LocationRequestHandler`: one acquisition per command id (in-flight set plus 100 persisted handled ids), prechecks (permission, providers, background restriction), best-effort `PROCESSING` ack, result as a high-priority outbox event, "Operations asked for your current position" in the guard's Communication history.
- Delivery timing: the heartbeat loop now polls `GET /api/gateways/commands` every `commandPollSeconds` (server setting `gateway.commandPollSeconds`, default 30 s, 15–300) between heartbeats, guard mode only, backing off after three failures. `CommandWakeSource` is the hook for a future FCM wake-up; nothing depends on it.
- No classification rule, accuracy limit or shift-monitoring behaviour changed.

## 3. Database

Migration `20261019150000_site_location_sources` (additive): `CoordinatesSource` gains `BROWSER` and `GUARD_DEVICE`; new table `DeviceLocationRequest` with indexes on `(gatewayDeviceId, status)`, `(guardId, requestedAt)`, `(status, expiresAt)` and a unique `resultEventId`; cascades from device and guard, `SET NULL` from user. Applied locally with `prisma migrate deploy`; see `docs/DATABASE_CHANGES.md`.

## 4. Test results

| Suite | Result |
|---|---|
| `npm test` (unit, incl. `geo-position`, `location-request-state`) | see PR report |
| `scripts/dev/location-request-e2e.ts` (request lifecycle over HTTP: create, idempotency, delivery scoping, ack, result, replay, device binding, poor accuracy, mock, plausibility, expiry, cancel, rate limit, eligibility, site handoff) | 37/37 |
| `scripts/dev/geolocation-e2e.mjs` (Playwright, mocked browser geolocation: good fix → confirm; ±400 m → blocked until acknowledged; denied; insecure context) | 14/14 |
| Existing suites gateway/location/alerts/integration | see PR report |
| Android JVM unit tests (incl. `LocationRequestPolicyTest`) | 48/48 |
| Debug and release APK | built; release HTTPS-only, empty cleartext allowlist |

**No real-world GPS accuracy is claimed.** The numbers above come from mocked browser geolocation and simulated devices. Run `docs/DEVICE_TEST_PLAN.md` § "Location requests" on a phone before relying on this in operations.

## 5. Local testing

1. `npm run dev` (with `SMS_PROVIDER=simulated`), log in as an admin, open **Locations → Add location**.
2. Open the portal at `http://localhost:3000` (secure context) to test "Use my current location". Opening it from a phone at `http://<laptop-IP>:3000` shows the insecure-context guidance by design; use the HTTPS (Vercel) address or an HTTPS tunnel for phones.
3. Simulate a guard phone: `npx tsx scripts/dev/location-request-e2e.ts` exercises the whole command → result path without a phone. For a real phone: activate the debug APK (add the laptop IP to `omega.devHttpHosts` in `android/local.properties`, rebuild), then press **Request current location** on the guard's Location tab; the phone should answer within `commandPollSeconds` + GPS time.
4. `node scripts/dev/geolocation-e2e.mjs` runs the browser cases headless.

## 6. Production security considerations

- Browser geolocation requires HTTPS; the portal's Vercel address is HTTPS. Do not serve the portal over plain HTTP to phones.
- Only authenticated admins can create requests; supervisors can read. All reads and requests are audited. Devices only ever see their own commands and can only answer their own requests; results are bound by device id and `eventId` (replay-safe). Expired commands are not delivered and late answers are refused.
- The guard sees every request in the app's Communication history; there is no silent or continuous tracking outside shift monitoring. Rate limits: 12 requests per device per hour; one open request at a time.
- Release APKs refuse cleartext URLs; the debug allowlist exists only in debug builds and is empty unless a developer sets it locally.
- `NEXT_PUBLIC_MAPTILER_KEY` and `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` are browser keys: restrict them to your domain at the provider.

## 7. Known limitations

- Delivery latency is bounded by the command poll (default 30 s) plus GPS acquisition (10–45 s); a phone that is off, offline or killed by a battery manager cannot answer until it is back, and the request then expires (default 180 s) rather than waiting for ever. FCM is not integrated.
- Indoors, GPS accuracy may never reach the limit; the result is then `POOR_ACCURACY` or `GPS_TIMEOUT`, by design.
- Google Maps engine paths are type-checked but not exercised without a key; the Leaflet engine is covered by the Playwright suite.
- The admin's browser position (`BROWSER`) is still only as good as that device; it is labelled and warned, not blocked.
