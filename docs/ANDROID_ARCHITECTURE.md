# Android App Architecture (Security Gateway)

One APK, two modes decided by the server at activation: **OPERATIONS_GATEWAY** (a company phone that reports calls) and **GUARD** (a guard's phone that also verifies location during shifts). This document describes the structure after Phase 1, Stage 1.

## 1. Two independent systems, one service

```
GatewayService (foreground, specialUse|location)
 ├── MonitoringCoordinator  ── LocationMonitor ── GeofenceEngine ──► EventQueue (outbox)
 │     GPS checks, one at a time, guard mode only                        │
 ├── Sync loop ── SyncEngine.syncOnce() ◄─────────────────────────────────┘
 │     drains the outbox, independent of GPS
 └── Heartbeat loop ── SyncEngine.heartbeat() ── refreshes ShiftConfig ──► ConfigBus
```

| System | Owns | Woken by | Never does |
|---|---|---|---|
| **GPS monitoring** (`MonitoringCoordinator`) | the single location check in flight, the geofence state machine, `shiftState` / `gpsState` / `gpsReason` | schedule from the state machine, **Check location now**, shift-config change (`ConfigBus`) | send anything to the network; get cancelled by a sync |
| **Event sync** (sync loop + `SyncEngine`) | the outbox, `lastSyncAt`, per-event acks | new events from a check, network back, **Sync now**, WorkManager every 15 min, backoff timer | touch GPS, change monitoring state |
| **Heartbeat** | device status, `lastHeartbeatAt`, shift-config download | its interval, network back, **Sync now** | count as an event sync |

Stage 3 replaces the sync loop with a full `SyncCoordinator` (statuses, priorities, history); the boundary above stays.

## 2. MonitoringCoordinator rules

- **One check at a time.** `requestCheck()` while a check is running returns `false`, remembers the request, and the loop runs one more check as soon as the current one finishes. Nothing is cancelled, so a GPS acquisition in progress is never thrown away. (The old code cancelled the monitor job on every tap, which logged `StandaloneCoroutine was cancelled` and restarted acquisition from zero.)
- **Config changes wake the loop.** `ShiftConfig.save()` compares the new config with the cached one (ignoring the fetch time) and signals `ConfigBus`; the coordinator re-evaluates immediately. Without a cached config the loop waits 60 s, not 15 min.
- **CancellationException is re-thrown**, never logged as a failed step. It only happens when the service stops.
- Any other exception is logged with its class and message and the loop continues after the minimum wait (30 s).
- `checking` is exposed as a `StateFlow` and mirrored into `Prefs.gpsChecking` so the dashboard and notification can say *CHECKING…*.

The coordinator has no Android dependencies and is unit-tested (`MonitoringCoordinatorTest`).

## 3. Location acquisition (`LocationMonitor.obtainFix`)

- Listens to the GPS **and** network providers at the same time via `requestLocationUpdates` (platform `LocationManager`, no Play Services).
- Keeps the best fix (`better()`: lower accuracy, then newer) and stops when `AcquisitionPolicy.decide()` says so:
  - best fix ≤ 25 m → stop immediately;
  - best fix ≤ `accuracyMaxM` (policy, default 100 m) and ≥ 15 s listened → stop;
  - 60 s budget spent → stop with whatever is best.
- Falls back to a last-known fix under two minutes old.
- **The accuracy safeguard is unchanged.** Any fix worse than `accuracyMaxM` is classified `UNKNOWN / poor_accuracy` by `GeofenceEngine.classify` on the phone and again by `classifyFix` on the server. Longer listening only makes a *good* fix more likely; it never accepts a bad one.

## 4. Three facts instead of one string

| Pref | Values | Shown as |
|---|---|---|
| `shiftState` | `NONE`, `UPCOMING`, `ACTIVE` | **Shift:** row |
| `gpsState` | `OFF`, `MONITORING`, `VERIFYING_OUTSIDE`, `OUTSIDE`, `LOCATION_UNAVAILABLE` | **GPS:** row |
| `gpsReason` | `no_fix`, `poor_accuracy`, `location_disabled`, `permission_revoked`, `site_has_no_coordinates`, `on_boundary` | the explanation line under GPS |
| `lastSyncAt` / `lastHeartbeatAt` | timestamps | **Sync:** card |
| `monitoringState` | composite, as before | sent to the server for older portal versions |

`StatusModel.kt` maps these to what the guard reads (`gpsView`, `gpsReasonKind`, `syncView`), with unit tests that pin the important distinctions: poor accuracy is never "turn on location"; `UNKNOWN` is never "outside"; an offline phone with the guard inside shows *INSIDE* + *NO INTERNET*, never *outside*.

Accuracy is shown with one decimal (`±100.4 m`) so a fix that just failed the 100 m limit is never displayed as "±100 m".

## 5. Screen routing (`AppState.kt`)

`resolveAppState()` is the only place that decides which screen to show:

| State | Meaning | Screen |
|---|---|---|
| `NOT_ACTIVATED` | no token | Activation |
| `PERMISSIONS_INCOMPLETE` | activated, a required permission missing, onboarding never finished | Onboarding, opened **once** per dashboard instance |
| `READY` | everything granted | Dashboard |
| `PERMISSION_REVOKED` | onboarding finished earlier, a permission was removed since | Dashboard with warning + **Grant permissions** button; no automatic redirect |
| `REACTIVATION_REQUIRED` | server rejected the token | Dashboard: "ask the administrator" |

Required permissions: guard mode = location *Allow all the time* + phone + call log; operations mode = phone + call log. The onboarding **Start** button finishes the onboarding activity and returns to the dashboard underneath (it only starts a new dashboard when it is the task root). This removes the loop in which the dashboard re-opened onboarding on every start.

## 6. Dashboard rows

- **Shift** · **Duty site** (the shift's site and radius, or "Site has no coordinates yet") · **GPS** with reason · **Last location check** (time, state, distance, accuracy) · **Location permission**.
- **Sync** (UP TO DATE / SENDING n / NO INTERNET n saved / RECONNECTING / DEVICE REVOKED) · **Last heartbeat** · **Status** (app state line).
- **Device**: name, **Registered at** (the device's registration location from the Devices page, labelled so it is not mistaken for the duty site), phone, battery, network, version, last call.
- Buttons: **Grant permissions** (only when needed), **Allow running in background**, **Check location now** (guard mode), **Sync now**.

## 7. Service lifecycle

- `GatewayApp.onCreate`, `BootReceiver` (boot, package replaced) and `SyncWorker` (every 15 min with network) all call `GatewayService.start()`; the service is `START_STICKY`.
- `onCreate` builds one coordinator; `start()` is idempotent, so repeated `onStartCommand`s cannot create duplicate loops.
- `onDestroy` stops the coordinator, cancels the heartbeat and sync jobs and the whole scope, and clears `gpsChecking`.
- Monitoring state lives in `Prefs`, the outbox in SQLite: a restart resumes where it left off, and queued events survive process death and reboots.

## 8. Files

| File | Purpose |
|---|---|
| `service/MonitoringCoordinator.kt` | GPS loop ownership (pure) |
| `service/GatewayService.kt` | foreground service, wires the three systems |
| `service/SyncEngine.kt` | outbox drain + heartbeat (+ config refresh) |
| `location/LocationMonitor.kt` | one check: acquire → classify → state machine → enqueue |
| `location/AcquisitionPolicy.kt` | when to stop listening (pure) |
| `geofence/GeofenceEngine.kt` | classification + state machine (pure, mirrors `src/lib/geofence.ts`) |
| `data/ShiftConfig.kt`, `data/ConfigBus.kt` | cached shift config and its change signal |
| `data/EventQueue.kt` | durable outbox |
| `ui/AppState.kt`, `ui/StatusModel.kt` | screen routing and status text (pure) |
| `ui/MainActivity.kt`, `ui/PermissionsActivity.kt`, `ui/ActivationActivity.kt`, `ui/SettingsActivity.kt` | screens |

Unit tests (JVM, `./gradlew testDebugUnitTest`): `GeofenceEngineTest`, `CallTrackerTest`, `AppStateTest`, `StatusModelTest`, `AcquisitionPolicyTest`, `MonitoringCoordinatorTest`.
