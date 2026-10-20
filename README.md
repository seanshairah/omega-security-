# Omega Protection Services operations portal

Guard workforce and shift management for Omega Protection Services. Admins run operations from a web portal; guards interact only by two-way SMS, so no smartphone or app is required.

The design is documented in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): architecture, schema, user flows, API, SMS webhook flow, automation logic, dashboard structure and folder layout.

## What it does

- Guards, clients and locations, with deactivation instead of deletion.
- Shifts (8 h, 12 h, custom, overnight) and recurring weekly patterns.
- Automated SMS arrival check, grace period, reminder and escalation.
- Mid-shift welfare check (1 well, 2 assistance, 3 incident), end-of-shift completion check, handover notices.
- EMERGENCY keyword at any time: shift marked critical, incident created, admins notified, full-width alert on every page.
- A timeline per shift, an SMS log with how every reply was interpreted, dashboard notifications and an audit log.
- Attendance reports with CSV export, guard performance, client breakdown.
- A simulator so the whole workflow can be demonstrated without sending real messages.

## Documentation

| Document | What it covers |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | system design, schema, flows, API, automation, the call gateway module |
| [docs/DATABASE.md](docs/DATABASE.md) | tables, new gateway/call tables, normalisation, deduplication, retention |
| [docs/API.md](docs/API.md) | every route with auth, request and response examples |
| [docs/SMS_WORKFLOW.md](docs/SMS_WORKFLOW.md) | the existing SMS system, unchanged |
| [docs/ANDROID_GATEWAY.md](docs/ANDROID_GATEWAY.md) | the Android call gateway: app, events, backend, Android limits, privacy |
| [docs/ANDROID_INSTALLATION.md](docs/ANDROID_INSTALLATION.md) | installing and activating the app on a phone, for administrators |
| [docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md) | running everything on a fresh computer, building the APK |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Vercel, Neon, Sendai, gateway settings, APK rollout, security checklist |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | calls not detected, gateway offline, wrong guard, duplicates, location unavailable, SMS regression |
| [docs/SYSTEM_ARCHITECTURE.md](docs/SYSTEM_ARCHITECTURE.md) | the whole platform after the Android and GPS work, with diagrams |
| [docs/GUARD_ANDROID_APP.md](docs/GUARD_ANDROID_APP.md) | guard mode: permissions, location monitoring, exits and returns, calls with location |
| [docs/OPERATIONS_GATEWAY.md](docs/OPERATIONS_GATEWAY.md) | operations mode and call correlation |
| [docs/CALL_GATEWAY.md](docs/CALL_GATEWAY.md) | backend call processing |
| [docs/GPS_AND_GEOFENCING.md](docs/GPS_AND_GEOFENCING.md) | classification, state machine, alerts, battery, spoofing |
| [docs/OFFLINE_MODE.md](docs/OFFLINE_MODE.md) | what works without internet or airtime, the outbox, sync status |
| [docs/PERMISSIONS.md](docs/PERMISSIONS.md) | every Android permission and why |
| [docs/GUARD_INSTALLATION.md](docs/GUARD_INSTALLATION.md) | setting up a guard's phone |
| [docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md) | how operations staff use the portal |
| [docs/API_DOCUMENTATION.md](docs/API_DOCUMENTATION.md) | endpoints added for devices and GPS |
| [docs/SMS_INTEGRATION.md](docs/SMS_INTEGRATION.md) | how the unchanged SMS system relates to the rest |
| [docs/SECURITY_AND_PRIVACY.md](docs/SECURITY_AND_PRIVACY.md) | access control, audit, data collected, wording policy |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | notes for developers beyond local setup |
| [docs/TESTING.md](docs/TESTING.md) | suites, the 15 critical cases, what is still manual |
| [docs/IMPLEMENTATION_AUDIT.md](docs/IMPLEMENTATION_AUDIT.md) | Phase 1 audit: baseline, confirmed defects and root causes, risks, stage results |
| [docs/ANDROID_ARCHITECTURE.md](docs/ANDROID_ARCHITECTURE.md) | the app after Phase 1: monitoring coordinator, sync coordinator, app state, status rows |
| [docs/AUTO_SYNC.md](docs/AUTO_SYNC.md) | the automatic sync engine: outbox statuses, priorities, triggers, retries, diagnostics |
| [docs/CALL_CHECKIN.md](docs/CALL_CHECKIN.md) | call-triggered check-in: the qualifying call, the GPS verification, the five-minute grace rule, late arithmetic, statuses, fraud resistance and settings |
| [docs/MAPBOX.md](docs/MAPBOX.md) | the map architecture, token restriction, cost and billing alerts, telemetry, and the raster fallback |
| [docs/ICONS.md](docs/ICONS.md) | the icon system: why Material Symbols, how icons are generated, the concept map, accessibility rules |
| [docs/UX_WRITING_REVIEW.md](docs/UX_WRITING_REVIEW.md) | the interface copy review, what changed and what was deliberately left dense |
| [docs/GOOGLE_MAPS_CONFIGURATION.md](docs/GOOGLE_MAPS_CONFIGURATION.md) | the duty-site map picker, the Google Maps key, provenance and config versioning |
| [docs/OFFLINE_MONITORING.md](docs/OFFLINE_MONITORING.md) | what keeps working without internet and how the record catches up |
| [docs/DATABASE_CHANGES.md](docs/DATABASE_CHANGES.md) | every Phase 1 and 2 column, all additive |
| [docs/DEVICE_LOCATION_AND_SITE_SETUP.md](docs/DEVICE_LOCATION_AND_SITE_SETUP.md) | root cause of the wrong site centre, the confirmed-position picker, remote guard-phone location requests, using a guard phone's fix as site coordinates |
| [docs/ANDROID_UI_AUDIT.md](docs/ANDROID_UI_AUDIT.md) | every dashboard control mapped to its Android handler, event type, backend route and portal workflow |
| [docs/STAGE0_FINDINGS.md](docs/STAGE0_FINDINGS.md) | production-hardening audit: confirmed defects, risks, blockers, what is preserved |
| [docs/GUARD_WORKSPACE.md](docs/GUARD_WORKSPACE.md) | the viewport-aware guard workspace: layout, scrolling hierarchy, location-state model, polling |
| [docs/RELEASE_RUNBOOK.md](docs/RELEASE_RUNBOOK.md) | env checklist, backup, migration, deploy, Android release, smoke test, rollback, monitoring |
| [docs/EMERGENCY_ALERTS.md](docs/EMERGENCY_ALERTS.md) | the emergency button end to end: phone, outbox, server, portal, acknowledgement, offline fallback |
| [docs/GUARD_COMMUNICATION.md](docs/GUARD_COMMUNICATION.md) | status messages (assistance, incident, security, late, update, going well, handover) and how operations sees them |
| [docs/ANDROID_UI.md](docs/ANDROID_UI.md) | the redesigned guard and operations dashboards, card by card |
| [docs/ANDROID_PERMISSIONS.md](docs/ANDROID_PERMISSIONS.md) | permissions after Phase 2 (nothing new is requested for alerts) |
| [docs/ADMIN_DASHBOARD.md](docs/ADMIN_DASHBOARD.md) | every operations surface and where it lives: live map, exceptions, alerts, devices, timelines |
| [docs/INTEGRATION_VERIFICATION.md](docs/INTEGRATION_VERIFICATION.md) | the Stage 8 matrix: SMS independence, feature phones, APK/SMS compatibility, replay of every event type |
| [docs/SECURITY_HARDENING.md](docs/SECURITY_HARDENING.md) | transport, credentials, authorisation, validation, build separation, logging policy |
| [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md) | what to run and check before and after a release |
| [docs/ROLLBACK.md](docs/ROLLBACK.md) | rolling back the portal, the database and the app |
| [docs/DEVICE_TEST_PLAN.md](docs/DEVICE_TEST_PLAN.md) | the hardware runs that close the unverified items |
| [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md) | the honest readiness assessment after Phase 3 |

