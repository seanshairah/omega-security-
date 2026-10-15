# Android call gateway

> The same app now has two modes: **OPERATIONS_GATEWAY** (this page) and **GUARD** ([GUARD_ANDROID_APP.md](GUARD_ANDROID_APP.md): GPS, geofencing, offline monitoring). The mode comes from the device record in the portal at activation.

The call gateway is an Android app (`android/`, package `zw.co.omega.gateway`, app name **Security Gateway**) installed on a company phone with a SIM that guards call. It reports **call metadata only** (number, direction, timestamps, duration, outcome) to the portal, where calls are matched to guards and their live shifts. It never records audio.

It is a separate module from the SMS system. The two share nothing but the database: if every gateway phone is switched off, SMS sending, receiving, templates, automation and attendance continue exactly as before.

```
GUARD ──(voice call)──▶ GATEWAY PHONE ──(HTTPS, JSON events)──▶ /api/gateways/events ──▶ CallLog ──▶ dashboard
                                                                        ▲
                                              offline? events wait in SQLite outbox on the phone
```

## What the app does

| Function | How |
| --- | --- |
| Register | Admin creates the device in **Gateway phones → Register**; the app exchanges the 6-character activation code for a device token (`POST /api/gateways/activate`). The token is stored in `EncryptedSharedPreferences`; only its SHA-256 hash is stored server-side. |
| Heartbeat | Every `gateway.heartbeatSeconds` (default 120 s, set in Settings → Call gateway) the service posts battery, network type, app and Android version to `/api/gateways/heartbeat`. The response carries the current interval, so changing the setting reaches the phones within one heartbeat. |
| Detect calls | A dynamic `PHONE_STATE` receiver inside the foreground service plus a manifest receiver as backup. Transitions RINGING → OFFHOOK → IDLE are reduced by `CallTracker` into `CALL_STARTED`, `CALL_ANSWERED`, `CALL_ENDED` / `CALL_MISSED`. After the call ends the app reads the system call log (2.5 s later) for the authoritative outcome and duration. |
| Queue offline | Every event is written to a SQLite outbox (`EventQueue`) before anything is sent. It is deleted only after the server acknowledges it as `ok` or `duplicate`. |
| Sync | The service drains the outbox when an event is queued, when the network comes back (`ConnectivityManager` callback) and on a backoff timer (5 s → 15 s → 45 s … max 15 min). A WorkManager job every 15 minutes is the safety net if the service was killed. |
| Survive restarts | `BootReceiver` restarts the service after `BOOT_COMPLETED`, `LOCKED_BOOT_COMPLETED` and app updates. |
| Show status | Dashboard screen: 🟢 ONLINE / 🔴 OFFLINE, device name, location, phone number, last sync, battery, network, app version, last call, connection status. Settings screen: server URL, device id, heartbeat, queued events, last error, Test connection, Deactivate device. |

## Event contract

`POST /api/gateways/events` with `Authorization: Bearer <deviceToken>`:

```json
{ "events": [
  { "eventId": "6b7c…", "eventType": "CALL_STARTED",  "callId": "9f1a…", "phoneNumber": "0771234567", "direction": "INCOMING", "timestamp": "2026-10-15T20:14:03.120Z" },
  { "eventId": "6b7d…", "eventType": "CALL_ANSWERED", "callId": "9f1a…", "timestamp": "2026-10-15T20:14:09.000Z" },
  { "eventId": "6b7e…", "eventType": "CALL_ENDED",    "callId": "9f1a…", "timestamp": "2026-10-15T20:17:51.000Z", "durationSeconds": 222, "answered": true }
] }
```

Response: `{ "ok": true, "acks": [ { "eventId": "…", "status": "ok" | "duplicate" | "rejected", "callLogId": "…", "error": "…" } ] }`.

Event types today: `CALL_STARTED`, `CALL_ANSWERED`, `CALL_ENDED`, `CALL_MISSED`, `DEVICE_ONLINE`, `DEVICE_OFFLINE`. New types are added by extending `GatewayEventType` in `src/lib/gateway/call-state.ts` and a branch in `processGatewayEvents`; unknown types are rejected per event, never the whole batch.

