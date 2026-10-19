# Testing

## Automated

| Suite | Command | Covers |
| --- | --- | --- |
| Unit (TypeScript, `node:test`) | `npm test` | call state machine (dedupe, out-of-order, outgoing), phone normalisation, activation codes and tokens, rate limiting, event validation (calls and locations), geofence classification with accuracy, sync status, freshness, the monitoring state machine on the exact section-50 timeline, spurious-outside suppression, UNKNOWN handling |
| Unit (Kotlin, JUnit) | `cd android && ./gradlew testDebugUnitTest` | `CallTrackerTest` (6) and `GeofenceEngineTest` (3): the same section-50 timeline on the phone-side engine |
| Call gateway scenario (HTTP) | `npm run dev` then `ALLOW_LIVE_DB=1 npm run test:gateway-e2e` | 29 checks: activation, single-use code, heartbeat, SMS arrival flow, calls ringing→answered→ended, duplicate ack, timeline, missed call alert, unknown caller, offline replay, offline detection, reconnect, revocation, SMS still works |
| GPS scenario (HTTP) | `npm run dev` then `ALLOW_LIVE_DB=1 npx tsx scripts/dev/location-e2e.ts` | 38 checks, see below |
| Type and lint | `npx tsc --noEmit`, `npm run lint`, `npm run build` | |

Scenario scripts create tagged records and delete exactly those at the end; they refuse to run against a non-local `DATABASE_URL` unless `ALLOW_LIVE_DB=1`. Run them on a local or staging database.

## The 15 critical cases

| # | Case | Where verified |
| --- | --- | --- |
| 1 | Guard inside site + internet | location-e2e: SHIFT_STARTED inside → ARRIVAL VERIFIED, inside checks without alerts |
| 2 | Guard outside site + internet | location-e2e: LOCATION_EXIT LIVE, immediate warning |
| 3 | Guard inside + no internet | geofence unit tests (phone decides locally); location-e2e late batch keeps timestamps |
| 4 | Guard leaves + no internet | location-e2e: LOCATION_OUTSIDE uploaded late, SYNCED_LATE |
| 5 | Leaves, internet returns later | location-e2e: out-of-order late batch accepted, state correct |
| 6 | Returns after being offline | location-e2e: LOCATION_RETURNED SYNCED_LATE with 50 min outside |
| 7 | GPS unavailable | location-e2e: `no_fix` → UNKNOWN, one alert per hour |
| 8 | Location permission revoked | location-e2e: `permission_revoked` → UNKNOWN; unit tests |
| 9 | Device powered off | location-e2e: DEVICE_OFFLINE alert, no exit created |
| 10 | Operations calls guard | location-e2e: outgoing + incoming correlated, location on the guard's call |
| 11 | Guard calls operations | location-e2e: correlated, answered on the gateway |
| 12 | Feature-phone guard | location-e2e: attendance by SMS, NOT_APPLICABLE, no location alerts |
| 13 | SMS confirmation + GPS inside | location-e2e: VERIFIED |
| 14 | SMS confirmation + GPS outside | location-e2e: EXCEPTION with neutral alert, attendance unchanged |
| 15 | Existing SMS still works | both scenarios: arrival SMS by the engine, YES and welfare replies by the existing pipeline |

Also covered: poor accuracy re-classified as UNKNOWN by the server, verification overdue once, mock provider → integrity warning, revocation returns the guard to feature-phone mode.

## Manual, on a real phone (not yet done)

The APK built and passed its JVM tests but has not been run on a physical device in this environment. Before rollout: install the release APK on one Android 10+ phone and one older phone, activate in each mode, grant permissions, create a short shift at a site with coordinates, walk out of and back into the fence with mobile data off, then switch data on and confirm the events arrive as SYNCED_LATE; reboot the phone and confirm the heartbeat resumes; place calls both ways with the operations phone and confirm correlation.

## Browser regression suite

`scripts/dev/e2e.mjs` drives the whole portal (login, clients, sites, guards, shifts, simulator, incidents, compose, reports, templates, settings, users, notifications, audit). Run it against a local database only.

## Device location and location requests (added)

- `npm test` includes `tests/geo-position.test.ts` (lng/lat order, validity, accuracy verdicts, freshness, secure-context guidance, error states, watch budget) and `tests/location-request-state.test.ts` (request state machine, command payload, expiry and capture-time plausibility).
- `npx tsx scripts/dev/location-request-e2e.ts` (part of `npm run test:e2e`): the whole request path over HTTP with an admin session and device tokens.
- `npm run test:geolocation`: Playwright with a mocked Geolocation API against the running dev server; granted/good, granted/±400 m, denied, insecure context. Mocked positions prove the flow, not GPS accuracy.
- Android: `LocationRequestPolicyTest` (expiry, reuse, budget, judging). On-device cases L1–L9 in `docs/DEVICE_TEST_PLAN.md` remain manual.

## Production hardening and the guard workspace (added)

- `tests/env-check.test.ts`: production configuration rules (AUTH_SECRET fatal in production, example defaults flagged, simulator gating) and the login throttle (10 failures / 15 min per address and per account, cleared on success).
- `tests/guard-status.test.ts`: the four-concept location presentation (connection from heartbeat age; requested fixes count as verified positions while monitoring is idle; poor accuracy → uncertain; stale → stale; mock never trusted; no site coordinates → not assessed).
- `scripts/dev/location-request-e2e.ts` now also covers `/api/guards/{id}/status` (same device as the location panel, consistent concepts) and `/api/guards/{id}/activity` (merged, newest first, category filter, time-cursor paging, session required).
- `npm run test:layout` (`scripts/dev/layout-e2e.mjs`, Playwright): at 1440×900 and 1280×720 the guard workspace has no page scroll and no horizontal overflow, identity bar, location state, map, request controls, feed and detail region are visible together, the feed scrolls in its own panel without moving the identity bar or the map, filter chips work without reload; at 390×844 no horizontal overflow and a full-width map; `/operations`, `/monitoring`, `/operations/map`, `/gateways`, `/alerts` have no horizontal overflow.
- `npm run db:check`: schema validates, generated client matches the schema, every migration folder has SQL (`--db` adds the migration status against `DATABASE_URL`).
- `npm run test:shift-edit` (`scripts/dev/shift-edit-e2e.ts`): editing and deleting a shift against a real database — the paperwork-only edit, the schedule move, the config-version bump guard phones watch, the overlap guard, the lock once the arrival check has gone out, and the refusal to delete a shift that has produced any attendance, message, call, GPS event, alert or incident.
- `npm run test:map` (`scripts/dev/map-e2e.mjs`): Mapbox GL in a real browser — WebGL starts, the style and vector tiles load, the application's own layers are added, the map survives a status refresh without being re-created, the satellite switch re-adds the layers, the fleet map clusters, and the site picker still drives the form. With no `NEXT_PUBLIC_MAPBOX_TOKEN` the same script asserts the Leaflet fallback instead, so both renderers are covered.
- `npm run test:layout` (`scripts/dev/layout-e2e.mjs`): accepts either renderer.
