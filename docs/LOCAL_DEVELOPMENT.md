# Local development

How to run the portal, the automation engine and the Android app on a fresh computer.

## Requirements

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | 20 or 22 (the project is built with 22) | <https://nodejs.org> |
| npm | 10+ (comes with Node) | the only package manager used; do not add pnpm/yarn lockfiles |
| Git | any recent | |
| PostgreSQL | 16 (local, Docker, or a free Neon database) | `docker run -d --name omega-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16` |
| JDK | 17 or 21 | required by the Android Gradle plugin (`java -version`) |
| Android SDK | platform 35, build-tools 35.0.0, platform-tools | via Android Studio (SDK Manager) or the command-line tools |
| Android Studio | Ladybug or newer (optional) | for the emulator and debugging; Gradle alone builds the APK |
| Chromium | optional | the QA scripts in `scripts/dev` screenshot pages with Playwright |

Set `ANDROID_HOME` (Windows: `%LOCALAPPDATA%\Android\Sdk`, macOS: `~/Library/Android/sdk`, Linux: `~/Android/Sdk`). `npm run android:sync` writes `android/local.properties` from it.

## Get the code

```bash
git clone https://github.com/seanshairah/omega-security-.git
cd omega-security-
npm install
cp .env.example .env
```

## Environment variables

Edit `.env`:

| Variable | Local value |
| --- | --- |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/omega?schema=public` (or your Neon string) |
| `DATABASE_OVER_HTTP` | `false` locally; `true` only when port 5432 is blocked and you use Neon |
| `AUTH_SECRET` | any string of 32+ characters |
| `SMS_PROVIDER` | `simulated` (nothing is sent; the simulator plays the guard) |
| `AUTOMATION_INPROCESS` | `true` (the engine runs inside `next dev`) |
| `TIMEZONE` | `Africa/Harare` |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` (shown on the gateway activation card) |
| `ADMIN_PASSWORD` | password for the first super admin, used once by `npm run db:seed` |

Optional: `VAPID_*` for browser push, `SMS_*` for a real gateway. Never commit `.env`.

## Database

```bash
npx prisma migrate deploy          # apply migrations (or: npx tsx scripts/neon-migrate.ts for Neon over HTTPS)
npx prisma generate                # regenerate the client after schema changes
ADMIN_PASSWORD='choose-one' npm run db:seed   # settings, templates, the super admin (safe to re-run)
npm run db:seed:demo               # OPTIONAL: wipes everything and loads demo clients, sites, guards, history
```

Schema changes: edit `prisma/schema.prisma`, run `npx prisma migrate dev --name <change>` (local Postgres) to create the migration folder, commit it.

## Run the portal

```bash
npm run dev            # http://localhost:3000 — backend and frontend are the same Next.js app
```

Sign in as `admin@omegasecurity.co.zw` with the password you set. The engine ticks every minute; `npm run automation:tick` runs one tick by hand.

Checks before a commit:

```bash
npx tsc --noEmit       # types
npm run lint           # ESLint (next lint)
npm test               # unit tests: call state machine, phone normalisation, gateway auth, event validation
npm run build          # production build
npm run test:gateway-e2e   # end-to-end call-gateway scenario over HTTP (needs `npm run dev` running)
```

## Android app

```bash
npm run android:sync      # verify SDK/JDK, write android/local.properties
npm run android:debug     # artifacts/android/security-gateway-debug.apk
npm run android:release   # artifacts/android/security-gateway-release.apk
npm run android:build     # both + Gradle unit tests (CallTrackerTest)
cd android && ./gradlew testDebugUnitTest   # Android unit tests alone
```

The first build downloads Gradle 8.14 and the dependencies (a few hundred MB). The project's repositories list Google's Maven Central mirror first because Maven Central rate-limits shared networks.

Pointing the app at your computer:

- **Emulator:** the host is `http://10.0.2.2:3000`; the app allows plain HTTP for that address only. Create an AVD in Android Studio (API 30+ with Google APIs), run it, then `cd android && ./gradlew installDebug`.
- **Real phone on the same Wi‑Fi:** the app requires HTTPS for any other host, so expose the dev server with an HTTPS tunnel (`npx localtunnel --port 3000` or ngrok) and enter that URL, or build with `GATEWAY_DEFAULT_SERVER_URL=https://… npm run android:debug` to pre-fill it. Enable USB debugging on the phone and `./gradlew installDebug`, or copy the APK over.
- `adb logcat -s GatewayService CallMonitor SyncEngine` shows what the app is doing.
- Simulating calls on the emulator: in Android Studio's *Extended controls → Phone*, place an incoming call; or `adb emu gsm call 0771234567`, `adb emu gsm accept 0771234567`, `adb emu gsm cancel 0771234567`.

Release signing: create `android/keystore.properties` (ignored by git) with `ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, or export the same names as environment variables. Generate a keystore with `keytool -genkeypair -v -keystore omega-gateway.jks -alias gateway -keyalg RSA -keysize 2048 -validity 10000`. Keep it safe: updates must be signed with the same key.

## Useful scripts

| Script | Purpose |
| --- | --- |
| `scripts/dev/gateway-e2e.ts` | the 33-step scenario (activate → SMS arrival → calls → missed → unknown → offline replay → revoke → SMS still works); creates and removes tagged test data |
| `scripts/dev/gateway-qa-data.ts [--clean]` | small data set for screenshots of the gateway pages |
| `scripts/dev/client-updates-check.ts` | client site-status SMS check |
| `scripts/dev/e2e.mjs`, `shot.mjs`, `shot-mobile.mjs`, `sweep.mjs` | browser QA (set `QA_EMAIL` / `QA_PASSWORD`) |
| `scripts/dev/db-counts.ts` | row counts per table |
| `scripts/purge-data.ts --yes` | remove all operational data and non-super-admin users |
