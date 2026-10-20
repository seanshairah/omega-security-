# Upgrade audit: automatic attendance, gateway calling, client notifications, app redesign

Audited 20 October 2026 against `main` at `587cd38`, plus read-only checks of production at 16:20Z
and 17:53Z the same evening. Each finding names where it lives and what it changes in the plan.

## Confirmed in production tonight

| # | Finding | Evidence | Consequence |
|---|---|---|---|
| P1 | The minute scheduler is not running every minute. The GitHub `*/5` schedule fired at 01:42, 06:36, 12:04 and 16:50Z. | `Automation tick` runs 43–48 | The 16:00Z shifts got their arrival text at 16:50, fifty minutes late. Anything time-critical (arrival texts, shift-start GPS, escalation) inherits that lag. |
| P2 | Every outbound SMS since 15 October has failed: `Sendai 402: insufficient funds` (18), `unknown or unapproved sender id` (4). | `SmsMessage.error` | No guard or client has been texted. An account matter, not code. |
| P3 | A failed arrival text is recorded as sent and never retried. | `engine.ts` sets `arrivalSmsSentAt` before `sendTemplated`, and nothing looks at the result | After the top-up, tonight's two guards still never receive their first text. |
| P4 | The phone named "control room 1" is registered in **guard** mode. | `GatewayDevice.mode = GUARD` | It cannot act as an operations gateway, so it could not place calls for the control room even once calling exists. Re-register it as *Operations gateway* in the portal. |

## Code findings

| # | Area | Finding | Where |
|---|---|---|---|
| C1 | Attendance | A check-in only starts when the guard calls. Monitoring fixes never reach it: the `MONITORING` source exists in the schema and nothing writes it. | `check-in-service.ts`, `location-events.ts` |
| C2 | Attendance | A fix taken before the start time is matched to a shift only if the phone names the shift. The server falls back to `findLiveShiftForGuard`, which only finds a shift already under way, so a 21:52 fix for a 22:00 shift is lost. | `location-events.ts` |
| C3 | Attendance | A call and a GPS fix share one status. There is no way to say "GPS verified, required call still outstanding". | `AttendanceCheckIn.status` |
| C4 | Attendance | Escalation turns every unresolved row into `MISSED`, including "the phone is offline" and "GPS was too vague". The brief requires those to stay distinct. | `runCheckInStep` |
| C5 | Commands | Only guard-mode phones receive commands. An operations gateway has no command channel at all. | `pendingCommandsForDevice`, `GatewayService` |
| C6 | Calling | Nothing exists for an outbound call from the portal. The control-room phone already *reports* every call (number, direction, duration), which is how a placed call can be confirmed honestly. | `CallMonitor.kt`, `events.ts` |
| C7 | Client notifications | Three automatic SMS (arrival, all well, shift ended) per site, plus a hand-written emergency text from an incident. There is no manual composer, no history beyond the SMS log, and no rules for late, outside, missed or emergency. | `client-updates.ts`, `incidents.ts` |
| C8 | Android UI | XML views with view binding, no Compose, no Capacitor. One activity per screen. The home screen leads with connection, then actions, then shift; the brief wants the shift first. There is no edge-to-edge or inset handling, and diagnostics text is on the home screen. | `res/layout/*.xml`, `MainActivity.kt` |

## Android calling, what the platform allows

- `ACTION_CALL` places a call with no extra tap, but needs the `CALL_PHONE` runtime permission and an activity started from the foreground.
- Since Android 10, an app in the background cannot start an activity. A command arriving in the background service therefore cannot dial by itself.
- The supported route is a high-priority notification. The operator taps it, which brings the app forward, and the app then dials. Becoming the default dialer or using device-owner mode would remove the tap, but both change the phone's role and need deliberate provisioning. They are not done here.
- Accessibility automation to press buttons is not used, by design.

So the portal can report *delivered*, *shown to the operator*, *dial started*, and then *connected* or *not answered* from the phone's own call record. It never reports a call it did not see.

## Plan

1. Scheduler and arrival retry (P1, P3): device heartbeats drive the engine when it has not run for a minute, and a failed arrival text is retried and raised once.
2. Automatic GPS attendance (C1–C4).
3. Gateway calling (C5, C6).
4. Client notifications (C7).
5. Android redesign (C8).
6. Guard Monitoring.
7. Tests, docs, readiness.
