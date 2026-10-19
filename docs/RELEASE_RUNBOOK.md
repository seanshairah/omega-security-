# Release runbook (portal + Android)

One document to take a tagged `main` to production and back. Nothing here is run automatically; every step that changes production needs a named person and explicit approval.

## 0. Prerequisites and what is NOT in the repository

The following must be supplied by the operator; the repository holds no production values:

| Item | Where it goes | Notes |
|---|---|---|
| Production domain (https) | Vercel project domain, `NEXT_PUBLIC_APP_URL`, `GATEWAY_DEFAULT_SERVER_URL` at APK build time | guard phones refuse plain http in release builds |
| `DATABASE_URL` (Neon, pooled) | Vercel env | `DATABASE_OVER_HTTP=true` on Vercel |
| `AUTH_SECRET` (≥ 32 random chars) | Vercel env, **Production and Preview** | the server **refuses to start** in production when it is unset or the example default; shorter values only warn |
| `CRON_SECRET`, `AUTOMATION_SECRET` | Vercel env + cron | not the example defaults |
| SMS provider: `SMS_PROVIDER=sendai`, `SMS_API_KEY`, `SMS_SENDER_ID`, `SMS_WEBHOOK_SECRET` | Vercel env + Sendai webhook config | the webhook URL is `https://<domain>/api/sms/webhook/sendai` |
| `VAPID_*` keys | Vercel env | browser push |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` / `NEXT_PUBLIC_MAPTILER_KEY` (optional) | Vercel env | referrer-restricted at the provider |
| `SIMULATOR_ENABLED` | Vercel env | leave unset (off in production unless SMS is simulated) |
| Android release keystore + `ANDROID_KEYSTORE_*` | build machine only | never committed |

`/api/health` on the deployed URL reports `config.configIssues` (a count) and `config.environment`; a non-zero count means a `[config]` warning was logged at start.

## 1. Pre-release checks (local, against a local database)

```
npm ci
npm run db:check            # schema valid, generated client matches, migrations complete
npm run typecheck && npm run lint && npm test
npm run dev                 # in another terminal, SMS_PROVIDER=simulated
npm run test:e2e            # gateway, location, alerts, integration, location-request suites
npm run test:geolocation    # browser geolocation flow (Playwright)
npm run test:layout         # workspace layout at desktop/laptop/phone, no overflow
npm run build               # production bundle (standalone output)
cd android && ./gradlew testDebugUnitTest assembleRelease
```

All green before continuing. Record the numbers in the release note.

## 2. Backup (before any migration)

Neon: create a branch of production (Console → Branches → *Create branch from main*), named `pre-<version>-<date>`. This is a full, instantly restorable copy. Keep it until the release has run for a week. Self-hosted Postgres: `pg_dump -Fc "$DATABASE_URL" > backup-<date>.dump`.

## 3. Database migration (additive only)

```
npm run db:migration-status                 # read-only; lists PENDING migrations
npx tsx scripts/neon-migrate.ts             # Neon over HTTPS, or: npx prisma migrate deploy
npm run db:migration-status                 # must say "all migrations applied"
```

Every migration in this repository is additive (`docs/DATABASE_CHANGES.md`); the previous portal version keeps running on the migrated schema, so migrate first, deploy second. Never run `prisma migrate reset`, `db:purge` or `db:push` against production.

## 4. Deploy the portal

Vercel: merge to `main` (or promote the preview); confirm the deployment log shows no `[config]` lines, then open `https://<domain>/api/health` → `ok: true`, `configIssues: 0`, `environment: production`.
Docker: `docker build -t omega-portal:<version> .` then run with the env file; the image serves `node server.js` on 3000 and does not migrate on start.

## 5. Android release

```
# on the build machine, keystore present
export GATEWAY_DEFAULT_SERVER_URL=https://<domain>
npm run android:release           # warns loudly if it falls back to the debug key: do not ship that
```
Install on one guard phone and one operations phone, run `docs/DEVICE_TEST_PLAN.md` (sections L and U are the newest), confirm the device page shows `buildType: release` and no secure-storage warning, then distribute `artifacts/android/security-gateway-release.apk`. The debug build (`.debug` suffix) can stay on test phones; it is the only build that can use `omega.devHttpHosts`.

## 6. Smoke test (10 minutes, production)

1. Sign in; wrong password ×2 shows the error; the account is not locked (limit is 10 in 15 min).
2. Dashboard, Active operations, Live map, Guard alerts, Monitoring open without errors.
3. A guard with a phone: workspace shows Online, the map draws the site and the last fix, **Request GPS fix** goes Queued → Delivered → Position received with accuracy and time.
4. Phone: EMERGENCY (confirm) → CRITICAL alert on the dashboard within one sync; acknowledge it → the phone shows the acknowledgement by name.
5. SMS: send a test message from Compose to a test number; reply; the reply appears in Message logs.
6. Calls: one call from a guard phone to the operations number appears under Calls.
7. `/simulator` returns 404 (unless intentionally enabled).

## 7. Rollback

- Portal: Vercel → previous deployment → *Promote to Production* (or `docker run` the previous image). Older code ignores the added columns and tables; no schema rollback needed.
- Database: only if data must be discarded, restore the Neon branch from step 2 (Console → branch → *Restore*), accepting the loss of everything written since. Document the decision.
- Android: previous APK re-installs over the newer one only with the same signing key; otherwise uninstall/reinstall and re-activate the phone (ANDROID_INSTALLATION.md).

## 8. Monitoring and logs

- `/api/health` every minute from an external monitor (expects 200 and `ok: true`).
- Vercel logs: filter `[config]`, `[automation]`, `Unhandled`.
- Portal pages to watch for the first hour: `/gateways` (heartbeats, sync *Up to date*), `/alerts`, `/operations/exceptions`, `/notifications`.
- Audit log (super admin): `LOGIN_THROTTLED`, `GATEWAY_*`, `LOCATION_REQUESTED`.
