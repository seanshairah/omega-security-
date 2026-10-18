# Automatic Sync Engine (guard and gateway phones)

The sync engine moves events from the phone's durable outbox to the server. It is a separate system from GPS monitoring: it never reads or changes location state, and a location check never cancels a sync (and vice versa). **Sync now** and **Check location now** are different buttons that talk to different coordinators.

## 1. Principles

- **Durable first.** Every event (call, location, later emergency) is written to SQLite before anything else. A row leaves the outbox only when the server acknowledges it with `ok` or `duplicate`.
- **Original time is kept.** Each event carries the moment it happened (`timestamp`). The server records when it *received* it and derives `LIVE` (≤ 2 min), `SYNCED` (≤ 10 min) or `SYNCED_LATE`. A late event is still the truth about that moment; it is never re-dated.
- **Idempotent.** `eventId` is unique per event. Re-sending after a lost response is harmless: the server answers `duplicate`.
- **Sync ≠ verification.** "Up to date" means the phone has nothing left to send. It says nothing about whether the guard is on site; that is the GPS row.
- **Offline ≠ outside.** No internet shows as *NO INTERNET · n saved on the phone*, never as a location problem.

## 2. Outbox (SQLite `outbox`, schema v2)

| Column | Meaning |
|---|---|
| `eventId` (unique) | idempotency key |
| `json` | the event, with its original timestamp |
| `eventType`, `priority` | `EMERGENCY` (2) > `HIGH` (1: exits, returns, shift start, calls) > `NORMAL` (0: routine checks) |
| `status` | `QUEUED` → `SENDING` → (deleted on ack) · `RETRY_PENDING` after a failure · `FAILED` when the server rejected it as malformed |
| `attempts`, `lastAttemptAt`, `nextAttemptAt`, `lastError` | retry bookkeeping |
| `sendingSince` | crash recovery: a row still `SENDING` after 5 min, or any `SENDING` row at service start, is sent again |

v1 databases (first release) upgrade in place: existing rows become `QUEUED` / `NORMAL`. `FAILED` rows are kept seven days for diagnostics, then purged.

Server-side statuses on each stored event (`LocationEvent.syncStatus`): `LIVE`, `SYNCED`, `SYNCED_LATE`.

## 3. Triggers

| Trigger | Fired by |
|---|---|
| `ACTIVATION` | right after the activation code is exchanged for a token |
| `APP_START` | the service's first run (process start, boot, update) |
| `NETWORK_RESTORED` | the default network becoming available |
| `CONFIG_CHANGED` | a changed shift/site config arriving (the monitoring coordinator wakes on the same signal) |
| `NEW_EVENT` | every enqueue (location check result, call event) |
| `EMERGENCY` | reserved for the Phase 2 emergency module (highest priority, backoff capped at 60 s) |
| `SCHEDULED` | periodic tick (heartbeat interval, 1–15 min) |
| `RETRY` | the earliest `nextAttemptAt` among waiting rows |
| `MANUAL` | **Sync now** on the dashboard or Settings |
| `WORKER` | WorkManager fallback every 15 min when the service was killed |

Requests coalesce: one run at a time; a trigger arriving mid-run is remembered (the stronger one wins) and a fresh run follows immediately.

## 4. One run (`SyncEngine.syncOnce`)

1. Skip (and log) when not activated or offline.
2. Take up to 100 **due** rows: highest priority first, oldest first within a priority; `FAILED` never; `RETRY_PENDING` only once `nextAttemptAt` has passed.
3. Mark them `SENDING`, POST `/api/gateways/events`.
4. Per acknowledgement: `ok`/`duplicate` → delete the row; `rejected` → `FAILED` with the server's reason; not mentioned → `RETRY_PENDING` with backoff.
5. Transport or HTTP error → the whole batch goes to `RETRY_PENDING` with backoff; 401/403 marks the device revoked and stops.
6. Repeat while rows are due. Every run writes one `sync_log` row (trigger, online, sent, acked, duplicates, rejected, retried, error, duration).

Backoff per row: 5 s · 15 s · 45 s · 2¼ min · … capped at 15 min (60 s for emergency rows). Rows are never dropped for failing; only after 500 attempts is one marked `FAILED`.

A process-wide lock keeps the foreground service and the WorkManager fallback from sending the same rows at once.

## 5. What the phone shows

Dashboard **Sync** row (from `SyncPlanner.syncState`):

| State | Text |
|---|---|
| `SYNCED` | UP TO DATE · last event sent 14:02 |
| `SENDING` | SENDING · n event(s) |
| `QUEUED` | QUEUED · n event(s) waiting · sent automatically |
| `QUEUED_OFFLINE` | NO INTERNET · n event(s) saved on the phone, sent automatically later |
| `RETRY_PENDING` | RETRYING · n event(s) · <last error> |
| `SYNCED_WITH_FAILURES` | UP TO DATE · some events were rejected by the server (see Settings) |
| `REVOKED` | DEVICE REVOKED · nothing is sent |

**Last heartbeat** is shown separately from **Last event sync**: a heartbeat proves the server is reachable, not that events were delivered.

Settings → **Sync engine**: state, queued / sending / retry / failed counts, last successful sync, last attempt and its trigger, next retry time, last error, and the last 15 runs from `sync_log`.

## 6. What the server stores and shows

Every heartbeat carries `syncState`, `queuedEvents`, `failedEvents`, `oldestPendingSeconds`, `lastEventSyncAt`, `lastSyncAttemptAt`, `lastSyncError`, `lastSyncTrigger` (and the separated `shiftState`, `gpsState`, `gpsReason`). They are stored on `GatewayDevice` (migration `20261018150000_device_sync_diagnostics`) and shown on the device page's panel as a **Sync** row, next to, not mixed with, the monitoring row.

Per-event delivery delay remains visible on each location event (`LIVE` / `SYNCED` / `SYNCED LATE` badges on the shift timeline and reports).

## 7. Testing

- JVM: `SyncPlannerTest` (backoff, acks, priorities, due rules, state wording), `SyncCoordinatorTest` (coalescing, retry wake-up, failure survival).
- Server: `scripts/dev/gateway-e2e.ts` and `scripts/dev/location-e2e.ts` cover acks, duplicates, late sync status and the SMS regression.
- Device-only (unverified until run on hardware): airplane mode for a shift segment, then reconnect → events arrive `SYNCED_LATE` with original times; kill the app mid-sync → rows resume from `SENDING`; revoke the device → `REVOKED` on the phone, nothing sent.
