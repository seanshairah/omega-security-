# Calling a guard from the portal

**Call guard** (guard page, shift page, incident page, Active operations, Monitoring) asks an
operations gateway phone, the control room's Android phone, to call the guard. One component
(`components/calls/call-guard.tsx`) and one service (`lib/gateway/call-requests.ts`) serve every
page.

## What Android allows, and what this does

Android does not let an app in the background start a call, and this app does not try to get round
that: no accessibility automation, no hidden UI. The gateway phone receives the request and shows a
full-screen confirmation (or a high-priority notification if the screen is in use); the operator taps
**Call** once. With the `CALL_PHONE` permission the call starts directly; without it the dialler
opens with the number filled in. Removing the tap would need the app to be the default dialler or the
phone to be a managed device; neither is set up.

## States, and where each comes from

| State | Set by | Means |
|---|---|---|
| Request queued | portal | Waiting for the phone to collect it. |
| Delivered to the phone | the phone fetched the command | **Nothing has rung.** |
| Waiting for the operator | the phone showed it | Nothing has rung. |
| Dialling | the phone, when the operator tapped Call | The call was started. |
| Connected / Call completed / Not answered | **the phone's own call record** of an outgoing call to that number | Never assumed. |
| Failed / Timed out / Cancelled | phone, timeout (`calls.requestTtlSeconds`, 120 s) or portal | No call was made, unless "failed" says otherwise. |

A request that reached *Dialling* but never produced a call record in 10 minutes is shown as failed.

## Choosing the phone

Eligible: an operations gateway phone that is online, on app 1.8.0 or later, with call permission.
The site's default gateway (site form, "Calling guards from the portal") is offered first, then any
other eligible phone; the panel lists ineligible phones with the reason. A command reaches only the
phone it names.

## Safeguards

Supervisor role or above; the destination is the guard's own number from their record;
idempotency key per attempt (a double click is one call); one open request per guard; 6 requests
per user per minute and 5 per guard per 10 minutes; expiry; device-token authentication on the
phone's side; every request, acknowledgement and outcome is audited and shows on the guard's
activity feed.

## Before it works in production

1. Apply the v1.8 migration (see `RELEASE_V1_8.md`).
2. Install app 1.8.0 on the control-room phone and register it in **Operations gateway** mode ("control
   room 1" is currently registered in guard mode and cannot place calls).
3. On the phone, allow Phone, Call log and Notifications, and allow full-screen notifications if
   Android asks.

## Tests

`npx tsx scripts/dev/call-request-e2e.ts` (31 checks) runs the whole state machine with call records
uploaded the way the phone uploads them. **The confirmation screen and the actual dialling have not
been tested on a physical phone**; see `DEVICE_TEST_PLAN.md`, "Portal calling".
