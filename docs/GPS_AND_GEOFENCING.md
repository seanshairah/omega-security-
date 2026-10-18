# GPS and geofencing

## What is measured

Each fix carries: latitude, longitude, accuracy (metres, 68% confidence), provider (gps or network), speed and bearing when available, the phone's timestamp, and whether a mock provider was used. The phone computes the distance to the site centre and classifies the fix; the server recomputes the distance from the site it knows and makes the final classification (`src/lib/gateway/location-events.ts`).

GPS is not exact. Urban canyons, roofs, cheap receivers and cold starts give 10 to 200 metre errors. The system therefore never decides on a fix whose accuracy circle overlaps the fence.

## Classification (server `classifyFix`, phone `classify`)

```
distance = haversine(fix, site centre)
if accuracy > accuracyMaxM            → UNKNOWN (poor_accuracy)
if distance + accuracy <= radius      → INSIDE
if distance - accuracy  > radius      → OUTSIDE
otherwise                             → UNKNOWN (on_boundary)
```

Settings → GPS and geofencing → *Worst usable GPS accuracy* (default 100 m). Site radius is per site (50/100/150/250/500 or custom, default 150 m).

## Monitoring state machine (shared logic, tested on both sides)

`src/lib/geofence.ts → stepMonitor` and `android/.../geofence/GeofenceEngine.kt → stepMonitor` implement the same transitions; `tests/geofence.test.ts` and `GeofenceEngineTest.kt` run the same section-50 timeline.

| State | Meaning | Next check |
| --- | --- | --- |
| `NOT_ON_SHIFT` | no shift cached, or it ended more than 30 min ago; no GPS use | 15 min (config refresh) |
| `WAITING_FOR_SHIFT` | a shift is cached; monitoring starts 10 min before it | until start |
| `MONITORING` | inside the site; `LOCATION_CHECK` recorded | `geofence.checkMinutes` (10) |
| `VERIFYING_OUTSIDE` | first outside reading; nothing recorded yet | `geofence.verifySeconds` (60) |
| `OUTSIDE` | second outside reading confirmed → `LOCATION_EXIT`; then throttled `LOCATION_OUTSIDE` updates | `geofence.outsideCheckMinutes` (3) |
| `LOCATION_UNAVAILABLE` | no usable fix; `LOCATION_UNAVAILABLE` recorded once with a reason | 5 min |
| `OFFLINE_MONITORING` | display state: monitoring continues, events wait in the outbox | as above |
| `SYNCING` | display state while the outbox drains | — |

A single outside reading followed by an inside one creates nothing. Returning inside from `OUTSIDE` records `LOCATION_RETURNED` with `durationOutsideSeconds` measured from the first outside reading.

## Server-side rules

- **SMS + GPS verification.** When the guard's YES is processed (existing pipeline) the hook `verifyArrivalFromSms` looks for a usable fix within ±20 minutes; the first usable fix after a confirmation also triggers it. Result on `Attendance.locationVerification`: `VERIFIED` (inside), `EXCEPTION` (outside; alert "Location exception … verify by phone"), `UNAVAILABLE`, or `NOT_APPLICABLE` for feature-phone guards. Attendance status itself is unchanged by GPS.
- **Alerts.** `LOCATION_EXIT` warning once per exit, `LOCATION_RETURNED` info, `LOCATION_UNAVAILABLE` at most once an hour per shift, `LOCATION_EXTENDED` critical once per exit after `geofence.escalationMinutes` (10) without a return, `LOCATION_OVERDUE` when an online phone has sent no check for `geofence.overdueIntervals` × `checkMinutes`, `LOCATION_INTEGRITY` once per device when a mock provider is seen, `DEVICE_OFFLINE` / `DEVICE_LOW_BATTERY` from heartbeats.
- **Timeline.** Each event becomes a `ShiftCheckIn` (`LOCATION_INSIDE` throttled to one line per 25 minutes, `LOCATION_EXIT`, `LOCATION_OUTSIDE`, `LOCATION_RETURNED`, `LOCATION_UNAVAILABLE`, `LOCATION_OVERDUE`, `LOCATION_VERIFIED`, `LOCATION_EXCEPTION`) so the shift page reads as one story with the SMS and call entries.
- **Retention.** `geofence.locationRetentionDays` (180) deletes old `LocationEvent` rows; timeline lines stay with the shift.

## Battery and data

One fix per check (GPS with a 45 s budget, then network provider, then a last-known fix under two minutes old). Ten-minute checks inside, three-minute while outside, one-minute verification only after an outside reading. No streaming. A normal twelve-hour shift inside the site produces about 72 fixes and 72 events of roughly 300 bytes each.

## Spoofing

Android apps can fake a location with a mock provider. The app records `Location.isMock` (API 31+) / `isFromMockProvider` and the server stores `mock` on the event and `mockLocationSeen` on the device, raising a *Location integrity warning* once. This is a warning, not proof: rooted phones can hide mocking. Accuracy, provider and timestamps are kept for review. The system makes no anti-spoofing guarantee.


## Stage 4 checklist (Phase 2)

| Requirement | Where | Status |
|---|---|---|
| Periodic shift location checks | `MonitoringCoordinator` + `LocationMonitor.step`, interval from the policy (`geofence.checkMinutes`) | done |
| Local GPS classification | `GeofenceEngine.classify`, accuracy-aware, same rule as the server | done |
| Configurable geofence radius | site radius (map picker) or shift override, versioned config | done |
| Consecutive-fix exit verification | `VERIFYING_OUTSIDE` needs a second outside reading at least `verifySeconds` later; a single reading never exits (test) | done |
| `LOCATION_EXIT`, `LOCATION_OUTSIDE`, `LOCATION_RETURNED` | state machine on the phone, re-checked by the server | done |
| Accurate UNKNOWN states | `poor_accuracy`, `no_fix`, `location_disabled`, `permission_revoked`, `site_has_no_coordinates`, `on_boundary`; UNKNOWN never changes an INSIDE/OUTSIDE verdict (test) | done |
| Location unavailable events | emitted once per unavailable spell, server alert at most hourly | done |
| Battery-efficient monitoring | single fix per check, early stop at ≤ 25 m, 60 s cap; routine checks doubled (max 30 min) while inside with battery ≤ 20 % (`adjustForBattery`, test); exit/outside cadence unchanged; dashboard says "battery low, checking every n min" | done |
| Offline local recording | SQLite outbox, original timestamps | done |
| Automatic sync through the shared outbox | one `SyncCoordinator`; alerts (Stage 5) use the same path; no second engine | done |
