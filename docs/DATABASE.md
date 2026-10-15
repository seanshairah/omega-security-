# Database

PostgreSQL via Prisma 6. Schema: `prisma/schema.prisma`; migrations: `prisma/migrations/*` (apply with `npx prisma migrate deploy`, or `npx tsx scripts/neon-migrate.ts` over HTTPS when port 5432 is blocked).

## Existing tables relevant to calls

| Table | Used for |
| --- | --- |
| `Guard` | matched by `phone` (unique, stored in E.164). New back-relation `callLogs`. |
| `Location` / `Client` | a call inherits the live shift's site and client, else the gateway's site. New back-relations `gateways`, `callLogs`. |
| `Shift` | the live shift at the time of the call (`findLiveShiftForGuard`: non-closed shift whose window 2 h before start → 3 h after end contains the call). New back-relation `callLogs`. |
| `ShiftCheckIn` | shift timeline. `CheckInType` gained `CALL_INCOMING`, `CALL_OUTGOING`, `CALL_ANSWERED`, `CALL_ENDED`, `CALL_MISSED`. |
| `Notification` | `type` strings `MISSED_CALL`, `UNKNOWN_CALLER`, `GATEWAY_OFFLINE` added (column is free text). |
| `Setting` | keys `gateway.heartbeatSeconds`, `gateway.offlineMinutes`, `gateway.callRetentionDays`, `gateway.unknownCallerAlert`, `gateway.missedCallAlert` (defaults in `src/lib/settings.ts`, created on `npm run db:seed`). |
| `AuditLog` | `GATEWAY_*`, `CALL_*`, `CALLER_*` actions. |
| `SmsMessage`, `MessageTemplate`, `Attendance`, `WelfareCheck`, `Incident`, `User` | unchanged. |

No existing column was renamed, retyped or removed.

## New tables (migration `20261015080000_call_gateway`)

### GatewayDevice

| Column | Notes |
| --- | --- |
| `id` | cuid |
| `deviceName`, `phoneNumber` (E.164), `locationId?` | registration |
| `status` `GatewayStatus` | `ONLINE` / `OFFLINE` (from heartbeats and the engine) / `DISABLED` / `REVOKED` |
| `activationStatus` `GatewayActivation` | `PENDING` → `ACTIVE` → `REVOKED` |
| `activationCode?` (unique), `activationExpiresAt?`, `activatedAt?` | the 6-character code, cleared on activation |
| `tokenHash?` (unique), `tokenIssuedAt?` | SHA-256 of the device token; the token itself is never stored |
| `lastSeenAt?`, `lastIp?`, `androidVersion?`, `appVersion?`, `deviceModel?`, `batteryLevel?`, `networkType?`, `lastCallAt?` | from heartbeats and events |
| `notes?`, `createdAt`, `updatedAt`, `revokedAt?`, `disabledAt?` | |

Indexes: `status`, `locationId`, `lastSeenAt`.

### GatewayEvent

Raw, append-only record of every event a device sends. `eventId` is **unique**: the dedupe key. Columns: `eventId`, `gatewayDeviceId`, `eventType`, `callId?`, `phoneNumber?`, `occurredAt` (device time, clamped), `receivedAt`, `payload` JSON, `outcome` (what the reducer did, e.g. `RINGING → ANSWERED`). Indexes: `(gatewayDeviceId, receivedAt)`, `eventType`.

### CallLog

One row per call. **Unique `(gatewayDeviceId, callId)`** so repeated or out-of-order state events update the same row.

| Column | Notes |
| --- | --- |
| `callId` | from the phone, one per call |
| `gatewayDeviceId` | |
| `guardId?`, `locationId?`, `clientId?`, `shiftId?` | association at creation time |
| `phoneNumber` (as reported), `normalizedPhoneNumber` (E.164 via `normalisePhone`) | |
| `direction` `CallDirection` | `INCOMING` / `OUTGOING` |
| `status` `CallStatus` | `RINGING` → `ANSWERED` → `ENDED`; or `MISSED`; `FAILED` (outgoing not answered); `UNKNOWN` (no end event within 30 min) |
| `startedAt`, `answeredAt?`, `endedAt?`, `durationSeconds?` | |
| `unknownCaller`, `unknownResolution?` (`LINKED` / `IGNORED` / `BLOCKED`) | |
| `simulated` | true for simulator events |
| `note?` | set by "Mark handled" |

