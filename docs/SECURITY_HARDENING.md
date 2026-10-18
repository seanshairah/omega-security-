# Security Hardening (Phase 3, Stage 9)

What is enforced, where, and how it was checked. Items marked *device* need a run on hardware.

## Transport

| Control | Where | Check |
|---|---|---|
| HTTPS only from the app | `ApiClient.requireHttps`: release builds refuse any non-HTTPS URL; debug builds allow plain HTTP to `localhost` / `10.0.2.2` only | unit of the rule by reading; *device*: entering `http://` on a release build shows "Server URL must use https://" |
| No cleartext at the OS level | `AndroidManifest.xml` `android:usesCleartextTraffic="false"` | manifest |
| Portal served over HTTPS | Vercel | deployment |

## Credentials

| Control | Where | Check |
|---|---|---|
| Device token stored in Keystore-backed `EncryptedSharedPreferences` (AES-256-GCM, AES-256-SIV keys) | `Prefs.secure` | code; `secureStorage=false` reported on every heartbeat when the Keystore fails and shown on the device page as a critical warning |
| Token never logged, never in a URL | `ApiClient` sends `Authorization: Bearer` only | grep of `Log.` calls |
| Token hashed at rest on the server (SHA-256), returned once at activation | `src/lib/gateway/auth.ts` | gateway e2e: heartbeat without token → 401, revoked device → 401/403 |
| Activation codes expire (24 h), single use, regenerable by an administrator | `service.ts` | gateway e2e |
| Revocation deletes the hash | `revokeGateway` | gateway e2e, alerts e2e |

## Authorisation (portal)

| Control | Where |
|---|---|
| Every page behind `requireUser()`; mutations behind `actor(role)` | `src/app/(app)/**`, `src/actions/**` |
| Alerts acknowledge/resolve: SUPERVISOR and above | `src/actions/alerts.ts` |
| Site/shift geofence edits: ADMIN and above, audited with before/after | `src/actions/locations.ts`, `src/actions/shifts.ts` |
| Location views audited | `LOCATION_VIEWED` on the guard Location tab |

## Input validation and abuse limits

| Control | Where |
|---|---|
| Every device event validated (`validateEvent` → call / location / alert validators); unknown types rejected; coordinates range-checked; messages capped at 500 chars | `src/lib/gateway/*` |
| Batch cap 200 events; rate limits per device: events 120/min, heartbeats 30/min, config 60/min | routes |
| Server re-classifies every fix; the phone's verdict is advisory | `location-events.ts` |
| Zod schemas on every form; coordinates pair rule; radius 20–5000 m | `src/lib/validation.ts` |

## Build separation

| Control | Where |
|---|---|
| Debug app id `zw.co.omega.gateway.debug`, release `zw.co.omega.gateway`; both install side by side | `build.gradle.kts` |
| Release: R8 minify + resource shrink; `Log.v/d/i` stripped (`proguard-rules.pro`); warnings and errors kept | `proguard-rules.pro` |
| The app reports `buildType`; a debug build on a production phone is flagged on the device page | `SyncEngine.heartbeat`, `DevicePanel` |
| Release signing from `ANDROID_KEYSTORE_*` (env or `android/keystore.properties`, git-ignored); without it the build warns and signs with the debug key | `build.gradle.kts` |

## Permissions

No permission beyond PERMISSIONS.md / ANDROID_PERMISSIONS.md. `CALL_PHONE` and `SEND_SMS` are deliberately not requested; the dialer and SMS app are opened with intents.

## Logging policy

- Phone, release: warnings and errors only; no token, no message bodies, positions only at `Log.i` level (stripped).
- Server: `GatewayEvent` raw log keeps payloads for diagnostics (retention via `gateway.callRetentionDays` / `geofence.locationRetentionDays`); audit log for every administrative action.

## Database

- Every migration additive; `npm run db:migration-status` compares the repository with the database and exits non-zero when anything is pending or unknown.
- QA and e2e scripts refuse a non-local `DATABASE_URL` unless `ALLOW_LIVE_DB=1`.

## Still owed (device)

The HTTPS refusal on a release build, Keystore fallback reporting on a phone with a damaged keystore, and log stripping visible in `adb logcat` have been implemented and compiled but not exercised on hardware.
