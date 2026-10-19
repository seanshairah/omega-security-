# Deployment

Production runs on Vercel (Next.js) with a Neon PostgreSQL database and Sendai for SMS. The Android app is side-loaded onto the gateway phones.

## 1. Database

1. Create a Neon project (or any PostgreSQL 16). Copy the pooled connection string with `sslmode=require`.
2. Apply migrations from your machine: `DATABASE_URL='…' npx prisma migrate deploy` (if port 5432 is blocked on your network: `DATABASE_URL='…' npx tsx scripts/neon-migrate.ts`). Confirm with `DATABASE_URL='…' npm run db:migration-status`.
3. Create the super admin and defaults: `DATABASE_URL='…' ADMIN_PASSWORD='…' npm run db:seed`. Re-running it after an upgrade adds any new settings and templates (for example the `gateway.*` settings) without touching data.

Every upgrade that ships a new folder under `prisma/migrations` needs step 2 again. Migrations are additive; nothing drops production data.

## 2. Backend + frontend (Vercel)

Import the repository (framework Next.js; `vercel.json` pins the install and build commands). Environment variables:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Neon pooled string |
| `AUTH_SECRET` | 32+ random characters |
| `SMS_PROVIDER` | `sendai` |
| `SMS_API_KEY` | Sendai `sk_…` |
| `SMS_SENDER_ID` | approved Sendai sender identity |
| `SMS_WEBHOOK_SECRET` | Sendai webhook signing secret |
| `AUTOMATION_INPROCESS` | `false` |
| `AUTOMATION_SECRET` | random string for the external per-minute cron |
| `CRON_SECRET` | random string for the Vercel daily cron |
| `TIMEZONE` | `Africa/Harare` |
| `NEXT_PUBLIC_APP_URL` | `https://<your-domain>` (shown on the gateway activation card; must match what the phones use) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | browser push (optional) |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | browser key for the duty-site map picker, restricted to the portal's domain (optional; OpenStreetMap is used without it). See GOOGLE_MAPS_CONFIGURATION.md |

No new secret is required for the call gateway: devices authenticate with tokens issued at activation and stored hashed in the database.

Automation: the engine must run every minute. `vercel.json` has a daily safety cron; the per-minute tick comes from the GitHub Actions workflow `.github/workflows/automation-tick.yml` (secrets `APP_URL`, `AUTOMATION_SECRET`) or any external cron calling `POST /api/automation/tick` with `Authorization: Bearer <AUTOMATION_SECRET>`. The same tick marks silent gateway phones offline and applies call retention.

## 3. SMS configuration (unchanged)

In the Sendai dashboard register the sender ID, top up, enable inbound SMS, and point the inbound and delivery-report webhooks at `https://<your-domain>/api/sms/webhook/sendai` with the signing secret in `SMS_WEBHOOK_SECRET`. Settings → SMS gateway shows balances and sender identities live.

## 4. Gateway configuration

Settings → Call gateway: heartbeat interval (default 120 s), offline threshold (5 min), call retention (365 days), alert on unknown callers, alert on missed calls. Changes reach phones with the next heartbeat.

## 4b. GPS configuration

Settings → GPS and geofencing: check interval (10 min), exit verification delay (60 s), interval while outside (3 min), extended absence escalation (10 min), worst usable accuracy (100 m), overdue intervals (2), location retention (180 days). Every site that will be monitored needs latitude, longitude and a radius (Locations → Edit).

## 5. Android APK

Build a release APK with a real keystore (see LOCAL_DEVELOPMENT.md) and set the production server as the default: `GATEWAY_DEFAULT_SERVER_URL=https://<your-domain> npm run android:release`. Distribute `artifacts/android/security-gateway-release.apk` and follow ANDROID_INSTALLATION.md on each phone. Register each phone under Gateway phones and activate it with its code.

## 6. Production security checklist

- The server refuses to start in production when `AUTH_SECRET` is unset or the example default (set 32+ random characters; shorter values warn). Vercel preview deployments also run with `NODE_ENV=production`, so set it for the Preview environment too. Other example defaults are logged as `[config]` warnings and counted in `/api/health` → `config.configIssues`.
- Security headers (HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy) are set by `next.config.ts` for every response.
- Sign-in is throttled (10 failures per 15 minutes per address and per account, audited as `LOGIN_THROTTLED`).
- The simulator page and `/api/gateways/simulate` are off in production unless `SMS_PROVIDER=simulated` or `SIMULATOR_ENABLED=true`.
- Full release procedure: `docs/RELEASE_RUNBOOK.md`.

- HTTPS only (Vercel provides it; the app refuses plain HTTP).
- Rotate `AUTH_SECRET`, `AUTOMATION_SECRET`, `CRON_SECRET` from the defaults; never commit `.env`.
- Keep the super admin password long; create named users for each operator (Users page) instead of sharing one login.
- Revoke lost or stolen gateway phones immediately (Gateway phones → Revoke); the token stops working on the next request.
- The portal's rate limiter is per instance on Vercel; if you expect hostile traffic on `/api/gateways/activate`, add a WAF rule or Vercel Firewall rate limit on that path.
- Review the audit log (super admin) for `GATEWAY_*` and `CALL_*` actions.
