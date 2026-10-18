# Implementation Audit and Baseline (Phase 1, Stage 0)

Date: 2026-10-18 · Repository state: `origin/main` at `cf900d4` (PR #13 merged) · Branch for this phase: `claude/brave-hopper-92o6rw`

This document is the Stage 0 deliverable of the Phase 1 implementation sequence. It records what exists, what the baseline checks say, which reported defects are confirmed from the code, their root causes, the risks of the planned changes and the regression plan that protects the SMS, call and attendance systems.

Nothing in this audit changes behaviour. Code changes start in Stage 1.

---

## 1. Architecture map (as found)

### 1.1 Web platform

| Layer | Where | Notes |
|---|---|---|
| Framework | Next.js 15 App Router, React 19, TypeScript, Tailwind 4 | `src/app/(app)/…` pages, server actions in `src/actions/*` |
| Database | Prisma 6 over Neon Postgres | TCP on Vercel; `DATABASE_OVER_HTTP=true` adapter in the sandbox. Migrations applied with `scripts/neon-migrate.ts` (additive only) |
| Auth / RBAC | jose JWT cookie, `guarded(role)` route wrapper, `can.*` helpers | unchanged by this phase |
| SMS | `SmsProvider` abstraction (Sendai in production), `processIncomingMessage`, templates, `runAutomationTick` (12 steps) | **must not be modified**. Gateway and location maintenance steps are isolated in their own `try/catch` inside the tick |
| Call gateway backend | `src/lib/gateway/{auth,service,events,call-state,location-events}.ts` | activation code → hashed Bearer token; `processGatewayEvents` dedupes by `eventId`, folds call events per `(device, callId)` with pure `reduceCall`; raw `GatewayEvent` log; in-memory rate limits |
| Geofence backend | `src/lib/geofence.ts` (`classifyFix`, `stepMonitor`, `syncStatusFor`, `freshness`) | mirrored in Kotlin `GeofenceEngine.kt`; server re-classifies every fix against the site it knows |
| Device API | `src/app/api/gateways/{activate,heartbeat,config,events,location-events,simulate}` | `config` returns guard + live/next shift + site lat/lng/radius + geofence policy; `heartbeat` stores permissions, monitoring state, last location; `events` returns one ack per event (`ok`, `duplicate`, `rejected`) |
| Portal | Devices pages, shift Location card, operations location column, Leaflet/OSM `SiteMap`, simulators (call + location), reports (calls, location) | site coordinates are typed by hand in `src/components/client-location-forms.tsx` |
| Settings | `gateway.*` and `geofence.*` keys in `src/lib/settings.ts` | `geofence.accuracyMaxM` default 100 m |

### 1.2 Android app (`android/`, Kotlin, minSdk 24, targetSdk 35)

| Component | File | Responsibility today |
|---|---|---|
| `GatewayApp` | `GatewayApp.kt` | notification channel; starts the service when the process starts |
| `ActivationActivity` | `ui/ActivationActivity.kt` | server URL + 6-character code → token in `EncryptedSharedPreferences` |
| `PermissionsActivity` | `ui/PermissionsActivity.kt` | guard-mode onboarding; sets `prefs.onboardingDone` on **Start** |
| `MainActivity` | `ui/MainActivity.kt` | dashboard; **Sync now** button; permission re-request |
| `GatewayService` | `service/GatewayService.kt` | foreground service (`specialUse|location`). Owns three coroutines: heartbeat loop, sync loop (conflated channel + backoff) and **monitor loop** (GPS checks) |
| `SyncEngine` | `service/SyncEngine.kt` | `syncOnce()` drains the outbox; `heartbeat()` posts device info and refreshes the shift config |
| `SyncWorker` | `service/SyncWorker.kt` | WorkManager safety net every 15 min: heartbeat + sync + restart service |
| `LocationMonitor` | `location/LocationMonitor.kt` | one shift-aware step: load config → acquire fix → classify → state machine → enqueue events |
| `GeofenceEngine` | `geofence/GeofenceEngine.kt` | pure classification + state machine, JVM-tested |
| `EventQueue` | `data/EventQueue.kt` | SQLite outbox `outbox(id, eventId UNIQUE, json, createdAt, attempts, lastError)` — no status or priority columns |
| `ShiftConfig` | `data/ShiftConfig.kt` | cached copy of `GET /api/gateways/config` |
| `Prefs` | `data/Prefs.kt` | credentials (encrypted) + plain status fields |
| `CallMonitor` / `CallTracker` | `call/*` | call metadata only; attaches the last fix to call events in guard mode |

### 1.3 Build and tooling facts

- The repository uses **npm**, not pnpm. The device test report quoted `pnpm run android:debug`; the equivalent command here is `npm run android:debug` (`scripts/android.mjs`). Both produce the same Gradle invocation, so this is a documentation mismatch, not a defect.
- Android build: AGP 8.7.3, Gradle 8.14.3, JDK 21, `ANDROID_HOME=/opt/android-sdk`; Maven Central is mirrored through Google's storage mirror first (sandbox rate-limit workaround, harmless elsewhere).
- Debug application id is `zw.co.omega.gateway.debug`, matching the id the tester saw. Release id is `zw.co.omega.gateway`. Both can be installed side by side.
- Committed APKs at the start of Phase 1: `artifacts/android/security-gateway-debug.apk` (7.1 MB) and `security-gateway-release.apk` (1.8 MB, v1.1.0, versionCode 2, signed with the debug key — not a production signing key). Rebuilt as v1.2.0 (versionCode 3) at the Phase 1 gate.

---

## 2. Baseline results (before any Phase 1 change)

| Check | Command | Result |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | clean |
| ESLint | `npm run lint` | no warnings or errors |
| Unit tests (web) | `npm test` | 20/20 pass |
| Android unit tests | `./gradlew testDebugUnitTest` | 9/9 pass (`GeofenceEngineTest` 6, `CallTrackerTest` 3) |
| Android debug build | `./gradlew assembleDebug` | success, `app-debug.apk` produced |
| End-to-end scripts | `scripts/dev/gateway-e2e.ts`, `scripts/dev/location-e2e.ts` | last run on the previous phase: 29/29 and 38/38. They need a local database and are re-run at the Phase 1 gate |

### 2.1 Live database baseline (read-only, `scripts/dev/audit-live.ts`)

| Item | Live Neon database |
|---|---|
| Users | 4 |
| Guards | 22, all feature-phone |
| Sites | 4 (MI-01, ABC-03, 483HC, ABC-01) — **all without coordinates**; ABC-01 radius 30 m, others 150 m |
| Gateway devices | 0 |
| Location events / gateway events / calls | 0 / 0 / 0 |
| Active shifts | 19 (SMS-driven) |

Consequences:

- The Pixel 6 Pro test that produced the reported logs (David Banda, site EOP-02, "Eastgate Office Park — Night Patrol") ran against a **local database seeded with the demo data set**, not production. EOP-02 does not exist in the live database, and the demo seed (`prisma/seed-demo.ts`) sets no coordinates at all, so the EOP-02 coordinates were typed in by hand on that local instance. They are temporary test coordinates and are treated as such (Stage 2 adds a `coordinatesSource = TEST` marker so they can never be mistaken for verified production data).
- No production guard currently uses an Android device, so Stage 1–3 changes carry no live-data risk on the device side. The SMS workflow is the only live production path and is out of scope for change.
- The hot-fix the tester applied to `MainActivity` on their machine was never pushed. `origin/main` has nothing beyond `cf900d4`, so this phase starts from the merged code, and the fixes below are implemented properly rather than re-applying an unknown patch.

---

## 3. Reported defects: confirmation and root causes

Legend: **Confirmed** = reproducible from the code without a device; **Suspected** = consistent with the code but needs a device to prove; **Not a defect** = behaviour is correct, message or expectation was wrong.

### D1 · Onboarding loop after activation — Confirmed

`MainActivity.onCreate()` sends a guard device to `PermissionsActivity` when onboarding is not done, then unconditionally calls `requestPermissions()`, which in guard mode **always** starts `PermissionsActivity` again (`MainActivity.kt:46-47, 53-54`). `PermissionsActivity`'s **Start** button sets `onboardingDone` and starts a new `MainActivity`, whose `onCreate` runs `requestPermissions()` again → `PermissionsActivity` again. The guard can never reach the dashboard without the hot-fix.

Fix (Stage 1): replace the two boolean checks with an explicit app state (`NOT_ACTIVATED → ACTIVATED → PERMISSIONS_INCOMPLETE → READY`, plus `PERMISSION_REVOKED`, `REACTIVATION_REQUIRED`). Onboarding opens only from `PERMISSIONS_INCOMPLETE`; the **Grant permissions** button on the dashboard opens it explicitly; `onboardingDone` is derived from state, not a flag that fights the permission check.

### D2 · "Sync now" cancels GPS acquisition — Confirmed

The **Sync now** button fires `requestHeartbeat`, `requestSync` and, in guard mode, `requestLocationCheck` (`MainActivity.kt:45`). `GatewayService.onStartCommand` handles `ACTION_CHECK_LOCATION` with `monitorJob?.cancel(); monitorJob = monitorLoop()` (`GatewayService.kt:69`). A cancel while `LocationMonitor.obtainFix()` is waiting for a GPS fix throws `CancellationException` inside `step()`, which the loop catches as a generic `Exception` and logs as `monitor step: StandaloneCoroutine was cancelled`. The restarted loop starts a new acquisition from zero, so repeated taps mean GPS never completes. The same cancel path runs for `ACTION_HEARTBEAT` on the heartbeat loop, which is harmless but shows the pattern.

Fix (Stage 1 and 3): GPS monitoring and sync become two independent coordinators. **Sync now** talks only to the sync engine. **Check location now** is a separate button that asks the monitoring coordinator for a check; if an acquisition is already running the request joins it instead of cancelling it.

### D3 · Manual check does not start / no GPS diagnostics until restart — Confirmed (two causes)

1. The cancel path in D2 means the user's tap destroys the running step.
2. `LocationMonitor.step()` returns `NOT_ON_SHIFT` with a **15-minute** wait whenever `ShiftConfig.load()` is null (`LocationMonitor.kt`, first branch of `step()`). On first start the config has not been fetched yet (it arrives with the first successful heartbeat), so the monitor sleeps 15 minutes before it notices the shift. Nothing wakes it when the config arrives, and a manual check restarts the loop, which immediately re-reads config — explaining why "it only works after a restart" or after a lucky tap.

Fix (Stage 1): the monitoring coordinator is woken by config changes and by manual requests; a config-less state waits at most 60 s and re-checks when the config is saved.

### D4 · Misleading status messages — Confirmed

- Every `LOCATION_UNAVAILABLE` phase is rendered as "LOCATION UNAVAILABLE · turn on location" (`strings.xml` `mon_unavailable`), including `poor_accuracy`, `no_fix`, `site_has_no_coordinates` and `permission_revoked`. The tester saw it with location switched on because the reason was `poor_accuracy` (121 m > 100 m).
- `conn_*` messages mix transport state and permission state, and "Last sync" is updated by heartbeats as well as event syncs, so a successful heartbeat reads as a successful sync.
- The "Location:" row shows `prefs.locationName`, which is the **device's registration site** from the devices page, not the duty site of the current shift. For a guard device registered without a site it shows "Head office".

Fix (Stage 1): a reason → message table (`no_fix`, `poor_accuracy`, `location_disabled`, `permission_revoked`, `site_has_no_coordinates`, `on_boundary`, `not_on_shift`, `waiting_for_shift`), separate rows for **Shift**, **Duty site**, **GPS**, **Sync**, and **Device registration**, and distinct wording for *device offline*, *GPS unavailable*, *outside site* and *unknown*.

### D5 · ±100 m displayed while classification says UNKNOWN / 121 m poor_accuracy — Not a defect in classification, Confirmed display defect

The classifier uses the raw accuracy (`acc > accuracyMaxM` → `poor_accuracy`), while the dashboard prints `prefs.lastFixAccuracy.toInt()`. A fix with accuracy 100.4 m is rejected (correctly) but displayed as "±100 m", and the log line the tester saw ("UNKNOWN 121 m poor_accuracy") is a different, later fix. "Distance 14 m" with "UNKNOWN" is also correct behaviour: with ±100 m accuracy and a 150 m radius, `d + acc = 114 m ≤ 150 m` would be INSIDE, but the accuracy gate runs first and refuses any fix worse than the policy maximum. The conservative rule stays; the display must say *why*.

Fix (Stage 1): show accuracy with one decimal and the explicit reason ("GPS accuracy ±121 m is worse than the 100 m limit; not counted"), keep the raw value in events, and retry a poor fix within the same step before giving up (see D6).

### D6 · GPS acquisition reliability — Suspected, improved regardless

`obtainFix()` requests a single GPS update with a 45 s budget, then a single network update with 20 s, and accepts the first GPS fix even if it is poor (returns it only when `accuracy <= accuracyMaxM`, otherwise falls back to "best of gps/network"). A cold GPS start indoors routinely delivers a first fix at 100–150 m and improves within 10–20 s; a single-update request never sees the improvement.

Fix (Stage 1): request continuous updates for up to ~60 s, keep the best fix, stop early at ≤ 25 m or when the fix is good enough to classify, then fall back to network and last-known. Use `requestLocationUpdates` on both providers in parallel rather than serially.

### D7 · Service lifecycle and recovery — Suspected

`GatewayService.onDestroy()` cancels jobs but `scope` itself is never cancelled (`scope.launch { }.cancel()` is a no-op). A restart from `BootReceiver`/`SyncWorker` creates a new service with fresh loops, and the config/monitor state lives in prefs, so recovery works, but duplicate loops are possible if `onStartCommand` races with `onCreate` on some builds. Kotlin `monitorJob == null` guards cover the normal case only.

Fix (Stage 1): one coordinator instance per service, started in `onCreate`, cancelled in `onDestroy` with `scope.cancel()`, idempotent `start()`.

### D8 · Device registration location vs duty site — Confirmed (see D4)

### D9 · Shift state and GPS state are mixed — Confirmed

`prefs.monitoringState` carries both shift state (`NOT_ON_SHIFT`, `WAITING_FOR_SHIFT`) and GPS state (`LOCATION_UNAVAILABLE`, `OFFLINE_MONITORING`). The portal receives the same string as `monitoringState`. Fix (Stage 1): separate `shiftState`, `gpsState` (with reason) and `syncState`; heartbeat sends all three while keeping `monitoringState` for backward compatibility.

### D10 · Sync tied to the GPS loop — Confirmed

`monitorLoop()` triggers sync after each step; the sync loop otherwise wakes every 60 s–15 min by backoff or on network availability. There is no trigger on activation, app start, shift/config change, emergency or schedule, and no per-event status, priority, history or diagnostics. The outbox has no status column. Fix (Stage 3).

---

## 4. Things that are working and must stay that way

- SMS templates, inbound processing, arrival/welfare/completion automation and client updates (PR #11) — not touched.
- Call event folding, deduplication by `eventId`, token hashing, rate limits.
- Conservative geofence classification (accuracy gate first, boundary band → UNKNOWN) on both server and phone, with the server re-classifying from the site it knows.
- Attendance verification from SMS + GPS, alerts, retention.
- Feature-phone guards (all 22 live guards) continue on the SMS path with no device.

---

## 5. Risks of the Phase 1 changes and how they are contained

| Risk | Containment |
|---|---|
| Breaking the SMS pipeline while adding schema fields | Additive migrations only (`ALTER TABLE … ADD COLUMN` with defaults); applied with `scripts/neon-migrate.ts`; `npm test` SMS suites and `gateway-e2e`/`location-e2e` re-run at the gate |
| Phone/server config drift | `configVersion` on sites and shifts; the phone echoes the version it applied in heartbeats; the portal shows "config applied v N" per device |
| Google Maps key leakage | Browser key only (`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`), restricted by HTTP referrer in Google Cloud; never committed; Leaflet/manual entry when absent |
| Outbox migration on devices already installed | SQLite `onUpgrade` 1 → 2 adds columns with defaults; existing rows become `QUEUED`/`NORMAL` |
| Over-eager sync on metered data | Triggers coalesce into one run; backoff on failure; batch of 100 |
| GPS battery cost of longer acquisition | Capped at ~60 s per check, early stop at ≤ 25 m, same check intervals as before |
| Weakening the accuracy safeguard | Not changed: `accuracyMaxM` still gates every fix; more fixes are *collected* but only a good one is *accepted* |
| Claims without a device | Device-only acceptance tests are reported as **UNVERIFIED** until run on hardware |

---

## 6. Regression plan (run at every stage and at the Phase 1 gate)

1. `npx tsc --noEmit`, `npm run lint`, `npm test`.
2. `cd android && ./gradlew testDebugUnitTest assembleDebug` (JVM tests for geofence, call tracker, and the new coordinator/sync/state tests).
3. Local database (never the live Neon URL unless `ALLOW_LIVE_DB=1`): `npx tsx scripts/dev/gateway-e2e.ts` and `npx tsx scripts/dev/location-e2e.ts`.
4. `npm run build` (Next production build).
5. Manual portal checks: site editor with and without a Maps key, shift override, device page diagnostics.
6. Acceptance tests A–H from the implementation prompt, each marked **PASS**, **FAIL** or **UNVERIFIED (device required)**.

---

## 7. Stage plan derived from this audit

| Stage | Scope | Deliverables |
|---|---|---|
| 1 | Android defects D1–D9 | `MonitoringCoordinator`, `AppState`, status mapping, acquisition rewrite, separate buttons, Kotlin tests, `docs/ANDROID_ARCHITECTURE.md` |
| 2 | Duty-site picker in the **web portal** | Google Maps picker (search, pin, drag, radius, preview) with Leaflet fallback, `Location.configVersion/coordinatesSource/coordinatesVerifiedAt`, shift-level override, validation, EOP-02 flagged `TEST`, audit log, `docs/GOOGLE_MAPS_CONFIGURATION.md` |
| 3 | Automatic sync engine (D10) | `SyncCoordinator`, outbox v2 (status, priority, attempts, nextAttemptAt, sentAt, ackedAt), triggers, diagnostics screen, heartbeat sync fields, portal device sync panel, `docs/AUTO_SYNC.md` |
| Gate | Evidence | all suites green, APKs rebuilt, acceptance table, final report |

---

# Phase 1 gate results (Stages 0–3)

Branch `claude/brave-hopper-92o6rw`, four commits on top of `cf900d4`: Stage 0 (audit), Stage 1 (Android defects), Stage 2 (map picker + config versioning), Stage 3 (sync engine). Everything below was run in the cloud sandbox against a local PostgreSQL 16 with the demo seed; the two additive migrations were also applied to the Neon production database with `scripts/neon-migrate.ts`.

## Checks after Phase 1

| Check | Before | After |
|---|---|---|
| `npx tsc --noEmit` | clean | clean |
| `npm run lint` | clean | clean |
| `npm test` | 20/20 | 25/25 (`tests/site-config.test.ts` added) |
| Android JVM tests | 9/9 | 40/40 (AppState 6, StatusModel 7, AcquisitionPolicy 5, MonitoringCoordinator 5, SyncPlanner 5, SyncCoordinator 3 added) |
| `assembleDebug` / `assembleRelease` | ok | ok, v1.2.0 (versionCode 3) |
| `scripts/dev/gateway-e2e.ts` | 29/29 | 30/30 (sync-diagnostics heartbeat check added) |
| `scripts/dev/location-e2e.ts` | 38/38 | 38/38 |
| `npm run build` | ok | ok |
| Migrations | — | `20261018120000_site_config_versioning`, `20261018150000_device_sync_diagnostics` applied locally and on Neon |

## Acceptance tests A–H

| Test | Result | Evidence / limits |
|---|---|---|
| **A** GPS acquisition during sync: start a check, press Sync now; acquisition continues, sync completes independently | **PASS (logic)** · **UNVERIFIED on device** | `MonitoringCoordinatorTest` proves a request during a running check never cancels it; `Sync now` now only reaches `SyncCoordinator` (`MainActivity.syncNow`, `GatewayService.ACTION_SYNC`); the two coordinators share no job. The old `monitorJob?.cancel()` path is gone. Hardware run still owed |
| **B** Concurrent requests: repeated check/sync taps produce no duplicate acquisitions, loops or deliveries | **PASS (logic)** · **UNVERIFIED on device** | Coordinators coalesce requests (`requestCheck()` / `request()` return false and queue one follow-up); `start()` is idempotent; outbox rows are `SENDING`-locked and acked by unique `eventId` (`duplicate` ack test in location e2e) |
| **C** Offline location: no internet during a shift; monitoring continues, events saved locally | **PASS (logic)** · **UNVERIFIED on device** | Classification and state machine are local (`GeofenceEngineTest`, section-50 scenario); outbox is SQLite; `SyncPlanner.syncState` reports `QUEUED_OFFLINE`; dashboard shows *GPS: INSIDE* + *NO INTERNET · n saved* (`StatusModelTest`) |
| **D** Automatic recovery: restore internet; queued events sync without a button | **PASS (logic + server)** · **UNVERIFIED on device** | `NETWORK_RESTORED` trigger from the default-network callback; `SyncCoordinatorTest` (retry wake-up); server side late replay verified in location e2e (`SYNCED_LATE`, original times, duplicate replay ignored) |
| **E** Site configuration through the admin picker: coordinates and radius validated, saved, delivered, applied | **PASS** (OpenStreetMap fallback exercised in the browser; Google engine code-reviewed only, no key in the sandbox) | Browser run `scripts/dev/shot-picker.mjs`: click placed pin, radius 250, source TEST, inputs filled; validation unit tests; `GET /api/gateways/config` returns the effective fence + `configVersion`; heartbeat stores `configVersionApplied` (gateway e2e); phone wakes the monitoring loop on config change (`MonitoringCoordinatorTest`) |
| **F** GPS uncertainty: poor or boundary readings stay UNKNOWN | **PASS** | Unchanged rules on both sides; location e2e "server re-classifies a ±250 m fix as UNKNOWN"; `AcquisitionPolicyTest` shows longer listening never accepts a fix worse than the limit; dashboard explains the reason (`StatusModelTest`: poor accuracy ≠ location off) |
| **G** Service lifecycle: restart, screen lock, background, network interruption, recoverable GPS failure | **PARTIAL** · **UNVERIFIED on device** | Code: idempotent coordinator start, scope cancelled on destroy, `SENDING` rows reset at start, WorkManager fallback, `PERMISSION_REVOKED` state with clear text. Screen-lock and OEM battery-manager behaviour can only be proven on hardware |
| **H** Regression: SMS, call monitoring, attendance, onboarding, shifts | **PASS** | `npm test` (SMS pipeline, call state, auth), gateway e2e steps 32–33 (SMS still works), location e2e Test 12 (feature-phone guard unaffected); no SMS file changed in Phase 1 |

## Device-only items still owed (not claimed)

Run on the Pixel 6 Pro with the v1.2.0 debug APK (`zw.co.omega.gateway.debug`): the onboarding flow (Stage 1 D1), a 60 s acquisition indoors, Sync now during a check, airplane-mode shift segment and reconnect, screen-off monitoring with "Allow all the time", and the Settings → Sync engine history. The acceptance rows marked UNVERIFIED above become PASS or FAIL only after that run. Production readiness is **not** claimed on the strength of compilation and simulation.

## Stage summaries

**Stage 1 (Android)** — `MonitoringCoordinator`, `AcquisitionPolicy`, `AppState`, `StatusModel`, `ConfigBus`; `GatewayService`, `LocationMonitor`, `MainActivity`, `PermissionsActivity`, `Prefs`, `ShiftConfig`, `SyncEngine` (heartbeat fields), layout and strings. Fixes D1–D9 from section 3.

**Stage 2 (web + schema)** — `src/components/map/site-picker.tsx` (Google Maps or OpenStreetMap), `src/lib/site-config.ts`, validation (pair rule, radius, override), `actions/locations.ts` (version bump + before/after audit), `actions/shifts.ts` (`updateShiftGeofence`), `services/shifts.ts`, `gateway/service.ts` (effective fence, `configVersion`, `configVersionApplied`), `gateway/location-events.ts` (effective fence, mock flag), site/shift/device pages, demo seed (EOP-02 flagged TEST), `docs/GOOGLE_MAPS_CONFIGURATION.md`, `.env.example`.

**Stage 3 (sync engine)** — `SyncPlanner`, `SyncCoordinator`, `EventQueue` v2 + `sync_log`, `SyncEngine` run/report, triggers wired through `GatewayService`, `LocationMonitor`, `CallMonitor`, `ActivationActivity`, `SyncWorker`; Settings diagnostics; backend sync fields + device panel; `docs/AUTO_SYNC.md`, `docs/DATABASE_CHANGES.md`, `docs/OFFLINE_MONITORING.md`.

## Blockers and notes

- No Google Maps key exists in the repository or the sandbox, by design. The Google engine was written against the current Maps JavaScript API (`importLibrary`, `PlaceAutocompleteElement`) and type-checked with `@types/google.maps`; its first live run needs a key with the three APIs enabled (see GOOGLE_MAPS_CONFIGURATION.md). The OpenStreetMap engine is what the screenshots show.
- The release APK is still signed with the debug key (no production keystore in the environment). Set `ANDROID_KEYSTORE_PATH` and friends before distributing.
- The tester's report quoted `pnpm`; the project uses `npm`. The commands are otherwise the same.
- The live database has no guard devices yet, so nothing in production depends on the Android changes until a device is activated.
