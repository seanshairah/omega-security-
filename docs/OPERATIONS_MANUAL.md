# Operations manual: attendance, welfare checks and location

For control-room operators and supervisors. Developer detail is in BASIC_PHONE_ATTENDANCE.md,
WELFARE_CHECKS.md and NETWORK_LOCATION.md.

## What the labels mean

| Label | Means | Says where the guard is? |
|---|---|---|
| GPS verified | The guard app's GPS put the phone inside the site geofence | Yes |
| Network verified | The mobile network placed the phone inside the site's network area (approximate) | Yes, roughly |
| Call confirmed / By call | The guard called the operations phone from their number | **No** |
| SMS confirmed / By SMS | The guard replied by SMS | **No** |
| IVR response confirmed | The guard pressed a key on an automated welfare call | **No** |
| Manually verified / Confirmed by a supervisor | A person confirmed it | No |
| Attendance pending | A call or missed call waits for you to confirm or reject it | No |
| Simulated … · not real evidence | Produced by a test or demo provider. Never act on it as real. | No |

A call-confirmed shift is never shown as GPS-verified. If you need to know where a basic-phone guard
is, call them, or send a supervisor.

## Setting up a guard with a basic phone

1. **Guards → Edit → Phone and attendance.**
   - Phone type: *Basic / feature phone*.
   - Mobile network: as the guard tells you.
   - Attends by: *Calling the gateway phone*, *SMS replies*, or *Calls or SMS*. The chosen ways are
     switched on for the guard when you save.
2. **Gateway phone to call.** Pick the operations phone this guard should ring, or leave it on the
   site default. Calls to another gateway are flagged; Settings decides whether they are also held
   or refused.
3. **Other numbers.** Add any second SIM the guard may call from. A number shared with another guard
   is refused, because it would identify neither.
4. Make a test call from the guard's phone to the gateway, check that it appears under the gateway's
   calls, then tick **Number verified**.
5. Tell the guard: *call the operations number when you arrive, call during the shift if asked, and
   call when you leave. The call can be short; you may hang up once it is answered.*

## Clocking a guard in by phone

- **Basic phone.** The guard rings the operations phone, or you ring the guard from it and they
  answer: either clocks them in by call. An unanswered call from you does nothing.
- **Guard app.** The same calls, either way round, ask the guard's phone for its GPS position. Inside
  the site: clocked in, GPS verified. If the phone gives no usable position, the call is kept on the
  shift for you to confirm or reject.
- No call tells you where a basic-phone guard is. Neither the portal nor the operations phone can see
  the guard's cell tower; only their mobile operator could, and no operator offers that service yet.

## During a shift

- **Active operations** shows every live shift.
  - The first row of tabs filters by state: needs attention, attendance to confirm, missed welfare
    checks, not checked out, location exceptions.
  - The second row filters by phone: basic phones, guard app, phone not known.
  - The third row filters by how arrival was confirmed: GPS, network, call, SMS, supervisor, not
    confirmed.
- **Attendance to confirm.** A missed call, a very short call, a call matching two shifts, or a
  clock-out with no clock-in is held for you.
  - Open the shift, then **Attendance evidence**, then **Confirm** or **Reject**.
  - Confirming applies it at the call's time. Rejecting a provisional clock-in undoes it.
  - Call the guard first if in doubt.
- **A call synced late** (the gateway was offline) shows *reached the server late*. It is attached to
  the right shift at the time it happened. A call for a shift that has already closed never reopens it.

## Welfare checks

Set them per site under **Locations → Edit → Welfare checks**:

- Fixed times (e.g. `00:00, 03:00`) or an interval.
- The channel: SMS, a call from the operations phone, or an automated call.
- How many tries, and whether to text before escalating.

To leave a guard out, tick **No scheduled welfare checks** on the guard.

- **SMS.** The guard replies 1 (well), 2 (assistance) or 3 / INCIDENT.
- **Operations phone.** The phone asks the operator to call the guard. After speaking to them,
  confirm the pending welfare row on the shift. An answered call alone settles nothing.
- **Automated call.** Not available yet: no voice provider is contracted. Sites set to it get the SMS
  instead, and nothing pretends a call was made.
- **No answer.** The check is retried, then texted, then escalated. You get a *did not answer the
  welfare check* notification, which turns critical from the second missed check on the same shift.
  An unanswered call is not proof the guard is absent: call them and, if needed, send the supervisor.
- **Key 2 or 3 on an automated call.**
  - Key 2 creates an assistance request.
  - Key 3 is an **emergency**, handled like the SMS keyword EMERGENCY. Note that "3" by SMS means
    "incident" and asks the guard for a description.
  - Either way you are alerted at once.

## Network location (not active)

The site and guard forms have network-location fields, and Settings has a *Network location* group.
They stay off: no Zimbabwean network offers Omega a location service today. If one is contracted
later:

- each guard needs written consent, recorded on their profile;
- each site needs a network area radius;
- results appear under **Network location checks** on the shift;
- an "outside" result is a prompt to call the guard, not a finding.

## Sites without coordinates

A banner on Active operations lists sites with guards on duty but no coordinates. GPS verification
is impossible there until someone places the site on the map. Attendance by call and SMS still works.
