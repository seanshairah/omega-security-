# REST API

All routes live under `src/app/api/*`. Unless stated otherwise they require the portal session cookie (`omega_session`, set by `POST /api/auth/login`) and are wrapped by `guarded(minimumRole, handler)` which returns `401` (not signed in), `403` (role too low), `404` or `400 { "error": "…" }`. Roles rank `SUPERVISOR < ADMIN < SUPER_ADMIN`. Pagination: `?page=&limit=` (max 200).

Device routes (gateway phones) use `Authorization: Bearer <deviceToken>` instead of the cookie.

## Existing routes (unchanged)

| Method | Route | Role | Purpose |
| --- | --- | --- | --- |
| POST | `/api/auth/login`, `/api/auth/logout` | — | session |
| GET/POST | `/api/guards`, `/api/guards/[id]`, `/api/guards/[id]/deactivate` | SUPERVISOR / ADMIN | guards |
| GET/POST | `/api/clients`, `/api/clients/[id]`, `/api/locations`, `/api/locations/[id]` | SUPERVISOR / ADMIN | clients and sites |
| GET/POST | `/api/shifts`, `/api/shifts/[id]`, `/api/shifts/active`, `/api/shifts/recurring` | SUPERVISOR / ADMIN | shifts |
| GET | `/api/attendance`, `/api/reports/attendance.csv`, `/api/reports/performance` | SUPERVISOR | attendance and reports |
| GET/POST | `/api/incidents`, `/api/incidents/[id]` | SUPERVISOR | incidents |
| GET/POST | `/api/sms/messages`, `/api/sms/send`, `/api/sms/simulate` | ADMIN | SMS log, manual send, simulator |
| POST | `/api/sms/webhook/[provider]` | provider signature | inbound SMS and delivery reports |
| GET/PUT | `/api/templates`, `/api/settings` | ADMIN / SUPER_ADMIN | templates, settings |
| GET/POST | `/api/notifications`, `/api/notifications/[id]/read`, `/api/push/subscribe` | SUPERVISOR | notifications, web push |
| GET | `/api/audit`, `/api/users`, `/api/users/[id]` | SUPER_ADMIN | audit log, users |
| GET/POST | `/api/automation/tick` | `AUTOMATION_SECRET` / `CRON_SECRET` / admin | engine tick |
| GET | `/api/health` | — | liveness |

## Gateway device routes (new)

### POST /api/gateways/activate — public, rate-limited 10/min per IP

Request:
```json
{ "activationCode": "A8F42X", "appVersion": "1.0.0", "androidVersion": "13 (API 33)", "deviceModel": "Samsung SM-A105F", "batteryLevel": 78, "networkType": "mobile" }
```
Response `200`:
```json
{ "deviceId": "cmv…", "deviceToken": "gw_…", "deviceName": "Control Room Phone 01", "phoneNumber": "+263772100100",
  "location": { "id": "cmv…", "name": "ABC Warehouse", "client": "ABC Logistics" },
  "config": { "heartbeatSeconds": 120, "offlineMinutes": 5, "serverTime": "2026-10-15T10:00:00.000Z" } }
```
Errors `400`: `Activation code not recognised`, `Activation code has expired…`, `This gateway has been revoked`. `429` with `Retry-After` when rate-limited. The token is returned once; the server keeps only its hash.

### POST /api/gateways/heartbeat — Bearer device token, 30/min per device

Request: `{ "appVersion", "androidVersion", "deviceModel", "batteryLevel": 77, "networkType": "mobile", "timestamp" }` (all optional).
Response: `{ "ok": true, "deviceId", "deviceName", "phoneNumber", "status": "ONLINE", "location": {…}|null, "configVersion": "3.1"|null, "config": { "heartbeatSeconds", "offlineMinutes", "serverTime" } }`.

