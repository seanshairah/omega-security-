# Stage 0 — Repository audit and findings (2026-10-19)

Baseline: `main` at 84cfab1 (portal), app v1.6.0. Everything below was read in the code, not assumed. Items marked **confirmed** were reproduced in this repository; **suspected** need a running device or production data to reproduce.

## A. Working functionality that must be preserved (verified by the existing suites)

| Area | Evidence | Status |
|---|---|---|
| SMS pipeline (Sendai + simulated), templates, automation | untouched since Phase 1; regression steps in gateway/location/alerts/integration suites | preserved |
| Call monitoring (operations gateway and guard phones) | `CallMonitor`, `CALL_*` events, `gateway-e2e` 30/30 | preserved |
| GPS shift monitoring, accuracy-aware classification | `classifyFix`, `LocationMonitor`, `location-e2e` 38/38 | preserved |
| Remote location requests (create → deliver → ack → result → map) | `location-request-e2e` 37/37; confirmed by the user on a real phone (±101 m rejected at a 100 m limit, ±5 m accepted) | preserved, do not rewrite |
| Emergency / assistance / shift-OK alerts with ack | `alerts-e2e` 20/20, Android `AlertSender` + `AlertFlow` | preserved |
| Background sync: durable outbox, per-row retry/backoff, partial-ack handling, crash recovery (`resetSending`), WorkManager 15-min safety net | `SyncEngine.run`, `EventQueue.markRetry`, `SyncWorker` | preserved |

## B. Confirmed defects

| # | Finding | Where | Effect | Fix (this release) |
|---|---|---|---|---|
| B1 | **Two device-selection queries.** The guard page picks `mode=GUARD, status≠REVOKED` ordered by `createdAt desc`; the location panel API picks `activationStatus=ACTIVE, status∉{REVOKED,DISABLED}` ordered by `lastSeenAt desc`. With two historical devices, the page can show a stale phone as offline while the panel shows the live one online. | `guards/[id]/page.tsx`, `lib/gateway/location-requests.ts` | the inconsistency the user saw locally | one helper `eligibleDeviceForGuard` used by the page, the status API and `current-location` |
| B2 | **Guard page never refreshes.** No `AutoRefresh`; the Location panel polls itself but the Device card is static until navigation. The user's local `AutoRefresh` patch is not in the repository. | `guards/[id]/page.tsx` | panels disagree over time | status region polls a small JSON endpoint every 15 s; no whole-page refresh |
| B3 | **Stale Prisma client after a schema change in a running dev server.** `postinstall` generates, `build` generates, but `next dev` does not; a dev server started before pulling new migrations reports 39 type errors and `updateMany` failures. | `package.json` | the `localhost:3001` confusion | `predev` runs `prisma generate`; `npm run db:check` compares the generated schema with the source and validates it |
| B4 | **Two servers, two ports.** Docker serves 3000; a stray `next dev` served 3001 with stale code. Nothing in the repo documented which to use. | docs | wrong instance debugged | documented in LOCAL_DEVELOPMENT (ports, Docker vs dev, how to tell which is which via `/api/health`) |
| B5 | **No HTTP security headers.** No `headers()` in `next.config.ts`, no middleware. | `next.config.ts` | clickjacking / MIME sniffing exposure | HSTS (production), X-Frame-Options DENY, X-Content-Type-Options, Referrer-Policy, Permissions-Policy (geolocation only for self) |
| B6 | **Login has no throttling.** Failures are audited but unlimited. | `actions/auth.ts`, `api/auth/login` | password guessing | per-IP and per-account limit (10 failures / 15 min), audited `LOGIN_THROTTLED` |
| B7 | **`AUTH_SECRET` falls back to a built-in dev value**, also in production. | `lib/auth/session.ts` | forged sessions if the variable is missing | production refuses to start when the secret is unset or the example default (a short secret warns); health reports config problems as a count only |
| B8 | **Simulator and simulated-event API are reachable in production** (ADMIN-only, but advertised in the sidebar). | `(app)/simulator`, `api/gateways/simulate` | test events in real data | `SIMULATOR_ENABLED` (default on outside production and when `SMS_PROVIDER=simulated`); page 404s and API 403s otherwise; sidebar hides it |
| B9 | **`/api/health` returns the database host name** to anyone. | `api/health/route.ts` | minor information disclosure | host omitted in production |
| B10 | **Guard page loads every tab's data on every request** (60 calls, 40 shifts, 30 messages, audit) and the Location tab re-queries 80 events. | `guards/[id]/page.tsx` | slow page, wasted queries | tabs load their own data; feed is paged through an API |
| B11 | **Guard page layout**: metrics strip + a tab card + a side card; the map exists only inside the Location tab, the identity scrolls away, the page grows with every list. | `guards/[id]/page.tsx` | the UX complaint | fixed-height workspace (Stage 3) |
| B12 | **Location state wording**: the Device card says "Location unavailable" (monitoring state) next to a panel with a valid requested fix. Both are true; the labels do not say which concept they describe. | `DevicePanel`, `GuardLocationPanel` | administrators misread | four named concepts: connection · monitoring · last verified position (with source) · geofence assessment |

## C. Suspected (need a device or production data)

- Android 17 behaviour of the foreground service (`specialUse|location`) and background location: not testable here; Android 14/15 rules are satisfied in the manifest. Recorded in the device test plan.
- OEM battery managers killing the service: mitigated by WorkManager; cannot be eliminated.
- Vercel in-memory rate limits are per instance; a WAF rule is still recommended for `/api/gateways/activate` and `/login`.

## D. Security risks (beyond B5–B9)

- Device tokens are hashed at rest and checked per request; replay is prevented by the unique `eventId`. OK.
- Webhook (Sendai) signature check exists (`SMS_WEBHOOK_SECRET`); default `change-me` is flagged by the new env check.
- Browser keys (`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `NEXT_PUBLIC_MAPTILER_KEY`) must be referrer-restricted at the provider (documented).

## E. Production blockers (unchanged from `PRODUCTION_READINESS.md`)

1. Release keystore (the release APK is still signed with the debug key here).
2. Device run of `DEVICE_TEST_PLAN.md`, now including L1–L9 (location requests) and U1–U12 (dashboard).
3. Real site coordinates for the live sites (several still carry `TEST` values).
4. Production domain, SMS provider credentials and `AUTH_SECRET` are not in the repository and must be supplied.

## F. Temporary instrumentation

`grep` for `console.log`/`console.debug` in `src/` finds one line: the automation scheduler's startup notice. No `[LOCATION API DIAGNOSTIC]`, `[API HANDLER ERROR]`, test credentials or local addresses remain in the source. The only `172.20.10.3` mentions are documentation examples and the secure-context guidance text.
