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
