# Android UI (v1.8)

Material 3 (Views/XML, `Theme.Material3.Light.NoActionBar`), light only: off-white ground, white
cards with a hairline outline and 16 dp corners, sentence-case buttons, status chips (a soft tinted
pill with a dot and one or two words), Material Symbols icons. Every target a finger has to hit is
at least 48 dp. Every control calls the handler it called in v1.7 (see `ANDROID_UI_AUDIT.md`).

One APK, two home screens chosen by the device's mode. The drawing lives in `ui/HomeScreen.kt` and
works from a `HomeFacts` value that MainActivity reads from the phone, so the same code can be fed
made-up facts for screenshots (below).

## Home, guard mode (top to bottom)

| Area | Shows | Actions |
|---|---|---|
| **Header** (fixed) | guard name; "Guard phone · Mobile data"; a chip: Online / No internet / Reconnecting / Action needed / Revoked | settings icon → Diagnostics |
| **Attention** (only when needed) | one banner: revoked, permission missing, offline with n events saved, battery saving | Grant permissions / Allow running in background, only when they apply |
| **Shift** (the primary area) | chip On shift / Next shift / No shift; the hours in 30 sp; "Ends tomorrow at 06:00" or "Today · location checks begin 10 minutes before"; duty site with radius, shift-specific fence or TEST coordinates; a row with the phone's last reading: inside the site at HH:MM / checking / outside · confirming / outside · operations told / not verified yet | — |
| **Primary actions** | EMERGENCY (76 dp, red); Need assistance · Shift going well · More… as 56 dp rows; "n alerts waiting for operations" | sent through `AlertFlow`, as before |
| **Location** | headline and reason; one line: last check, distance from the site, ±accuracy and the limit; how often it checks | Check location now |
| **Sent to operations** | the last three alerts and requests with their delivery or acknowledgement | See all → Alerts screen |
| **Sync footer** (fixed) | Up to date / Waiting to send / Saved on the phone / Retrying / Device revoked, with when the last event went and when the server last answered | Sync now (outbox and heartbeat; never touches GPS) |

The presence row is worded as **the phone's reading**, never as the attendance verdict. The server
decides attendance (automatic GPS check-in, see `AUTOMATIC_ATTENDANCE.md`) and the portal shows it.

## Home, operations gateway mode

Header and attention as above; a call-monitoring card (Monitoring calls / Partly monitoring / Not
monitoring, why, and the last call); recent call events with delivery state; a note that a call the
portal asks for opens a screen to confirm and starts only when the operator taps Call; sync footer.

## Diagnostics

Device (name, phone, registration site, app version, battery, background allowance, model; moved
here from the home screen), connection, server, device id, heartbeat, queue, last error, versions,
sync engine with the last 15 runs, Test connection, Deactivate.

## Edge to edge

Android 15 draws every app edge to edge, and the app targets SDK 35. Every screen pads itself with
`ui/Insets.kt`: the home screen takes the status bar on its root and the navigation bar on the sync
footer, so the footer's white runs behind the gesture bar; the other screens take both on the root.

## Screenshots without a phone

    cd android && ./gradlew -Pscreenshots :app:recordPaparazziDebug

renders `src/screenshotTest` with Paparazzi (layoutlib on the JVM) into `app/src/test/snapshots/images`:
the guard home on shift, outside, next shift, permission needed; at 393 dp, at 320 dp (offline with
events queued, and the whole screen top to bottom), and at 1.3× text; operations mode; and the other
screens unbound. The plugin is applied only with `-Pscreenshots`, so normal builds do not change.

These are renders, not a device: no GPS, no service, no real insets, no OEM font. The redesign has
**not been checked on a physical phone**; see the device checklist in `RELEASE_READINESS.md`.

## Alerts screen (guard mode)

EMERGENCY (72 dp, red, confirmation dialog) · Need assistance · Report incident · Security alert · Running late · Shift going well · Status update · Shift handover · Call operations · a feedback line after each send (sent with/without position, or SAVED ON THE PHONE · NOT yet received) · the full history with states · privacy line.

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
