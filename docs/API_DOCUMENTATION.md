# API documentation

The complete route list with auth, request and response shapes is in [API.md](API.md). This page adds the endpoints introduced for guard devices and GPS. Device routes use `Authorization: Bearer <deviceToken>`; portal routes use the session cookie and `guarded(role)`.

## Device routes

### GET /api/gateways/config — Bearer, 60/min

What a guard phone needs to monitor a shift offline.

```json
{ "ok": true, "deviceId": "cmv…", "deviceName": "John's phone", "mode": "GUARD",
  "guard": { "id": "cmv…", "name": "John Moyo", "guardNo": "G-0001" },
  "shift": { "id": "cmv…", "startAt": "2026-10-15T16:00:00.000Z", "endAt": "2026-10-16T04:00:00.000Z", "status": "SCHEDULED",
             "site": { "id": "cmv…", "name": "Silverpeak Mine", "latitude": -17.8292, "longitude": 31.0522, "radiusM": 150, "hasCoordinates": true } },
  "config": { "heartbeatSeconds": 120, "offlineMinutes": 5, "geofence": { "checkMinutes": 10, "verifySeconds": 60, "outsideCheckMinutes": 3, "escalationMinutes": 10, "accuracyMaxM": 100 }, "serverTime": "…" } }
```
`shift` is the live or next non-closed shift; `null` when none. For an operations gateway `guard` and `shift` are `null`.

### POST /api/gateways/heartbeat — Bearer

Additional fields accepted: `locationPermission` (`background` | `foreground_only` | `denied`), `callPermission` (`granted` | `partial` | `denied`), `monitoringState`, `mockLocation` (boolean), `lastLocation { latitude, longitude, accuracyM, at, state }`. Response now includes `mode` and `guard`.

### POST /api/gateways/events (alias POST /api/gateways/location-events) — Bearer, 120/min

Location event types alongside the call events:

```json
{ "eventId": "uuid", "eventType": "LOCATION_EXIT", "timestamp": "2026-10-15T20:15:00.000Z",
  "latitude": -17.8254, "longitude": 31.0522, "accuracyM": 15, "distanceM": 420, "geofenceRadiusM": 150,
  "locationState": "OUTSIDE", "provider": "gps", "speed": 1.2, "bearing": 90, "mock": false,
  "shiftId": "cmv…", "siteId": "cmv…", "reason": null, "durationOutsideSeconds": null, "meta": { "phase": "OUTSIDE", "online": false } }
```

| eventType | Required | Notes |
| --- | --- | --- |
| `SHIFT_STARTED` | timestamp | first fix of a shift; triggers SMS+GPS verification |
| `LOCATION_CHECK` | timestamp | periodic; INSIDE checks are stored but not alerted |
| `LOCATION_EXIT` | timestamp, fix | confirmed exit; warning alert |
| `LOCATION_OUTSIDE` | timestamp, fix | throttled update while outside |
| `LOCATION_RETURNED` | timestamp, fix, `durationOutsideSeconds` | info alert |
| `LOCATION_UNAVAILABLE` | timestamp, `reason` | stored UNKNOWN; one warning per hour |
| `LOCATION_CALL` | timestamp, fix | location at the time of a call |
| `DEVICE_STATUS` / `HEARTBEAT` | timestamp, `meta` | permission and monitoring state without a heartbeat |

Call events from a guard device may carry `"location": { "latitude", "longitude", "locationState" }`.

The server re-classifies every fix against the site it knows (`locationState` may differ from the phone's; the phone's verdict is kept in `metadata.phoneState`), computes `syncStatus` (`LIVE` ≤ 2 min, `SYNCED` ≤ 10 min, `SYNCED_LATE`), and acknowledges `ok` / `duplicate` / `rejected` per event exactly as for calls.

## Portal routes

| Method | Route | Role | Returns |
| --- | --- | --- | --- |
| GET | `/api/guards/[id]/current-location` | SUPERVISOR | latest fix with `freshness` (`LIVE`/`RECENT`/`STALE`/`SYNCED LATE`), device summary; **audited** as `LOCATION_VIEWED` |
| GET | `/api/shifts/[id]/location-events` | SUPERVISOR | site geometry, attendance verification, events in order |
| GET | `/api/locations/[id]/geofence` | SUPERVISOR | `{ latitude, longitude, geofenceRadiusM, hasCoordinates }` |
| POST/PATCH | `/api/gateways`, `/api/gateways/[id]` | ADMIN | now accept `mode` (`OPERATIONS_GATEWAY` | `GUARD`) and `guardId` |
| POST | `/api/gateways/simulate` | ADMIN | also accepts location fields (`latitude`, `longitude`, `accuracyM`, `locationState`, `distanceM`, `reason`, `durationOutsideSeconds`, `mock`, `at`) |
| PUT | `/api/locations/[id]` (existing) | ADMIN | `latitude`, `longitude`, `geofenceRadiusM` |

## Guard-phone location requests

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/guards/{id}/location-requests` | session, SUPERVISOR+ | panel summary: device, site, shift, last 10 requests (audited `LOCATION_VIEWED`) |
| POST | `/api/guards/{id}/location-requests` | session, ADMIN+ | create `{ purpose?: CHECK\|SITE_SETUP\|WELFARE, locationId?, maxAccuracyM?, ttlSeconds? }` → 201 `{ request, reused:false }`; 200 with `reused:true` while one is open; 404 no eligible device; 429 over 12/hour |
| GET | `/api/guards/{id}/location-requests/{requestId}` | session, SUPERVISOR+ | one request with distance/classification against the site |
| DELETE | `/api/guards/{id}/location-requests/{requestId}` | session, ADMIN+ | cancel an open request |
| GET | `/api/gateways/commands` | device Bearer | `{ commands: [{ id, type: "REQUEST_LOCATION", requestedAt, expiresAt, maxAccuracyM, requireFreshFix }], commandPollSeconds }` — only this device's open, unexpired requests; marks `DELIVERED` |
| POST | `/api/gateways/commands/{id}/ack` | device Bearer | `{ status: "PROCESSING" }` — the phone has started the GPS |
| POST | `/api/gateways/events` | device Bearer | event type `LOCATION_REQUEST_RESULT { requestId, status: COMPLETED\|FAILED, latitude?, longitude?, accuracyM?, provider?, capturedAt?, mock?, failureReason?, failureDetail? }` — same dedupe and retry rules as every other event |

The heartbeat response also carries `commands` and `commandPollSeconds` for guard devices.
