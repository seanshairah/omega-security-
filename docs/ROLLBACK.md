# Rollback Procedure

Three independently reversible parts: the web portal, the database, the Android app.

## Web portal (Vercel)

1. Vercel → Deployments → pick the previous production deployment → **Promote to Production** (or `vercel rollback`). Takes effect in under a minute.
2. Older code ignores every column added by Phases 1–3, so no database change is needed to run it.
3. If the rolled-back version predates an API field the phones now send (`configVersion`, sync diagnostics, `secureStorage`, alert events), the phones keep working: heartbeats ignore unknown fields; alert events would be acknowledged as `rejected` and marked FAILED on the phone (visible in Settings → Sync engine). Roll forward again as soon as possible.

## Database (Neon)

- Nothing needs to be undone to run older code: all migrations are additive (`DATABASE_CHANGES.md`).
- To physically remove Phase 1–3 schema anyway (data in those columns is lost): drop, in this order, `"GuardAlert"`, the added `GatewayDevice`/`Location`/`Shift` columns, then the enums `GuardAlertType`, `GuardAlertStatus`, `CoordinatesSource`. Enum values added to `CheckInType` and `IncidentSource` cannot be dropped in PostgreSQL; they are harmless. Delete the matching rows from `_prisma_migrations`.
- Neon keeps point-in-time history; a branch restore is the safest full rollback if ever needed.

## Android app

- Previous APKs are in git history under `artifacts/android/` (v1.1.0 at `cf900d4`, v1.2.0 at `56c97cc`, v1.3.0 at `a07ae44`). Rebuild any tag with `npm run android:build`.
- Downgrading a phone requires uninstalling (Android refuses a lower `versionCode`), which wipes the local outbox: sync first (Settings → Sync now, wait for "UP TO DATE"), then uninstall, install the older APK and re-activate with a new code from the portal.
- The server accepts every event format since v1.1.0, so mixed fleets are fine.

## Order

Portal first (seconds), then decide about the app. The database almost never needs touching.