Optional request fields reported by the app (all stored on the device record, shown on the device page): `configVersion` (the shift config the phone applied), `shiftState` (`NONE|UPCOMING|ACTIVE`), `gpsState`, `gpsReason`, `syncState` (`SYNCED|SENDING|QUEUED|QUEUED_OFFLINE|RETRY_PENDING|SYNCED_WITH_FAILURES|REVOKED`), `queuedEvents`, `failedEvents`, `oldestPendingSeconds`, `lastEventSyncAt`, `lastSyncAttemptAt`, `lastSyncError`, `lastSyncTrigger`, plus the earlier `monitoringState`, `mockLocation` and `lastLocation`. See AUTO_SYNC.md.
`401` unknown/inactive token · `403` revoked or disabled device.

### POST /api/gateways/events — Bearer device token, 120/min per device

Request: `{ "events": [ …up to 200… ] }` (a bare array or a single object is also accepted). Event fields: `eventId` (required, unique), `eventType` (`CALL_STARTED` `CALL_ANSWERED` `CALL_ENDED` `CALL_MISSED` `DEVICE_ONLINE` `DEVICE_OFFLINE`), `callId` (required for call events), `phoneNumber`, `direction` (`INCOMING` default | `OUTGOING`), `timestamp` ISO-8601, `durationSeconds`, `answered`.
Response: `{ "ok": true, "acks": [ { "eventId", "status": "ok"|"duplicate"|"rejected", "callLogId"?, "error"? } ] }`. The phone deletes a queued event on `ok` or `duplicate`, and drops it on `rejected` (malformed).

### Admin routes

| Method | Route | Role | Body / notes |
| --- | --- | --- | --- |
| GET | `/api/gateways` | SUPERVISOR | `{ items: [GatewayDevice with location, status = effective ONLINE/OFFLINE] }` (token hash and code never returned) |
| POST | `/api/gateways` | ADMIN | `{ deviceName, phoneNumber, locationId?, notes? }` → `201` device with `activationCode` |
| GET | `/api/gateways/[id]` | SUPERVISOR | device + last 20 calls |
| PATCH | `/api/gateways/[id]` | ADMIN | `{ deviceName?, phoneNumber?, locationId?: string|null, notes?, disabled?: boolean }` |
| POST | `/api/gateways/[id]/code` | ADMIN | new activation code (pending device or replaced phone); invalidates the token |
| POST | `/api/gateways/[id]/revoke` | ADMIN | `{ reason? }` → permanent; token deleted |
| POST | `/api/gateways/simulate` | ADMIN | `{ gatewayId, eventType, phoneNumber?, callId?, direction?, durationSeconds?, answered?, at? }` → `{ callId, ack }`; identical processing to the phone |

## Call routes (new)

| Method | Route | Role | Notes |
| --- | --- | --- | --- |
| GET | `/api/calls` | SUPERVISOR | filters `from,to,guardId,locationId,clientId,gatewayId,status,direction,unknown=true|false,q`; returns `{ items, total, page, metrics }` |
| GET | `/api/calls/[id]` | SUPERVISOR | one call with guard, location, client, gateway, shift |
| GET | `/api/guards/[id]/calls` | SUPERVISOR | a guard's calls, newest first |
| GET | `/api/reports/calls.csv` | SUPERVISOR | same filters as `/api/calls`; CSV download |

`metrics`: `{ total, incoming, outgoing, missed, answered, unknown, avgDurationSeconds }`.

## Examples

```bash
# activate (from the phone)
curl -X POST https://portal/api/gateways/activate -H 'content-type: application/json' -d '{"activationCode":"A8F42X","appVersion":"1.0.0"}'

# post a call (replace TOKEN)
curl -X POST https://portal/api/gateways/events -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"events":[{"eventId":"e1","eventType":"CALL_STARTED","callId":"c1","phoneNumber":"0771234567","timestamp":"2026-10-15T20:14:03Z"}]}'

# list missed calls this week (portal session cookie)
curl "https://portal/api/calls?status=MISSED&from=2026-10-13T00:00:00Z" -b "omega_session=…"
```
