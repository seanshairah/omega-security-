# Release Checklist

## Before every release

- [ ] `npm run test:all` green locally (typecheck, lint, unit, the four e2e suites against a local database with `npm run dev`).
- [ ] `cd android && ./gradlew testDebugUnitTest` green.
- [ ] `npm run db:migration-status` against production shows *all migrations applied* (after `npx tsx scripts/neon-migrate.ts` or `prisma migrate deploy`).
- [ ] `docs/DATABASE_CHANGES.md` updated for any new migration; all additive.
- [ ] Secrets: none in the diff (`git diff --stat` shows no `.env`, no `keystore.properties`, no `.jks`).

## Web

- [ ] Vercel environment has `DATABASE_URL`, `AUTH_SECRET`, `SMS_*`, `CRON_SECRET`, `NEXT_PUBLIC_APP_URL`, optionally `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (referrer-restricted).
- [ ] Deploy; open `/dashboard`, `/alerts`, `/operations/map`, `/gateways`, `/locations/<id>/edit` once.

## Android

- [ ] Version bumped (`versionCode`, `versionName` in `android/app/build.gradle.kts`).
- [ ] Release keystore configured: `ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` (env or `android/keystore.properties`). The build prints a WARNING when it falls back to the debug key; a debug-key release must not be distributed.
- [ ] `GATEWAY_DEFAULT_SERVER_URL=https://<portal> npm run android:release`.
- [ ] Install on one guard phone and one operations phone; walk `docs/DEVICE_TEST_PLAN.md`.
- [ ] Device page shows `buildType: release` and no secure-storage warning.
- [ ] Distribute `artifacts/android/security-gateway-release.apk`; register and activate each phone (ANDROID_INSTALLATION.md).

## After

- [ ] Watch `/gateways` for an hour: heartbeats, sync *Up to date*, config versions applied.
- [ ] Watch `/alerts` and `/operations/exceptions` for anything unexpected.
- [ ] Note the deployment and APK version in the audit log entry (Settings → Audit log) or the release note.
