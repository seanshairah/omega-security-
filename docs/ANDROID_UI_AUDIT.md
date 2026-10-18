# Android UI audit: every control and what it really does

Date: 2026-10-19 · App v1.6.0 (versionCode 7). Produced by inspecting the code before the redesign; nothing here is assumed.

| Control (guard dashboard) | Android handler | Event / data | Backend | Dashboard workflow | Gap found |
|---|---|---|---|---|---|
| **EMERGENCY** | `MainActivity` → `AlertFlow.confirmEmergency` (confirmation dialog = accidental-activation safeguard) → `AlertSender.send(EMERGENCY)` | `GatewayEvent` type `EMERGENCY`, priority EMERGENCY, `message?`, `shiftId`, `location {lat, lng, accuracyM, state, ageSeconds}` from the last fix, `meta {online, battery}`; outbox row + `comm_log` row; `SyncCoordinator.request(EMERGENCY)`; `requestLocationCheck()` in parallel | `POST /api/gateways/events` → `alerts.ts applyAlertEvent` | `GuardAlert` row, CRITICAL notification, shift status CRITICAL, incident EMERGENCY/CRITICAL, acknowledgement returns on the heartbeat `alerts[]` → `comm_log` ACKNOWLEDGED/RESOLVED | None in the pipeline. Before: the dashboard button opened the Alerts screen first (two screens). Now: confirm → send from the dashboard, feedback banner in place. |
| **Need Assistance** | `AlertFlow.askMessage(NEED_ASSISTANCE, optional message)` | type `NEED_ASSISTANCE`, priority HIGH, needs ack | same | WARNING notification, shift ASSISTANCE, check-in WELFARE_ASSISTANCE | none; now in place on the dashboard |
| **Shift Going Well** | `AlertFlow.send(SHIFT_OK)` | type `SHIFT_OK`, NORMAL | same | INFO, check-in GUARD_OK | none |
| **More…** | `AlertsActivity.open(null)` | — | — | incident report, security alert, running late, status update, handover, call operations | none |
| **Check location now** | `GatewayService.requestLocationCheck` → `MonitoringCoordinator.requestCheck` (joins a running check, never cancels) → `LocationMonitor.step` | `LOCATION_CHECK` / `LOCATION_EXIT` / … events; outside a shift the step returns NOT_ON_SHIFT without GPS (unchanged) | `POST /api/gateways/events` → `location-events.ts` | shift timeline, device last location, exits/returns alerts | none |
| **Sync now** | `GatewayService.requestHeartbeat` + `requestSync(MANUAL)` | heartbeat JSON + outbox drain | `POST /api/gateways/heartbeat`, `POST /api/gateways/events` | device online/last-seen, alert acknowledgements, commands (location requests) | none |
| **See all** | `AlertsActivity.open(null)` | `comm_log` rows (alerts, calls, location requests) | — | — | none |
| **Diagnostics** | `SettingsActivity` | sync engine state, last runs, test connection, deactivate | `POST /api/gateways/heartbeat` (test) | — | none |
| **Grant permissions** | `PermissionsActivity` (guard) / system dialog (ops) | `DEVICE_STATUS` meta on next heartbeat | heartbeat | device permission badges | none |
| **Allow running in background** | `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | — | — | — | none |
| Status dot / network / connection line | `resolveAppState`, `DeviceInfo.networkType`, `prefs.lastHeartbeatOk` | — | — | — | none |
| GPS card | `StatusFacts` → `gpsView`, `gpsReasonKind`, `gpsTone`, `gpsStatusWord` (pure, tested) | `prefs.gpsState/gpsReason/lastFix*` written by `LocationMonitor.step` | — | — | none; stats cells added (last check, accuracy vs limit, status + permission) |
| Sync card | `syncView`, `syncTone` | `prefs.syncState`, `EventQueue.counts()` | — | — | none |
| Sent to operations | `EventQueue.recentComm(4)` + `AlertsActivity.commStateText` | `comm_log` | heartbeat `alerts[]` | acknowledgement by name and time | none |

Operations-gateway mode keeps the same cards minus the guard ones; call monitoring uses `CallMonitor.canMonitor / canSeeNumbers` and `comm_log` kind CALL.

## Emergency: the ten requirements, verified in code

1. Existing workflow reused: `AlertSender.send(EMERGENCY)` is the only sender.
2. Safeguard: one confirmation dialog ("SEND EMERGENCY"); buttons also lock for 2.5 s after a tap. No hold timer, no delay.
3. Unique id: `UUID.randomUUID()` as `eventId`; the server deduplicates on it.
4. Association: device by Bearer token, guard from the device, shift from `shiftId` (cached config) or the live shift, site from the shift.
5. Location attached: last fix with accuracy, state and age in seconds.
6. Fresh fix: `requestLocationCheck()` after enqueueing; the alert never waits for it.
7. Durable outbox: `EventQueue.enqueue(..., Priority.EMERGENCY)` before anything else.
8. Immediate sync: `SyncCoordinator.request(Trigger.EMERGENCY)`.
9. Delivery state: QUEUED → SENT → ACKNOWLEDGED/RESOLVED, or FAILED, in `comm_log`, shown on the dashboard and the Alerts screen.
10. Acknowledgement: operations' ack (who, when, note) travels back on the heartbeat and is shown by name.
