# Sentinel

Guard workforce and shift management for Omega Security. Admins run operations from a web portal; guards interact only by two-way SMS, so no smartphone or app is required.

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

## Stack

Next.js 15 (App Router, server actions), TypeScript, Tailwind CSS 4, Prisma 6, PostgreSQL 16 (Neon or self-hosted), Phosphor icons, Recharts.

## Run it

```bash
cp .env.example .env            # set DATABASE_URL, AUTH_SECRET, SMS_* 
npm install
npx prisma migrate deploy       # or: npx tsx scripts/neon-migrate.ts  (Neon over HTTPS when port 5432 is blocked)
npm run db:seed                 # demo data: 16 guards, 5 clients, 8 sites, a week of history, live shifts
npm run dev                     # http://localhost:3000
```

Sign in as `admin@omegasecurity.co.zw` / `Sentinel123!` (Mr Zveshure, super admin). Also seeded: `ops@` (operations admin), `blessing@` and `tawanda@` (supervisors), same password.

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

## Scripts

- `npm run db:seed` resets and reseeds demo data.
- `npm run automation:tick` runs one engine tick and prints the report.
- `node scripts/dev/shot.mjs /dashboard out.png` screenshots a page with the demo login (needs a running dev server and Chromium).
