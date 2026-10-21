# Scheduler: keeping the engine on time on Vercel

The engine (`lib/automation/engine.ts`) sends arrival texts, requests shift-start GPS fixes, retries
failed texts, escalates, and expires call requests. It has to run about once a minute. Vercel runs
no permanent process, so v1.8 runs it from three triggers, all through `runScheduledTick`
(`lib/automation/scheduler.ts`):

| Trigger | Runs the engine if it has not run for | Notes |
|---|---|---|
| A guard or gateway phone's heartbeat (every 2 min per phone) | 55 s | After the response is sent (`after()`), so the phone is never kept waiting. Works with no dashboard open. |
| An external cron calling `POST /api/automation/tick` with `Authorization: Bearer AUTOMATION_SECRET` | 20 s | The backstop when no phone is online. |
| Vercel Cron (`vercel.json`, daily on the current plan) | 20 s | Only a safety net. |

A database lease (`SchedulerLease`, 120 s) makes sure two triggers never run the engine at the same
time. `GET /api/health` reports `scheduler.lastRunAt`, its age, the source and `behind: true` when it
is more than 5 minutes old.

## Why not GitHub Actions

The `*/5` GitHub schedule fired four times on 20 October (01:42, 06:36, 12:04, 16:50Z). GitHub
delays and drops scheduled runs under load; it is not a clock.

## External cron options

With one or more phones online, heartbeats alone keep the engine within about a minute. An external
cron covers the hours when every phone is off. Prices change, so check the provider's site before
relying on these (as understood at the time of writing):

| Option | Cost | Note |
|---|---|---|
| cron-job.org | free | Every minute, custom header supported. Recommended. |
| Upstash QStash | free tier with a daily message limit, then pay per message | A minute schedule is about 1,440 calls a day. Check the current free allowance. |
| Vercel Pro plan | per-member monthly fee | Allows minute-level Vercel Cron; changes the hosting plan. Needs approval. |

None of these has been set up; that is the operator's choice (see `RELEASE_V1_8.md`).

## Turning heartbeat ticks off

Set `AUTOMATION_HEARTBEAT_TICK=false` (used for local development, where test scripts drive the
engine themselves).
