# Automatic GPS attendance at shift start

From v1.8 a guard with an Android guard phone is checked in by the phone's position at the start of
the shift, without having to call. A call is still recorded when it happens, and can be required
as a separate rule (below). Guards on feature phones are unaffected: their attendance is still the
SMS arrival check.

## When the server asks

For each shift with an Android guard phone, the engine asks the phone for a fresh GPS fix:

1. 10 minutes before the scheduled start (`checkin.autoBeforeMinutes`),
2. at the scheduled start,
3. at the end of the grace period (`checkin.graceMinutes`, overridable per site or shift).

The phone also sends positions on its own while monitoring; any fix from 10 minutes before the start
to the end of the shift counts. A fix older than the window, or one the phone took before the server
asked, is not used. The phone's clock is corrected from the time it sent the upload, so a phone
with a wrong clock cannot make an early fix look on time.

The accuracy limit is the site's (default ±100 m). A fix less accurate than the limit is never
accepted as "inside"; it leaves the check-in as *location uncertain*, and the next request tries
again. The limit is not relaxed to get a result.

## What the guard's row can become

| Status | Meaning |
|---|---|
| Location pending | The window is open and no usable fix has arrived yet. |
| Verified on time / within grace / late | A fix inside the fence, with lateness from the GPS capture time. |
| Outside the site | A usable fix, outside the fence. Raised to the supervisor after the grace period. |
| Location uncertain / unavailable | Fixes too vague, or none (location off, permission removed). |
| Device offline | No fix and the phone has not been heard from. **Not** reported as absent, to the supervisor or the client. |
| Missed | The phone was online, the window closed, and nothing put the guard on site. |
| Manually approved / rejected | A supervisor decided; shown as manual, never as GPS. |

Escalation (supervisor notification) happens `checkin.escalationMinutes` after the grace period.

## Presence and the call are separate

`checkin.callRequired` (off by default) decides whether a check-in call is also expected. With it
on, a guard verified on site by GPS but with no call is shown as **call outstanding**, a compliance
gap, not an absence; the supervisor is told once. A call made after GPS verification is recorded
against the same shift ("call recorded: presence already verified").

## Effect on the SMS arrival prompt

With `checkin.autoGps` on, a guard verified by GPS is marked on duty and the pending SMS arrival
question is cleared, so they are not texted "have you arrived?" after the system already knows. A
later YES is only logged. Switching `checkin.autoGps` off restores the previous rule (SMS first, GPS
as corroboration).

## Client message

If the site reports arrivals to the client (`notifyClientArrival`), a GPS-verified check-in sends the
"guard verified on site" update, once per shift, whether the SMS YES or the GPS check-in came first.
See `CLIENT_NOTIFICATIONS.md`.

## Settings

`checkin.autoGps` (on), `checkin.autoBeforeMinutes` (10), `checkin.graceMinutes` (5),
`checkin.escalationMinutes` (15), `checkin.callRequired` (off), `checkin.maxClockSkewMinutes` (10).
Settings are cached for 15 seconds.

## Tests

`npx tsx scripts/dev/auto-checkin-e2e.ts` (48 checks) and `check-in-e2e.ts` (48) against a local
database. Neither uses a phone: **real GPS behaviour still needs the device test plan**
(`DEVICE_TEST_PLAN.md`, section "Automatic check-in").
