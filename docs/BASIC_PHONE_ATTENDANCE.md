# Basic-phone attendance by call

A guard with an ordinary feature phone starts and finishes a shift by calling an Omega operations
gateway phone. No GPS, mobile data on the guard's phone, site coordinates, carrier API or voice
provider is involved. A call is recorded as **communication**, never as location.

## How a call becomes attendance

```
Guard dials the operations gateway phone
  → the gateway app records the call (SQLite outbox, offline-safe) and uploads CALL_STARTED / ANSWERED / ENDED
  → server dedupes by event id (GatewayEvent.eventId unique) and builds one CallLog
  → afterTransition: a terminal INCOMING call on an OPERATIONS_GATEWAY with an identified guard
  → processAttendanceCall(callLogId)               src/lib/attendance/call-attendance.ts
      1. guard identified (matchGuardByPhone: primary or alternate number; a number on two guards matches nobody)
      2. call attendance enabled for the guard and in Settings; guard-app guards are excluded
      3. shift picked by time and state (pickShiftForAttendanceCall), ambiguous → held for a person
      4. intent from timing + state, never from the number: CHECK_IN, WELFARE or CHECK_OUT (callIntent)
      5. policy applied (decideCall): CONFIRMED, PROVISIONAL, PENDING or REJECTED, with flags
      6. AttendanceEvidence row, dedupe key call:<callLogId>
      7. confirmed/provisional → applyIntent (same effect as the guard's SMS reply); pending → supervisor notified
      8. optional network check (off by default, see NETWORK_LOCATION.md)
```

The pure rules live in `src/lib/attendance/call-attendance-rules.ts` and are unit tested in
`tests/call-attendance.test.ts`.

## Which way the call goes, and which guard

| | Guard rings the operations phone | Operator rings the guard (answered) |
|---|---|---|
| Basic phone | Call attendance, as below | Call attendance, flagged OPERATOR_CALLED (`callAttendance.outgoingMode`, default CONFIRMED). Unanswered: nothing |
| Guard app (Android) | The guard's own phone is asked for a GPS fix (`handleCall` in the check-in service); the call is held as PENDING, flagged GPS_REQUESTED, and the fix settles it | Same: the operator's call asks the guard's phone for a fix |

Either phone may report the conversation (the operations phone, the guard's own phone, or both);
a second report within three minutes does not ask for a second fix. If the guard-app guard's phone
cannot be asked (none registered, revoked, not activated) the call is decided as for a basic phone.
When the fix arrives inside the geofence the guard is clocked in as GPS verified; outside, or no
usable fix, the check-in raises its exception and the held call waits for a supervisor.

## Windows (Settings → Call attendance)

| Setting | Default | Meaning |
|---|---|---|
| `callAttendance.checkInBeforeMinutes` / `AfterMinutes` | 60 / 120 | Calls in this window around the start clock the guard in |
| `callAttendance.checkOutBeforeMinutes` / `AfterMinutes` | 60 / 120 | Calls in this window around the end clock them out |
| `callAttendance.answeredMinSeconds` | 5 | Shorter answered calls are held (SHORT_CALL) |
| `callAttendance.answeredMode` | CONFIRMED | PENDING makes every call wait for a supervisor |
| `callAttendance.missedCallMode` | PENDING | PENDING, PROVISIONAL, SMS_CONFIRM or DISABLED |
| `callAttendance.wrongGatewayMode` | FLAG | FLAG, PENDING or REJECT for calls to a gateway other than the guard's |
| `callAttendance.outgoingMode` | CONFIRMED | CONFIRMED, PENDING or DISABLED for answered calls the operator makes to the guard |

A call between the two windows, while clocked in, is a welfare call. A provisional missed call can
only clock a guard in; it never clocks them out or settles a welfare check.

## Evidence

`AttendanceEvidence` (kind CHECK_IN / WELFARE / CHECK_OUT / PRESENCE; source CALL, MISSED_CALL, SMS,
GPS, NETWORK, IVR, MANUAL; status CONFIRMED, PROVISIONAL, PENDING, REJECTED) is the unified record.
Writers:

| Source | Written by | Dedupe key |
|---|---|---|
| CALL / MISSED_CALL | `processAttendanceCall` | `call:<callLogId>` |
| SMS | `smsEvidence` in the SMS pipeline after a YES / WELL | `sms:<smsMessageId>` |
| GPS | `applyFix` (check-in service) and `verifyArrival` (SMS + GPS) | `gps:checkin:<id>`, `gps:sms-arrival:<shiftId>` |
| IVR | `applyVoiceReport` | `ivr:<welfareCheckId>` |
| NETWORK | network location service, inside results only | `network:<checkId>` |
| MANUAL | manual arrival / completion actions | `manual:checkin:<shiftId>:<ms>` |
| CALL (welfare) | gateway welfare call answered, pending the operator's word | `welfare:<checkId>:gateway` |

Labels come only from `evidenceLabel` (`src/lib/attendance/evidence.ts`): GPS verified, Network
verified, Call confirmed, SMS confirmed, IVR response confirmed, Manually verified, Attendance pending.
`IS_LOCATION_EVIDENCE` is true for GPS and NETWORK only. A row flagged `SIMULATED` is always labelled
"Simulated … · not real evidence" and excluded from the operations arrival-source counts.

## Flags

OPERATOR_CALLED, GPS_REQUESTED, WRONG_GATEWAY, LATE_SYNC (uploaded more than 10 min after the call), SHORT_CALL, SHIFT_CLOSED (never
reopens a closed shift), AMBIGUOUS, MISSED_CALL, NO_CHECK_IN, LATE_CHECK_IN, SMS_CONFIRM_SENT,
SIMULATED.

## Offline gateway

The gateway app keeps every call in its SQLite outbox and uploads when it can. The server uses the
call's own timestamp to pick the shift, flags LATE_SYNC, and holds a call for a shift already closed.
Re-sent events are deduplicated by event id, and a second processing of the same call is a no-op.

## Tests

- `tests/call-attendance.test.ts`: 14 rule tests.
- `scripts/dev/basic-phone-attendance-e2e.ts` (`npm run test:basic-phone`): 25 checks through
  `processGatewayEvents`, covering cases 1–20 of the brief's basic-phone list, except 19, which is in
  `network-location-e2e.ts`.

## Cell towers

A call between a feature phone and the operations phone carries the caller's number and the call's
timing, nothing about where the phone is. Android does not expose the other party's cell tower, and
no app on the operations phone can triangulate it. Only the guard's mobile operator knows which tower
serves the guard, through an authorised location API (`NETWORK_LOCATION.md`), which none of the
Zimbabwean operators offers today.

## The engine must run

Clocking in by call happens as the call is uploaded, but moving a shift from Scheduled to Awaiting
arrival, sending the arrival SMS and asking guard phones for their shift-start fix happen in the
automation engine. It runs from an external cron, from every device heartbeat, and (since 26 October
2026) after every portal page view, each at most once a minute. A shift whose start has passed but
that the engine has not reached yet shows "Started · not checked in", never "Scheduled".
