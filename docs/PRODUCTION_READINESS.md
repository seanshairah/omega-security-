# Production Readiness Assessment (after Phase 3)

Date: 2026-10-19 · Portal on `main` · App v1.5.0 (versionCode 6)

## Verdict

**Ready for a supervised pilot, not yet signed off for fleet-wide production.** Every server-side and workflow requirement of the three phases is implemented and verified by automated suites against a real database and real HTTP. The Android app compiles, passes its unit tests and implements every required behaviour, but **no run on a physical phone has been performed in this environment**; the items in `DEVICE_TEST_PLAN.md` must pass before the app is relied on by guards in the field. The release APK is still signed with the debug key because no production keystore exists here.

## Evidence

| Area | Evidence | Status |
|---|---|---|
| Typecheck, lint, production build | clean | verified |
| Web unit tests | 40/40 | verified |
| Android JVM unit tests | 48/48 | verified |
| Gateway end-to-end (calls, activation, revocation, SMS regression) | 30/30 | verified |
| Location end-to-end (section-50 scenario, 15 critical cases, feature phone, mock) | 38/38 | verified |
| Alerts end-to-end (emergency with/without fix, all types, replay, acknowledgement, SMS EMERGENCY) | 20/20 | verified |
| Integration end-to-end (Stage 8 matrix) | 18/18 | verified |
| Location-request end-to-end (command delivery, binding, replay, expiry, accuracy, mock, site handoff) | 37/37 | verified |
| Browser geolocation (Playwright, mocked Geolocation API: good fix, poor accuracy, denied, insecure context) | 14/14 | verified with mocked positions, **not real GPS** |
| Migrations on Neon | all applied, `db:migration-status` clean | verified |
| SMS system | no SMS file changed in Phases 1–3; regression steps in three suites | verified |
| Debug and release APKs | build, R8, log stripping, HTTPS-only release | compiled, **unverified on device** |
| Guard onboarding, GPS acquisition, Sync/Check independence, offline replay, emergency dialogs, acknowledgement on the phone, screen layouts | code + unit tests | **unverified on device** |
| Release signing | debug key | **blocker for distribution** |
| Google Maps picker (Google engine) | code, type-checked; Leaflet engine (OpenStreetMap/MapTiler tiles) exercised in the browser | **unverified with a key** |
| Remote location request on a phone (L1–L9 in DEVICE_TEST_PLAN) | code + unit tests + simulated device | **unverified on device** |

## Blockers before fleet production

1. Run `DEVICE_TEST_PLAN.md` on at least one guard phone and one operations phone; record results in `IMPLEMENTATION_AUDIT.md`.
2. Create the release keystore, set `ANDROID_KEYSTORE_*`, rebuild, confirm `buildType: release` and no secure-storage warning on the device page.
3. Set `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (referrer-restricted) if Google Maps is wanted; otherwise OpenStreetMap stays in use.
4. Place the four live sites on the map (they have no coordinates today) before enabling GPS verification for any guard. Use the site picker's confirmed-position flow or a guard phone standing at the site (`docs/DEVICE_LOCATION_AND_SITE_SETUP.md`); never type an estimate as `MAP`.

## Risks accepted for a pilot

- OEM battery managers can still kill the service; WorkManager restarts it within 15 minutes and nothing is lost, but checks can be late. The *verification overdue* alert and the Location exceptions page make this visible.
- GPS indoors is often worse than the 100 m limit; the app says so explicitly and never reports "outside" from such a fix.
- A guard whose phone is offline shows as *device offline*, never as absent or outside.

## What does not change for current operations

All 22 live guards are feature-phone guards. The SMS workflow is unchanged and remains the system of record for attendance; GPS and app alerts only add to it once devices are activated.
