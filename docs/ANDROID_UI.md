# Android UI (v1.7)

Visual language: off-white background, white 16 dp-radius cards with a soft shadow, one icon per card in a tinted circle (green verified · amber unknown/waiting · red emergency/outside · grey off), bold headline per card, a two-column stat box in the GPS and sync cards, a full-width red EMERGENCY button with a warning icon, quick actions as full-width 64 dp rows, filled green primary buttons and outlined secondary ones, all ≥ 48 dp tall. Material Components (Views/XML); no new UI framework. Every control is mapped to its real handler in `ANDROID_UI_AUDIT.md`.

One APK, two dashboards chosen by the device's mode. Both are a single scrolling column of cards; each card states one fact so that *device offline*, *GPS unknown*, *outside site*, *queued* and *acknowledged* can never be read as each other.

## Guard mode

| Card | Shows | Actions |
|---|---|---|
| **Connection** | ONLINE / OFFLINE / REVOKED, network type, guard name, the app-state line (connected, no internet with n saved, permission needed, device revoked) | Grant permissions / Allow running in background appear only when needed; **Diagnostics** opens Settings |
| **Quick actions** | the red **EMERGENCY** button; Need assistance · Shift going well · More… as full-width rows; "n alert(s) waiting for operations" while any is unacknowledged | EMERGENCY, Need assistance and Shift going well are sent **from the dashboard** through the shared `AlertFlow` (confirmation for emergency, message dialog for assistance); a feedback banner under the button says delivered / saved on the phone, with or without a position; More… opens the Alerts screen |
| **Shift** | ON SHIFT HH:MM–HH:MM / UPCOMING / NO SHIFT; **Duty site** with radius, shift-specific fence, TEST-coordinates warning, config version | — |
| **GPS verification** | icon + headline (Inside the site / Outside reading · confirming / Outside the site / Location not verified / Checking location… / Not on shift) with the reason underneath; a stat box with LAST CHECK (time, distance, ±accuracy) and ACCURACY (±m vs the limit) in two columns, and STATUS (Verified / Not verified / Outside / Off, plus the location permission) on its own full-width line (poor accuracy with the measured ±m vs the limit, no fix, location off, permission, site has no coordinates, boundary); **Monitoring**: on every n min (offline too) / outside updating every n min / battery saver / will stop with the screen off; **Last check** with time, verdict, distance and ±accuracy to one decimal; location permission line | **Check location now** (joins a running check, never cancels it) |
| **Sync** | UP TO DATE / SENDING / QUEUED / NO INTERNET n saved / RETRYING / rejected events; pending and rejected counts; last event sync and last heartbeat in a two-column stat box below | **Sync now** (outbox + heartbeat; never touches GPS) |
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
- Works on a 5-inch screen at 320 dp width, and `npm run android:layout` is what says so rather than
  anyone's eye: it measures each layout the way LinearLayout does and reports any text given less
  room than its words need. Three findings it caught, all invisible on a 411 dp test phone and all
  fixed in v1.7: the 26 sp status word left about 50 dp beside the network block, the three quick
  tiles left each label 22 dp of a 360 dp screen, and "ACCURACY" wanted 72 dp of a 56 dp column.
- Every target a finger has to hit is at least 48 dp, Android's own floor.
- A granted permission's button disappears on the onboarding screen: five identical green buttons
  told the guard nothing about which step was theirs.
