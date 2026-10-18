# Android UI (after Phase 2)

One APK, two dashboards chosen by the device's mode. Both are a single scrolling column of cards; each card states one fact so that *device offline*, *GPS unknown*, *outside site*, *queued* and *acknowledged* can never be read as each other.

## Guard mode

| Card | Shows | Actions |
|---|---|---|
| **Connection** | ONLINE / OFFLINE / REVOKED, network type, guard name, the app-state line (connected, no internet with n saved, permission needed, device revoked) | Grant permissions / Allow running in background appear only when needed; **Diagnostics** opens Settings |
| **Quick actions** | the red **EMERGENCY** button; Need assistance · Shift going well · More…; "n alert(s) waiting for operations" while any is unacknowledged | each opens the Alerts screen on that action (confirmation for emergency, message dialog where a message is required) |
| **Shift** | ON SHIFT HH:MM–HH:MM / UPCOMING / NO SHIFT; **Duty site** with radius, shift-specific fence, TEST-coordinates warning, config version | — |
| **GPS verification** | INSIDE SITE / OUTSIDE READING · confirming / OUTSIDE SITE / UNKNOWN / CHECKING… / OFF, with the reason underneath (poor accuracy with the measured ±m vs the limit, no fix, location off, permission, site has no coordinates, boundary); **Monitoring**: on every n min (offline too) / outside updating every n min / battery saver / will stop with the screen off; **Last check** with time, verdict, distance and ±accuracy to one decimal; location permission line | **Check location now** (joins a running check, never cancels it) |
| **Sync** | UP TO DATE / SENDING / QUEUED / NO INTERNET n saved / RETRYING / rejected events; pending and rejected counts; last event sync and last heartbeat side by side | **Sync now** (outbox + heartbeat; never touches GPS) |
| **Sent to operations** | the last four alerts, status messages and calls with their delivery / acknowledgement state | **See all** → Alerts screen |
| **Device** | name, phone, registration site ("registered at", distinct from the duty site), app version; battery with saver flag, background allowed/restricted, model | — |

## Operations gateway mode

| Card | Shows | Actions |
|---|---|---|
| **Connection** | as above, with "Operations gateway phone" | — |
| **Call monitoring** | ACTIVE / NOT MONITORING (permission) / PARTIAL (no call log); last call; the last six call events with delivery state (saved on phone / delivered HH:MM / rejected) | — |
| **Sync** | as above | **Sync now** |
| **Device** | as above | — |

## Alerts screen (guard mode)

EMERGENCY (72 dp, red, confirmation dialog) · Need assistance · Report incident · Security alert · Running late · Shift going well · Status update · Shift handover · Call operations · a feedback line after each send (sent with/without position, or SAVED ON THE PHONE · NOT yet received) · the full history with states · privacy line.

## Settings (Diagnostics)

Server, device id, connection, heartbeat interval, queue, last error, app and Android versions; **Sync engine** block (state, counts, last sync, last attempt and trigger, next retry, last error, last 15 runs); Test connection; Deactivate.

## Design rules kept

- No audio, no streams: every location shown is a dated single fix with its accuracy.
- Text states say what to do ("tap Grant permissions and choose Allow all the time"), not just what is wrong.
- Buttons disable for 2.5 s after a tap so a nervous double-tap does not double-send.
- Colours: green for verified/acknowledged, amber for waiting/queued, red for emergency/rejected; never red for "unknown".
- Works on a 5-inch screen at 320 dp width: two buttons per row, 50–64 dp tall.
