# Offline mode

The phone must keep working with no internet, no airtime, or both.

| Situation | GPS | Local geofence | Calls detected | Upload |
| --- | --- | --- | --- | --- |
| Internet available | yes | yes | yes | immediate |
| No internet (no data, no Wi‑Fi) | yes | yes | yes (if the carrier still connects the call) | queued |
| No airtime, data available | yes | yes | depends on the carrier | immediate |
| No airtime, no internet | yes | yes | depends on the carrier | queued |
| Phone off / app killed | no | no | no | nothing; backend shows DEVICE OFFLINE |

GPS and the geofence calculation never need the network. Placing or receiving a voice call needs cellular service and, for outgoing calls, whatever the carrier requires (airtime or bundle); the app cannot change that.

## The outbox

`android/.../data/EventQueue.kt` is a SQLite table: `eventId` (unique, UUID from the phone), event JSON, created time, attempt count, last error. Every event is written there first, call or location, and only removed when the server acknowledges it as `ok` or `duplicate`. A malformed event acknowledged as `rejected` is dropped so it cannot block the queue.

Sync (`SyncEngine.syncOnce`) sends up to 100 events per request in creation order, triggered by: a new event, the network coming back (`ConnectivityManager` callback), the service's backoff timer (5 s → 15 s → 45 s … 15 min), and a WorkManager job every 15 minutes as a safety net. Device tokens rejected with 401/403 stop retries and show "DEVICE REVOKED".

## Timestamps and sync status

Events keep the phone's own `timestamp`. The server clamps it to [now − 7 days, now + 5 min] and derives `syncStatus` from the delay between that timestamp and arrival:

| Delay | Status | Shown as |
| --- | --- | --- |
| ≤ 2 min | `LIVE` | live |
| ≤ 10 min | `SYNCED` | synced |
| > 10 min | `SYNCED_LATE` | synced late |

Lists, timelines and maps show the badge; a `SYNCED_LATE` exit is never presented as a live detection. The state machine replays a late batch in timestamp order, so an out-of-order upload still ends in the right state.

## Idempotency

`eventId` is unique in `GatewayEvent` (calls) and `LocationEvent` (locations). A retry after a lost acknowledgement gets `duplicate` and the phone deletes its copy. Calls additionally fold into one row per `(device, callId)`.

## Configuration cache

`GET /api/gateways/config` is fetched with every heartbeat and stored on the phone (`ShiftConfig`): guard, shift window, site coordinates and radius, timing policy. Monitoring for a shift that was fetched before the outage runs fully offline. A shift created while the phone is offline is picked up on the next successful heartbeat.