Indexes: `startedAt`, `status`, `(guardId, startedAt)`, `(locationId, startedAt)`, `normalizedPhoneNumber`, `unknownCaller`.

## Guard devices and GPS (migration `20261015120000_guard_devices_geofence`)

| Change | Notes |
| --- | --- |
| `Location.geofenceRadiusM` Int default 150 | with the existing `latitude`/`longitude` |
| `Guard.deviceKind` `GuardDeviceKind` (`FEATURE_PHONE` default, `ANDROID_GUARD`) | set automatically when a guard device is activated or revoked |
| `GatewayDevice.mode` `DeviceMode` (`OPERATIONS_GATEWAY` default, `GUARD`), `guardId?`, `locationPermission?`, `callPermission?`, `monitoringState?`, `mockLocationSeen`, `lastLatitude?`, `lastLongitude?`, `lastAccuracyM?`, `lastLocationAt?`, `lastLocationState?` | one app, two modes |
| `Attendance.locationVerification` `LocationVerification` (`NOT_APPLICABLE` default, `VERIFIED`, `EXCEPTION`, `UNAVAILABLE`), `locationVerifiedAt?` | SMS + GPS correlation |
| `CallLog.latitude?`, `longitude?`, `locationState?`, `correlatedCallId?` | guard-device calls carry a fix; gateway↔guard calls link both ways |
| `CheckInType` + `LOCATION_VERIFIED`, `LOCATION_EXCEPTION`, `LOCATION_INSIDE`, `LOCATION_EXIT`, `LOCATION_OUTSIDE`, `LOCATION_RETURNED`, `LOCATION_UNAVAILABLE`, `LOCATION_OVERDUE` | timeline |
| `Setting` keys `geofence.*` | policy |

### LocationEvent

| Column | Notes |
| --- | --- |
| `eventId` unique | dedupe key from the phone |
| `gatewayDeviceId`, `guardId?`, `shiftId?`, `locationId?` | association at intake |
| `eventType` `LocationEventType` | `SHIFT_STARTED`, `LOCATION_CHECK`, `LOCATION_EXIT`, `LOCATION_OUTSIDE`, `LOCATION_RETURNED`, `LOCATION_UNAVAILABLE`, `LOCATION_VERIFICATION_OVERDUE`, `LOCATION_CALL` |
| `locationState` `LocationState` | server classification: `INSIDE`, `OUTSIDE`, `UNKNOWN` |
| `latitude?`, `longitude?`, `accuracyM?`, `distanceM?`, `geofenceRadiusM?`, `provider?`, `speed?`, `bearing?`, `mock` | the fix |
| `reason?` | for unavailable: `permission_revoked`, `location_disabled`, `no_fix`, `poor_accuracy`, `on_boundary`, `site_has_no_coordinates`, `no_check_received` |
| `durationOutsideSeconds?` | on returns |
| `occurredAt` (phone time, clamped), `receivedAt`, `syncStatus` `SyncStatus` (`LIVE`, `SYNCED`, `SYNCED_LATE`) | never show late as live |
| `simulated`, `metadata` JSON (`phoneState`, `phoneDistanceM`, `callId`, phase, online) | |

Indexes: `(shiftId, occurredAt)`, `(guardId, occurredAt)`, `(gatewayDeviceId, occurredAt)`, `eventType`, `occurredAt`. Retention: `geofence.locationRetentionDays` (default 180, 0 = keep).

## Phone number normalisation

`src/lib/phone.ts` → `normalisePhone(raw, defaultCountry = "263")`: strips spaces and punctuation; `00…` → `+…`; leading `0` → `+263…`; bare `263…` → `+263…`; `+…` kept. Guards are stored normalised (the form validator does it), callers are normalised on arrival, and matching compares the canonical strings. Unit tests: `tests/phone.test.ts`.

## Deduplication

1. Transport: `GatewayEvent.eventId` unique → a replayed event gets `duplicate` and is dropped by the phone.
2. Domain: `CallLog(gatewayDeviceId, callId)` unique → every state event for one call updates one row through the pure reducer in `src/lib/gateway/call-state.ts`, which ignores regressions (a late `CALL_STARTED` after `ENDED`).

## Retention

`gateway.callRetentionDays` (default 365; 0 keeps everything). The engine step `gatewayMaintenance` deletes `CallLog` rows started before the cut-off and `GatewayEvent` rows received before it. Shift timeline entries are kept with the shift. Notifications and audit entries follow the existing rules.