## Guard devices, GPS and geofencing

The same app in **Guard** mode runs on a guard's own phone. Before a shift it caches the site's coordinates, radius and timing policy; during the shift it takes one GPS fix every 10 minutes, decides locally whether the phone is inside the site, verifies an outside reading after 60 seconds before recording a **LOCATION EXIT**, updates every 3 minutes while outside, records **LOCATION RETURNED** with the time outside, and reports **LOCATION UNAVAILABLE** when it cannot see where it is. None of that needs internet or airtime; events wait in the phone's outbox and arrive marked *synced late*. A YES by SMS plus a fix inside the site gives **ARRIVAL VERIFIED**; a fix outside gives a neutral **Location exception**. Guards without a smartphone keep working by SMS and calls exactly as before.

## Call gateway

An Android phone with a SIM runs the **Security Gateway** app (`android/`). Guards call it; the app reports call metadata (never audio) to `POST /api/gateways/events`, the portal matches the number to a guard and their live shift, shows live and missed calls, alerts on missed calls from guards on duty, lists unknown callers for review, and adds calls to the shift timeline and the guard's Communication history. Register phones under **Communications → Gateway phones**; demo everything without a phone from **Simulator → Call gateway simulator**.

```bash
npm run android:build     # artifacts/android/security-gateway-{debug,release}.apk
npm run test:e2e          # the four e2e suites against a local database (needs npm run dev)
npm run db:migration-status  # compare prisma/migrations with the configured database
```

