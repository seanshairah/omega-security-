# Omega Security operations portal

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

## Deploy on Vercel

1. Import the repository in Vercel (framework: Next.js). The build runs `prisma generate && next build`.
2. Add the environment variables listed below. Use the Neon connection string for `DATABASE_URL`.
3. Apply the schema once from your machine: `DATABASE_URL=… npx prisma migrate deploy`, then `npm run db:seed` for demo data.
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
npm run db:seed                 # demo data: 16 guards, 5 clients, 8 sites, a week of history, live shifts
npm run dev                     # http://localhost:3000
```

Sign in as `admin@omegasecurity.co.zw` / `Omega Security portal123!` (Mr Zveshure, super admin). Also seeded: `ops@` (operations admin), `blessing@` and `tawanda@` (supervisors), same password.

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