- `eventId` is generated on the phone (UUID) and is unique in `GatewayEvent`, so a retry after a lost acknowledgement is answered `duplicate`.
- `callId` is one UUID per call; all its events fold into one `CallLog` row (`@@unique([gatewayDeviceId, callId])`).
- Timestamps come from the phone's clock and are clamped to [now − 7 days, now + 5 min] on the server. Events in a batch are replayed in timestamp order, so a drained offline queue still produces the right final state.
- The reducer (`reduceCall`) never regresses a finished call: a late `CALL_STARTED` after `ENDED` is a no-op.

## Backend pieces

| File | Role |
| --- | --- |
| `src/lib/gateway/auth.ts` | activation codes, token generation and hashing, Bearer authentication, in-memory rate limiting |
| `src/lib/gateway/service.ts` | create / activate / heartbeat / update / disable / revoke; `effectiveStatus`; `gatewayMaintenance` (offline detection, stale calls, retention) |
| `src/lib/gateway/call-state.ts` | pure call state machine, status labels, duration formatting |
| `src/lib/gateway/events.ts` | validation, dedupe, guard matching, shift association, timeline entries, missed-call and unknown-caller alerts, unknown-caller resolution |
| `src/lib/gateway/calls.ts` | queries for lists, live calls, metrics, CSV |
| `src/lib/gateway/simulate.ts` | the simulator builds the same event the phone would send |
| `src/lib/automation/engine.ts` | step 11 calls `gatewayMaintenance` in its own try/catch |

Guard matching: the caller number is normalised with the existing `normalisePhone` (so `0771234567`, `263771234567` and `+263 77 123 4567` all become `+263771234567`) and must equal exactly one guard's phone. Anything else is an **unknown caller**; nothing is assigned automatically. A matched guard's live shift is found with the existing `findLiveShiftForGuard` (same rule the SMS pipeline uses), and the call inherits the shift's location and client; otherwise the gateway's own location. Calls on a live shift appear on the shift timeline as `CALL_INCOMING`, `CALL_ANSWERED`, `CALL_ENDED` or `CALL_MISSED`.

A call proves that a number reached the gateway phone. It does not prove the guard is on site. Attendance still comes from the SMS confirmations.

## Android version notes (what really works)

- **Incoming number.** Since Android 9 the number in the `PHONE_STATE` broadcast is only delivered to apps holding `READ_CALL_LOG`. The app asks for `READ_PHONE_STATE` and `READ_CALL_LOG` on first launch. Without `READ_CALL_LOG` calls are still detected but arrive as "unknown number".
- **Outgoing calls.** `NEW_OUTGOING_CALL` is deprecated since Android 10; the app still listens to it on older phones and otherwise treats OFFHOOK-without-RINGING as an outgoing call, taking the dialled number from the call log afterwards.
- **Background.** A foreground service with a permanent low-priority notification is mandatory (Android 8+). On Android 14+ it is declared as `specialUse` with an explanation property. Manufacturer battery managers (Xiaomi, Huawei, Oppo, Samsung) can still kill it; the WorkManager job revives it every 15 minutes, and the installation guide explains the per-brand settings.
- **Boot.** `RECEIVE_BOOT_COMPLETED` is honoured on stock Android once the app has been opened at least once. Some brands require "Auto-start" to be enabled in their own settings.
- **Android 15** forbids starting *some* foreground-service types from boot broadcasts; `specialUse` is not among them.
- **Play Store.** `READ_CALL_LOG` is a restricted permission on Google Play. The APK is side-loaded, so this does not apply.
- The app does not use `CallScreeningService` or the default-dialer role, so it never interferes with answering calls.

## Privacy

Only call metadata is collected: number, direction, timestamps, duration, outcome, which gateway. No audio, no contacts, no messages, no location. The app shows this on its first screen.

## Security

- HTTPS is enforced by the app (plain HTTP only for `localhost`/emulator addresses).
- Device tokens are 256-bit random, shown once, stored hashed; revoking deletes the hash so the phone gets 403 immediately.
- `POST /api/gateways/activate` is rate-limited per IP (10/min), heartbeats 30/min and events 120/min per device. The limiter is in-memory per server instance, so on Vercel treat it as a brake on abuse rather than a precise quota.
- Every create / activate / heartbeat-after-offline / update / disable / revoke / simulate is in the audit log.