## Stack

Next.js 15 (App Router, server actions), TypeScript, Tailwind CSS 4, Prisma 6, PostgreSQL 16 (Neon or self-hosted), Mapbox GL JS with a Leaflet fallback, Material Symbols icons, Recharts.

## Deploy on Vercel

1. Import the repository in Vercel (framework: Next.js). The build runs `prisma generate && next build`.
2. Add the environment variables listed below. Use the Neon connection string for `DATABASE_URL`.
3. Apply the schema once from your machine: `DATABASE_URL=… npx prisma migrate deploy`, then `ADMIN_PASSWORD=… npm run db:seed` to create the super admin.
4. Set `AUTOMATION_INPROCESS=false`. The engine must run every minute, and Vercel Hobby only allows daily crons, so `vercel.json` schedules one daily safety run (03:00 UTC) and the per-minute tick comes from an external cron: point cron-job.org, Upstash QStash or a GitHub Actions schedule at `POST https://<your-domain>/api/automation/tick` with header `Authorization: Bearer <AUTOMATION_SECRET>`, every minute. On the Pro plan you can change the schedule in `vercel.json` to `* * * * *` instead.
5. In the Sendai dashboard, set the inbound and delivery webhooks to `https://<your-domain>/api/sms/webhook/sendai`.

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Neon connection string (pooled, `sslmode=require`) |
| `AUTH_SECRET` | long random string, 32+ characters |
| `SMS_PROVIDER` | `sendai` (or `simulated` for a demo) |
| `SMS_API_KEY` | Sendai API key `sk_…` |
| `SMS_SENDER_ID` | approved Sendai sender identity, e.g. `OMEGASEC` |
| `SMS_WEBHOOK_SECRET` | Sendai webhook signing secret `whsec_…` |
| `SMS_API_SECRET` | empty for Sendai |
| `AUTOMATION_INPROCESS` | `false` |
| `AUTOMATION_SECRET` | long random string for external cron calls |
| `CRON_SECRET` | long random string; Vercel Cron sends it as a bearer token |
| `TIMEZONE` | `Africa/Harare` |

## Run it

