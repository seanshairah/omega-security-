# Database Changes (Phases 1 and 2)

All changes are additive: new enum, new nullable columns or columns with defaults. No column is renamed, dropped or retyped, and no row is rewritten. Existing SMS, shift, attendance and call data are untouched. Apply with `npx prisma migrate deploy` (TCP) or `npx tsx scripts/neon-migrate.ts` (Neon over HTTPS); both record the migration in `_prisma_migrations`.

## `20261018120000_site_config_versioning`

| Table | Column | Type | Purpose |
|---|---|---|---|
| (enum) | `CoordinatesSource` | `MAP` · `MANUAL` · `TEST` | provenance of a site's coordinates |
| `Location` | `coordinatesSource` | enum, nullable | how the coordinates were set; `TEST` is flagged everywhere and never counts as verified |
| `Location` | `coordinatesUpdatedAt` | timestamp, nullable | last time centre or radius changed |
| `Location` | `coordinatesVerifiedAt` | timestamp, nullable | set when placed with the map picker |
| `Location` | `placeId` | text, nullable | Google place id when found by search |
| `Location` | `configVersion` | int, default 1 | +1 whenever centre or radius changes |
| `Shift` | `geofenceLatitude`, `geofenceLongitude` | float, nullable | shift-level override centre |
| `Shift` | `geofenceRadiusM` | int, nullable | override radius (null = site's) |
| `Shift` | `geofenceNote` | text, nullable | reason shown on the timeline |
| `Shift` | `configVersion` | int, default 1 | +1 whenever the override changes |
| `GatewayDevice` | `configVersionApplied` | text, nullable | `"<site>.<shift>"` echoed by the phone |
| `GatewayDevice` | `configAppliedAt` | timestamp, nullable | when that version was first reported |

## `20261018150000_device_sync_diagnostics`

| Table | Column | Type | Purpose |
|---|---|---|---|
| `GatewayDevice` | `shiftState` | text | `NONE` · `UPCOMING` · `ACTIVE` |
| `GatewayDevice` | `gpsState` | text | `OFF` · `MONITORING` · `VERIFYING_OUTSIDE` · `OUTSIDE` · `LOCATION_UNAVAILABLE` |
| `GatewayDevice` | `gpsReason` | text | why the last reading was unknown |
| `GatewayDevice` | `syncState` | text | sync engine state (see AUTO_SYNC.md) |
| `GatewayDevice` | `queuedEvents`, `failedEvents` | int | outbox counts |
| `GatewayDevice` | `oldestPendingSeconds` | int | how far behind the phone is |
| `GatewayDevice` | `lastEventSyncAt`, `lastSyncAttemptAt` | timestamp | event delivery vs attempt |
| `GatewayDevice` | `lastSyncError`, `lastSyncTrigger` | text | diagnostics |

`monitoringState` (the earlier composite string) is still written for compatibility.

## `20261019090000_guard_alerts` (Phase 2)

| Table | Column | Type | Purpose |
|---|---|---|---|
| (enum) | `GuardAlertType` | `EMERGENCY` · `NEED_ASSISTANCE` · `INCIDENT_REPORT` · `SECURITY_ALERT` · `RUNNING_LATE` · `STATUS_UPDATE` · `SHIFT_OK` · `HANDOVER` | what the guard pressed |
| (enum) | `GuardAlertStatus` | `OPEN` · `ACKNOWLEDGED` · `RESOLVED` | operations' handling |
| (enum) | `IncidentSource` | + `APP` | incidents opened by app alerts |
| (enum) | `CheckInType` | + `SECURITY_ALERT`, `RUNNING_LATE`, `STATUS_UPDATE`, `GUARD_OK`, `ALERT_ACKNOWLEDGED` | shift timeline lines |
| `GuardAlert` | whole table | see `prisma/schema.prisma` | one row per alert: guard, device, shift, site, type, status, `requiresAck`, message, last-known position with accuracy, state and age, `occurredAt` (pressed) vs `receivedAt`, `syncStatus`, acknowledgement (who, when, note), resolution, linked incident |

## `20261019120000_device_build_and_storage` (Phase 3)

| Table | Column | Type | Purpose |
|---|---|---|---|
| `GatewayDevice` | `secureStorage` | boolean, nullable | false when the phone could not keep its token in Keystore-backed storage |
| `GatewayDevice` | `buildType` | text, nullable | `debug` or `release` as reported by the app; debug builds are flagged on the device page |

Verify any database with `npm run db:migration-status` (read-only; non-zero exit when something is pending or unknown).

## On-device SQLite (`gateway_queue.db`, version 3)

- `outbox`: adds `status`, `priority`, `eventType`, `nextAttemptAt`, `sendingSince`, `lastAttemptAt` (defaults keep v1 rows valid).
- `sync_log`: new table, last 200 runs.
- `comm_log` (v3): what the guard sent (alerts, status messages, calls) with delivery state (`QUEUED` → `SENT` → `ACKNOWLEDGED` → `RESOLVED`, or `FAILED`), acknowledger and note. Last 300 rows.

## Rollback

Nothing needs rolling back to run the previous code: older code ignores the new columns. To remove them anyway, drop the columns listed above and the `CoordinatesSource` type; no data outside these columns is affected.
