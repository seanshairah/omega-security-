# Call-triggered check-in, GPS verification and late attendance

A guard rings in at the start of a shift. The system asks that guard's registered phone for a fresh
GPS fix, compares it with the duty site's geofence, and records attendance only if the fix places
the guard on site. The call alone is never attendance.

## The three separate things

| Thing | Means | Does not mean |
|---|---|---|
| **Call received** | A call from the guard's own registered phone arrived inside the check-in window | That the guard is at the site |
| **Fix captured** | That phone reported a position, with an accuracy and a capture time | That the position is acceptable |
| **Attendance verified** | The fix placed the guard inside the geofence, allowing for its accuracy | That the guard stayed |

## The flow

1. **Expectation.** As a shift approaches its start, the minute scheduler opens one check-in row
   (`AWAITING`). One row per shift, enforced by a unique key, so concurrent processing cannot
   produce two attendance decisions.
2. **Call.** A call recorded by the guard's registered phone, inside the window, moves the row to
   `CALL_RECEIVED`. Caller ID alone is never enough: the flag comes from the device's authenticated
   event, not from the number on the line. When authorised check-in numbers are configured, the call
   must be to one of them.
3. **GPS request.** The server creates a location request against that phone, purpose `CHECKIN`, and
   the row moves to `GPS_PENDING`. This reuses the existing command path, so the phone needs no new
   protocol. After a call the phone polls for commands promptly rather than waiting for its next
   cycle.
4. **Verification.** The fix is classified by the existing accuracy-aware geofence rule. Inside
   requires `distance + accuracy ≤ radius`; outside requires `distance − accuracy > radius`;
   anything else is uncertain and is never approved.
5. **Attendance.** On a verified fix the attendance record, the shift status and the check-in row are
   written in one transaction.
6. **Escalation.** Nothing acceptable within the grace period plus the escalation window makes the
   row `MISSED` and notifies the supervisor once.

## Grace period and lateness

```
lateMinutes = max(0, ceil((verifiedArrivalAt − shiftStartAt − grace) / 60s))
```

Both figures are stored: `minutesAfterStart` is the whole minutes since the scheduled start, and
`lateMinutes` counts only beyond the grace period.

| Shift start | Verified arrival | Result | Late beyond grace |
|---|---|---|---|
| 18:00 | 17:58 | Early | 0 min |
| 18:00 | 18:00 | On time | 0 min |
| 18:00 | 18:04 | Within grace | 0 min |
| 18:00 | 18:05 | Within grace | 0 min |
| 18:00 | 18:06 | Late | 1 min |
| 18:00 | 18:12 | Late | 7 min |
| 18:00 | 18:30 | Late | 25 min |

The grace period is a company setting, overridable per site (`Location.checkInGraceMinutes`) and per
shift (`Shift.checkInGraceMinutes`). Most specific wins.

**The arrival time is the GPS capture time**, not the call time and not the moment the server
finished processing. A slow upload cannot make a punctual guard late. A phone clock that disagrees
with the server beyond the configured skew is replaced by the server's receipt time, so a clock set
backwards cannot make a late guard punctual either.

## Statuses

`AWAITING`, `CALL_RECEIVED`, `GPS_PENDING`, `VERIFIED_ON_TIME`, `VERIFIED_WITHIN_GRACE`,
`VERIFIED_LATE`, `OUTSIDE_AREA`, `LOCATION_UNCERTAIN`, `LOCATION_UNAVAILABLE`,
`SITE_NOT_CONFIGURED`, `MISSED`, `MANUAL_REVIEW`, `MANUALLY_APPROVED`, `MANUALLY_REJECTED`.

A manual decision is always recorded as source `MANUAL` with the previous status kept, so an
override is never presented as GPS verification.

## Feature-phone guards

A guard with no activated Android phone gets a check-in row with source `SMS_ONLY` and a reason
saying GPS cannot verify them. **They are never escalated as a missed check-in by this feature**:
their attendance is decided by the existing SMS arrival flow, which has its own reminder and
escalation. Two contradictory verdicts on one shift would be worse than none.

## Fraud resistance

| Attempt | Why it fails |
|---|---|
| Call from an unregistered number | The check-in requires the guard's own registered, activated device; the call event is authenticated by the device token |
| Replayed call event | `@@unique([gatewayDeviceId, callId])` makes the second one a no-op |
| Replayed GPS result | `DeviceLocationRequest.resultEventId` is unique; a second result is ignored |
| Stale fix presented as an arrival | The fix must fall inside the correlation window around the call, and must not be older than the configured limit |
| Mock location | The phone reports it; the row goes to `MANUAL_REVIEW` and is never verified |
| Clock set back to appear on time | Device timestamps beyond the accepted skew are replaced by the server's receipt time |
| Checking in for another guard | The device is bound to one guard; a request to a device registered to someone else is refused |
| Second fix to overwrite a verdict | A settled verification is not re-opened by a later fix |
| Unaudited manual change | A decision requires a reason and writes an audit row with user, time, reason, previous and new status |

## Settings

| Key | Default | Meaning |
|---|---|---|
| `checkin.enabled` | true | Expect a check-in call at the start of every shift |
| `checkin.graceMinutes` | 5 | Minutes after the start that still count as on time |
| `checkin.windowBeforeMinutes` | 60 | How early a call may come and still count |
| `checkin.windowAfterMinutes` | 120 | How late a call may come and still count |
| `checkin.correlationMinutes` | 10 | How long after the call a fix still evidences that arrival |
| `checkin.escalationMinutes` | 15 | Minutes after grace before the check-in is raised as missed |
| `checkin.maxGpsAttempts` | 3 | How many times the phone is asked before giving up |
| `checkin.numbers` | blank | Authorised check-in numbers; blank accepts any registered gateway |
| `checkin.maxClockSkewMinutes` | 10 | Accepted difference between phone and server clocks |

## Where it appears

- **Operations → Check-ins** (`/attendance/check-ins`): needs attention, late arrivals, verified and
  all, with the four timestamps, distance and accuracy on one row, plus request-fix, approve and
  reject for supervisors.
- **Shift page**: the same row above the shift's location card.

## Verification

```bash
npm test                          # includes tests/check-in.test.ts
npm run test:check-in             # scripts/dev/check-in-e2e.ts against a local database
```

### Not verified here

The Android changes were built and unit-tested but **not exercised on a physical handset**. The
following need a real device and are listed in `DEVICE_TEST_PLAN.md`:

- that a real call triggers the prompt command poll on the handset;
- behaviour when the phone is in Doze or under an aggressive battery manager at the moment of the
  check-in call;
- GPS acquisition time indoors at a real site, which decides how often `LOCATION_UNCERTAIN` occurs
  in practice.
