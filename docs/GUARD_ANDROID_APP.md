# Guard Android app (GUARD mode)

The same APK as the operations gateway (`android/`, app name **Security Gateway**). A device registered in the portal with mode *Guard device* and linked to a guard tells the app, at activation, that it is a guard phone. The guard becomes an *Android guard* (`Guard.deviceKind = ANDROID_GUARD`); the SMS workflow continues unchanged for them.

## What it does

| Function | Implementation |
| --- | --- |
| Identity | Activation code → device token (hashed on the server) stored in `EncryptedSharedPreferences`; the server returns `mode: GUARD` and the guard's name. |
| Permission onboarding | `PermissionsActivity`: plain-language cards for Location, Location all the time, Phone and call log, Notifications, Run in background; shows what is and is not collected. Monitoring does not start until location is granted. |
| Shift configuration | `GET /api/gateways/config` with every heartbeat → `ShiftConfig` cached on the phone: shift window, site coordinates, radius, intervals. |
| Location monitoring | `LocationMonitor` in the foreground service: one fix per check from `LocationManager` (GPS, then network, then last-known under 2 min), local `classify`, `stepMonitor` state machine, events to the outbox. Starts 10 min before the shift, stops 30 min after. |
| Exit / return | First outside reading → verify after 60 s → `LOCATION_EXIT`; `LOCATION_OUTSIDE` every 3 min while outside; `LOCATION_RETURNED` with duration outside. |
| Unavailable | `LOCATION_UNAVAILABLE` with `permission_revoked`, `location_disabled`, `no_fix`, `poor_accuracy`, `site_has_no_coordinates`. |
| Calls | Same `CallTracker` as the gateway. In guard mode every call event carries the latest fix (`location {latitude, longitude, locationState}`) and a `LOCATION_CALL` event refreshes the fix around the call. |
| Heartbeat | Battery, network, app and Android version, location and phone permission state, monitoring state, mock flag, last fix. |
| Offline | Everything above works with no internet; see [OFFLINE_MODE.md](OFFLINE_MODE.md). |
| Restart | Boot receiver and app-update receiver restart the service; WorkManager every 15 minutes as a fallback. |
| Screen | Status (🟢/🔴), mode and guard name, shift and site radius, monitoring state (INSIDE SITE, OUTSIDE READING · verifying, OUTSIDE SITE, LOCATION UNAVAILABLE, MONITORING OFFLINE, WAITING FOR SHIFT, NOT ON SHIFT), last check with distance and accuracy, location permission state, plus the common device rows. |

## Files

```
android/app/src/main/kotlin/zw/co/omega/gateway/
  geofence/GeofenceEngine.kt   pure classification + state machine (JVM-tested)
  location/LocationMonitor.kt  fixes, observations, outbox events, last-fix cache
  data/ShiftConfig.kt          cached config from the server
  ui/PermissionsActivity.kt    onboarding
  service/GatewayService.kt    monitorLoop() next to heartbeatLoop() and the sync loop
```

## Android restrictions that apply

- **Background location** (Android 10+) is a separate grant; on Android 11+ it can only be given from the app's Settings page ("Allow all the time"). Without it checks run only while the app is open; the app shows this on screen and reports `foreground_only` to the portal.
- **Foreground service** with type `location` (Android 14+ requires it and the `FOREGROUND_SERVICE_LOCATION` permission) and a permanent notification. The notification text shows the monitoring state.
- **Doze and manufacturer battery managers** can delay a check by minutes. The engine's "overdue" alert fires only after two missed intervals; the installation guide covers the per-brand settings.
- **No Play Services** are required; the platform `LocationManager` is used so old phones without Google services still work. Fix quality is then whatever the phone's GNSS gives.
- **Mock locations** are flagged, not blocked.

## What it does not do

No audio, no continuous tracking, no tracking outside shifts, no contacts or messages, no camera. The onboarding screen says so.
