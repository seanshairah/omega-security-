# Offline Monitoring (guard phones)

How a guard phone keeps verifying location with no internet, and how the record catches up afterwards. Companion to [OFFLINE_MODE.md](OFFLINE_MODE.md) (the original design) and [AUTO_SYNC.md](AUTO_SYNC.md) (the delivery engine).

## What works offline

| Capability | Needs internet? | Notes |
|---|---|---|
| Knowing the shift, site, radius and policy | No, once cached | Fetched with each heartbeat and on config change (`GET /api/gateways/config`), stored in `ShiftConfig`, versioned |
| GPS fix | No | The GPS receiver needs sky, not data. The network provider helps indoors when a data connection exists but is not required |
| Classifying INSIDE / OUTSIDE / UNKNOWN | No | `GeofenceEngine.classify` on the phone, same rule as the server |
| Exit verification, outside updates, return detection | No | `stepMonitor` state machine on the phone |
| Recording events | No | SQLite outbox, original timestamps |
| Showing the guard the state | No | Dashboard rows: Shift, GPS (with reason), Sync |
| Delivering events, alerts in the portal | Yes | Sync engine on reconnect; the server classifies again and raises alerts with the original times, marked `SYNCED_LATE` |
| Server-side "overdue" alert | n/a | The engine flags a shift as *location verification overdue* when an online phone sends no checks; an offline phone is reported as *device offline* instead, which is explicitly "not the same as leaving the site" |

## Timeline of an outage

1. 21:00 phone loses data. GPS checks continue every 10 min; each result is queued. Dashboard: *GPS: INSIDE SITE* · *Sync: NO INTERNET · 3 event(s) saved on the phone*.
2. 21:40 guard leaves the fence; 21:41 confirmed → `LOCATION_EXIT` queued (`HIGH` priority). 21:44, 21:47… `LOCATION_OUTSIDE` queued.
3. 22:10 back inside → `LOCATION_RETURNED` (29 min outside) queued.
4. 22:30 data returns → `NETWORK_RESTORED` trigger → exit/return/shift-start rows go first, then routine checks. Server stores all with their original times, `SYNCED_LATE`, writes the shift timeline, raises the exit and return alerts once each, and the device panel shows *Up to date*.

## What the portal must not conclude

- *Device offline* (no heartbeat) is a connectivity fact. It is not an exit.
- *GPS unknown* (`poor_accuracy`, `no_fix`, `location_disabled`, `permission_revoked`, `site_has_no_coordinates`, `on_boundary`) is not an exit either.
- *Synced* means delivered, not verified. Verification is the `INSIDE`/`OUTSIDE` on each event and the attendance's `locationVerification`.

## Limits

- Android may still kill the service on aggressive battery managers; WorkManager restarts it within 15 minutes and the outbox survives. See ANDROID_INSTALLATION.md for per-brand settings.
- Without `Allow all the time` location permission, checks stop when the screen is off; the dashboard says so and the app state becomes `PERMISSION_REVOKED`.
- A shift created while the phone is offline is unknown to it until the next successful heartbeat.
