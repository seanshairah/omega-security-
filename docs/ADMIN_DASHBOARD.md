# Unified Administration Dashboard (Phase 3, Stage 7)

One portal for everything the SMS system, the call gateway, the guard app and GPS verification produce. This page maps each required surface to where it lives, so nothing is duplicated and every route is reachable from the sidebar or from the Active operations header.

| Required surface | Where | What it shows |
|---|---|---|
| Guard location map | **Operations → Live map** (`/operations/map`) | every live shift's site fence and every Android guard's last fix (dated, with accuracy; hollow when stale), open alerts ringed in red, a list of guards without a point and why (feature phone, no fix yet, no device) |
| Active shift monitoring | **Operations → Active operations** (`/operations`) | every live shift with status, welfare, latest location state and freshness; filters for attention, on duty, upcoming, watched, location |
| Site / geofence editor | **Workforce → Locations → Edit** | the map picker (Google Maps or OpenStreetMap), radius, provenance, config version; shift-level override on the shift page |
| Emergency alert console | **Operations → Guard alerts** (`/alerts`) + the red banner on every page | emergencies and status messages from phones, acknowledge / resolve, linked incidents; SMS `EMERGENCY` keywords raise the same banner through the shift status |
| Incident management | **Operations → Incidents** | incidents from SMS, admins and the app (source `APP`), acknowledge / resolve / close |
| Location exceptions | **Operations → Location exceptions** (`/operations/exceptions`) | guards outside their site now, attendance exceptions and arrivals without a fix, verification overdue, unavailable spells with reasons, integrity warnings |
| Device management | **Communications → Devices** (`/gateways`) | every phone: mode, status, battery, permissions, location state, **sync state**, last call; per-device page with activation, panel, map, events, config version applied |
| Sync diagnostics | **Devices** list (Sync column) and each device page (Sync row) | queued / retrying / offline / rejected, last event sync, config version applied; on the phone, Settings → Sync engine |
| SMS communication history | **Communications → Message logs** (`/sms`) and the guard's Messages tab | every inbound and outbound SMS, unchanged |
| APK communication history | **Guard → Communication** tab and **Guard alerts** | alerts and status messages with acknowledgement lines, interleaved with SMS and calls |
| Call monitoring history | **Communications → Calls** (`/calls`) and the guard's Calls tab | every call seen by a gateway or guard phone, with location where available |
| Unified shift timeline | **Shift page → Timeline** | SMS checks and replies, calls, location events, app alerts and acknowledgements, admin notes, in one ordered list |

## Principles

- **One fact per column.** Device offline, GPS unknown, outside site, queued and acknowledged are separate columns and separate colours; a stale fix is drawn hollow and labelled.
- **Attendance comes from SMS.** GPS corroborates (VERIFIED / EXCEPTION / UNAVAILABLE); it never confirms arrival on its own and never marks a guard absent.
- **Feature-phone guards are first-class.** They appear on every list with "—" or "SMS attendance" where a GPS column would be, never as missing data.
- **Every link points at the record.** Rows link to the shift, guard, site or device; alerts link to their incident.

## Refresh

Active operations, Live map, Location exceptions, Guard alerts and Devices refresh every 20–30 s. The emergency banner is server-rendered on every page.
