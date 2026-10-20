# Release 1.8: readiness, deployment and rollback

Portal changes on branch `claude/brave-hopper-92o6rw`; Android app 1.8.0 (versionCode 9).
Nothing here has been deployed, migrated in production or installed on a phone.

## What is in it

| Area | Doc | State |
|---|---|---|
| Scheduler driven by phone heartbeats, lease, failed arrival texts resent | `SCHEDULER.md` | Built and tested locally. Needs an external cron for hours with no phone online. |
| Automatic GPS attendance at shift start, presence separate from the call | `AUTOMATIC_ATTENDANCE.md` | Built and tested locally. Not tested on a phone. |
| Call a guard from the portal through the operations gateway phone | `PORTAL_CALLING.md` | Built and tested locally (call records simulated). Not tested on a phone. |
| Client notifications: composer, approved recipients, rules, approvals, history | `CLIENT_NOTIFICATIONS.md` | Built and tested locally with the simulated provider. No real SMS sent (Sendai has no credit). |
| Android home screen redesign, Material 3, edge to edge | `ANDROID_UI.md` | Built; rendered with Paparazzi. **Not checked on a phone.** |
| Guard Monitoring command centre | `GUARD_WORKSPACE.md`, this file | Built; checked in a browser at 1920, 1440, 1280 and 390 px. |

## Verification run for this release

All against a local PostgreSQL with the simulated SMS provider:

| Check | Result |
|---|---|
| `tsc --noEmit`, `next lint` | clean |
| `npm run build` | passes (40 pages) |
| Unit tests (`npm test`) | 106 / 106 |
| scheduler-e2e | 17 / 17 |
| auto-checkin-e2e | 48 / 48 |
| check-in-e2e | 48 / 48 |
| call-request-e2e | 31 / 31 |
| client-notification-e2e | 51 / 51 |
| gateway-e2e, location-e2e, alerts-e2e, integration-e2e, location-request-e2e, shift-edit-e2e | 30, 38, 20, 20, 43, 22, all passing |
| client-updates-check (arrival, all well, shift ended through the new path) | 3 sent, 3 timeline events |
| layout-e2e (browser) | 30 / 30 |
| map-e2e (browser) | 23 / 24: "fleet map carries guard and site features" fails the same way without these changes; no guard phone in the local data has a position |
| Android unit tests | 55 / 55 |
| Android layout audit at 320, 360, 411 dp | 0 findings |
| Android debug and release builds | both build |

Not verified: anything on a physical Android phone (see `DEVICE_TEST_PLAN.md`, "v1.8.0"), a real
SMS or email, and the production database.

## Deployment, in this order

Every step needs the owner's approval. Merging to `main` deploys production, and **the Vercel build
does not run migrations**, so the schema has to be in place first.

1. **Back up production** (Neon branch or point-in-time restore marker).
2. **Apply the migration** `20261020190000_gps_attendance_calls_client_notifications`:
   `DATABASE_URL=<production direct URL> npx prisma migrate deploy`.
   It is additive only: three new tables (`SchedulerLease`, `CallRequest`, `ClientNotification`),
   three new enums, two new enum values (`AUTO_GPS`, `DEVICE_OFFLINE`), and new nullable or defaulted
   columns on `AttendanceCheckIn`, `GatewayDevice` and `Location`. No data is changed or removed, and
   the code now in production ignores all of it. Check with `npx tsx scripts/dev/migration-status.ts`.
3. **Merge the PR**; Vercel deploys.
4. **Check** `GET /api/health`: `scheduler.lastRunAt` should move within a few minutes of a phone's
   heartbeat, and `behind` should be false.
5. **Set up an external cron** (`SCHEDULER.md`), for example cron-job.org every minute:
   `POST https://<portal>/api/automation/tick` with `Authorization: Bearer <AUTOMATION_SECRET>`.
6. **Top up Sendai** before any client rule is switched on; until then every SMS fails, and is shown
   as failed.
7. **Android**: build a signed release once the keystore exists (`APK_DISTRIBUTION.md`), install
   1.8.0 on the control-room phone and register it in Operations gateway mode, then on guard phones.
   Phones on 1.7.0 keep working; they are just not offered for portal calls.
8. **Site settings**: switch on the client rules site by site, and set a default gateway per site
   if more than one control-room phone exists.

## Rollback

| What | How | Data |
|---|---|---|
| Portal | Promote the previous Vercel deployment (instant), or revert the merge commit. | Nothing lost. The new tables and columns stay and are ignored by the old code. |
| Automatic GPS check-in only | Settings → Check-in → turn off "Automatic GPS check-in". Takes effect within 15 s. | Restores SMS-first arrival. |
| Client rules only | Untick the rules on the site, or switch off client updates for the site. | History stays. |
| Database | Normally nothing: leave the additive migration in place. Dropping the new tables deletes their history and needs explicit approval. | |
| Android | 1.8.0 cannot be replaced by 1.7.0 in place (lower versionCode): uninstall, install 1.7.0, re-activate the phone with a new code from the portal. Queued events on the phone are lost on uninstall, so sync first. | |

## Outstanding, and whose they are

Owner or administrator:

1. Change the administrator password that was exposed earlier.
2. Create the release keystore and keep it out of git; until then the release APK is signed with the
   debug key and is **not** a production build.
3. Uninstall the 1.6.0-debug build from the test phone.
4. Top up Sendai (402 insufficient funds since 15 October) and confirm the sender ID.
5. Choose and set up an external cron (free option: cron-job.org).
6. Re-register "control room 1" in Operations gateway mode.
7. Approve and run the production migration, then the merge.
8. Run the device test plan on at least one guard phone and the control-room phone.

Known limits, by design or platform:

- The operator taps once to place a portal call; unattended dialling would need the default-dialler
  role or managed devices.
- "Connected" depends on the phone's call log; with call-log permission removed the portal stops at
  "Dialling" and then reports failed after 10 minutes.
- The heartbeat scheduler only runs while at least one phone is online; the external cron covers the
  rest.
- Email to clients needs `SENDAI_EMAIL_IDENTITY_ID`; without it email recipients are offered but
  every email fails with the provider's reason.
- Screenshots of the Android app are layoutlib renders, not a phone.
