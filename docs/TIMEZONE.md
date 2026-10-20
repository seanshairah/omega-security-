# Timezone

The company runs on Africa/Harare, UTC+2, with no daylight saving. Vercel runs functions with
`TZ=:UTC` and does not take an override — setting `TZ` in the project's environment variables did
not change what `/api/health` reports. So the application cannot rely on the host clock, and no
longer does.

## What was wrong

`src/lib/time.ts` built shift times with `new Date(y, m, d, h, mi)` and formatted them with date-fns
`format`. Both read the *process* timezone. With the process at UTC:

| | |
|---|---|
| Administrator types | `18:00` on 21 Oct, meaning 18:00 in Harare |
| Stored instant | `2026-10-21T18:00:00Z` |
| Which in Harare is | **20:00** |
| Guard arrives punctually at 18:00 Harare | `2026-10-21T16:00:00Z` |
| Arrival minus shift start | **−120 minutes** |

Everything inside the portal looked self-consistent, because the same wrong offset was applied on
the way in and on the way out. The damage showed up wherever a stored time met a real-world instant:

- **Call check-in.** The check-in window opens 60 minutes before the scheduled start. A punctual
  guard measured two hours early, so no call fell inside the window and nothing verified.
- **Automated SMS.** Arrival checks, welfare checks and completion messages fired against the
  stored instant, which is two hours after the shift actually began.
- **"Today".** `startOfToday()` was UTC midnight, which is 02:00 in Harare, so the dashboard's
  "today" ran from 02:00 to 02:00.

## What it does now

Every wall-clock conversion is anchored to `TIMEZONE` (default `Africa/Harare`), computed with
`Intl.DateTimeFormat` rather than the host clock:

- `combineDateTime(date, time)` reads the typed values as wall-clock in `TIMEZONE` and returns the
  instant they refer to.
- `fmtTime` / `fmtDate` / `fmtDateTime` / `fmtShort` render an instant as the clock in `TIMEZONE`
  would show it.
- `dateInputValue` / `timeInputValue` produce the values a date or time input should display.
- `startOfToday` / `endOfToday` are the day's boundaries in `TIMEZONE`.
- `ago()` is unchanged: elapsed time between two instants needs no timezone.

`tests/time.test.ts` runs twice, under `TZ=UTC` and under `TZ=America/New_York`, and must produce
identical results. That is the guarantee: the host clock cannot affect the answer.

```
npm run test:time
```

## Existing rows

Rows written before this change hold wall-clock times labelled as UTC. Under the corrected code they
read two hours late — a shift typed as 18:00 and stored as `18:00Z` now displays as 20:00.

`scripts/retime-wallclock.ts` moves them. It is a dry run unless given `--apply`.

```
npm run db:retime                       # show what would change
npm run db:retime -- --apply            # correct them
npm run db:retime -- --apply --undo     # move them back
```

It shifts only columns holding a time somebody typed:

- `Shift.startAt`, `Shift.endAt`
- `WelfareCheck.scheduledAt`
- `AttendanceCheckIn.scheduledStartAt`

It deliberately leaves alone every column that records when something actually happened — `CallLog`,
`LocationEvent`, `SmsMessage`, gateway heartbeats, `Attendance.arrivalConfirmedAt`. Those are
already true instants, measured rather than typed; shifting them would corrupt real measurements and
make past attendance disagree with the calls and GPS fixes that evidenced it.

**Run the correction and the deploy together.** Between the two, times are displayed two hours out.

## Keeping the old behaviour

Set `TIMEZONE=UTC`. Wall-clock values are then read and written as UTC exactly as before, and the
stored rows need no correction. This is the escape hatch if the correction has to be postponed; it
leaves the check-in window defect in place, so it is a pause, not a fix.

## Checking which state the database is in

Shifts stored at round local hours — `18:00Z`, `06:00Z` — were written by the old code, since a
corrected 18:00 Harare shift is stored as `16:00Z`.

```sql
SELECT to_char("startAt" AT TIME ZONE 'UTC','HH24:MI') AS utc_start, count(*)
FROM "Shift" GROUP BY 1 ORDER BY 2 DESC;
```
