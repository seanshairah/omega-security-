# Administrator guide

## Daily view

- **Overview** (Home): KPIs, needs-attention list, calls card (live and missed calls, devices online).
- **Active operations**: every live shift with arrival, mid-shift check, **Location** (Inside site / Outside assigned site / Location unavailable, with live/recent/stale), status. Filter *Location exceptions*.
- **Calls**: live cards, missed calls, unknown callers; each call opens with call-back button, mark handled, raw events, the guard's location at the time.
- **Notifications** (bell): late arrival, no confirmation, assistance, incidents, emergencies, missed calls, unknown callers, location exit, extended absence, location returned, location unavailable, verification overdue, location exception, integrity warning, device offline, low battery, gateway offline. Push to browsers when enabled.

## Setting up

| Task | Where |
| --- | --- |
| Client and sites with coordinates and radius | Clients, Locations → Edit → *Position and geofence* |
| Guards | Guards → Add guard (phone number is the SMS identity) |
| Operations gateway phone | Devices → Register device → mode Operations gateway |
| Guard phone | Devices → Register device → mode Guard device → choose guard |
| Shifts and recurring patterns | Shifts → New shift / Recurring |
| SMS timings and templates | Settings → Automation; Communications → Templates |
| GPS policy | Settings → GPS and geofencing (check interval, verification delay, outside interval, escalation, accuracy limit, overdue intervals, retention) |
| Gateway policy | Settings → Call gateway (heartbeat, offline threshold, call retention, alert switches) |
| Users and roles | Users (super admin) |

## Reading a shift

Shift page: header actions (confirm arrival manually, mark completed, cancel); timeline of SMS, calls and location events in order; **Location** card with map (site, fence, latest fix, exit and return markers), latest fix freshness, event list with distance, accuracy, sync badge; attendance panel including **GPS verification**: *ARRIVAL VERIFIED*, *LOCATION EXCEPTION* (confirmed by SMS, GPS outside: phone the guard), *Location unavailable at arrival*, or *Not applicable (feature phone)*.

Wording is deliberately neutral. An exception or an exit is a reason to call the guard, not a finding of misconduct: GPS has errors, phones get left in guard houses, sites have unusual shapes.

## Devices

Devices page: mode, guard, phone, status, last seen, battery, permissions (location and phone), latest location state, last call. Device page: activation code (pending devices), **New code** (replaced phone), Edit (mode, guard, site), Disable / Enable, **Revoke** (lost or stolen phone; permanent), location map and events for guard phones, test-connection instructions.

## Reports

Reports → attendance and performance (existing), **Call report** (totals, missed, answered, average duration, unknown callers, CSV), **Location report** (shifts monitored, arrivals verified, exceptions, exits, returns, time outside, unavailable, synced late per guard) with device compliance (online, battery, permissions, app version).

## Simulator (demo and training)

Communications → Simulator: SMS replies, engine fast-forward, **Call gateway simulator** (incoming, answer, end, missed, unknown caller, gateway online/offline) and **Guard location simulator** (arrive inside, inside check, leave, remain outside, return, GPS unavailable, permission revoked, with a *synced late* switch). All of it goes through the real intake and shows up everywhere a real phone's events would.

## Audit

Super admin → Audit log. Device registration, activation, code regeneration, disable, enable, revoke, simulation, settings changes, call handling, caller linking, and **viewing a guard's location** (`LOCATION_VIEWED`) are recorded with the user, time and IP.