```bash
cp .env.example .env            # set DATABASE_URL, AUTH_SECRET, SMS_* 
npm install
npx prisma migrate deploy       # or: npx tsx scripts/neon-migrate.ts  (Neon over HTTPS when port 5432 is blocked)
ADMIN_PASSWORD=… npm run db:seed # baseline: settings, message templates and the super admin (safe to re-run)
npm run dev                     # http://localhost:3000
```

Sign in as `admin@omegasecurity.co.zw` with the password you set (Mr Kudzu Felix Zveshure, super admin). Add further users under Users.

For a demonstration database only, `npm run db:seed:demo` wipes everything and loads fictional clients, sites, guards and a week of history. `npm run db:purge` removes all operational data and every user except the super admin.

## Client site-status updates

Each site can opt in to SMS updates for its client (Locations → Edit → *Client site-status updates*): guard has arrived, everything going well after the mid-shift check, shift ended. Messages go to the site's client-update number, else the site contact, else the client's contact phone, and are logged under Message logs as *Client update*. The wording lives in the `CLIENT_*` message templates. On an emergency or critical incident the super admin can text the client from the incident page; the message is pre-filled from the `CLIENT_EMERGENCY` template and reviewed before sending.

## SMS gateway

The provider is chosen with `SMS_PROVIDER`:

| value            | gateway                                   | notes |
| ---------------- | ----------------------------------------- | ----- |
| `simulated`      | none, demo only                           | messages are logged as sent; replies come from the simulator |
| `sendai`         | [Sendai](https://sendai.co.zw), Zimbabwe   | `SMS_API_KEY=sk_…`, `SMS_SENDER_ID=<approved sender identity>`, `SMS_WEBHOOK_SECRET=whsec_…` |
| `africastalking` | Africa's Talking                           | `SMS_API_KEY`, `SMS_API_SECRET` = username |
| `twilio`         | Twilio                                     | `SMS_API_KEY` = account SID, `SMS_API_SECRET` = auth token, `SMS_SENDER_ID` = number |
| `http`           | any gateway with a JSON send endpoint      | `SMS_HTTP_SEND_URL`, `SMS_API_KEY` as bearer |

Point the gateway's inbound-message and delivery-report callbacks at `https://<host>/api/sms/webhook/<provider>`. Replies are processed by `src/lib/sms/pipeline.ts`; the pipeline identifies the guard by phone number, finds the live shift, works out which reply was expected, and updates attendance, welfare, incidents and the timeline.

For Sendai specifically: register a sender ID in the Sendai dashboard (approval takes about 30 minutes), top up the balance, ask Sendai to enable inbound SMS on the account, and create a webhook endpoint for `message.delivered` / `message.failed` with the signing secret in `SMS_WEBHOOK_SECRET`. The Settings page shows balances and sender IDs live.

## Automation

`runAutomationTick()` runs every minute inside the Next.js process (`AUTOMATION_INPROCESS=true`). For a multi-instance deployment set it to `false` and call `POST /api/automation/tick` with `Authorization: Bearer $AUTOMATION_SECRET` from cron, or run `npm run automation:tick`. Timings (grace period, escalation, welfare point, completion window, handover notice) are editable in Settings.

## REST API

All routes under `/api` take the session cookie, except the webhook and the tick. See the architecture document for the full list. Examples:

```
GET  /api/shifts/active
POST /api/shifts            { guardId, locationId, date, startTime, endTime }
POST /api/sms/simulate      { guardId | phone, body }     demo inbound
GET  /api/reports/attendance.csv?from=&to=&locationId=
```

## Tests

```bash
npm test                   # unit tests (tests/*.test.ts)
npm run test:gateway-e2e   # 33-step call-gateway scenario over HTTP against a running dev server
cd android && ./gradlew testDebugUnitTest   # Android unit tests
```

## Scripts

- `npm run db:seed:demo` resets and reseeds demo data; `npm run db:seed` only ensures the baseline.
- `npm run automation:tick` runs one engine tick and prints the report.
- `node scripts/dev/shot.mjs /dashboard out.png` screenshots a page with the demo login (needs a running dev server and Chromium).
