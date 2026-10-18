# Device Test Plan (Pixel 6 Pro or any Android 10+ phone)

Everything the simulations could not prove. Each row maps to an acceptance test or a hardening item. Install the **debug** APK (`zw.co.omega.gateway.debug`) against a local or staging portal with a test guard; use the **release** APK for the two release rows. Record PASS / FAIL and attach `adb logcat -s GatewayService LocationMonitor SyncEngine AlertSender` where asked.

| # | Steps | Expected | Maps to |
|---|---|---|---|
| 1 | Activate a guard device, grant location "Allow all the time", phone, call log; press Start | Dashboard opens once; no return to onboarding on reopen or rotate | Phase 1 D1 |
| 2 | Revoke location to "While using"; reopen the app | Dashboard with "LOCATION PERMISSION NEEDED…" line and **Grant permissions**; no loop | AppState |
| 3 | With a shift active, tap **Check location now**, then **Sync now** within 5 s | logcat: one acquisition, no "cancelled"; Sync row changes independently; GPS row shows CHECKING… then a verdict | Test A |
| 4 | Tap **Check location now** five times quickly | logcat: "joined the running one" ×4, then exactly one extra check | Test B |
| 5 | Indoors, far from a window | GPS row UNKNOWN with "accuracy ±… worse than the 100 m limit" (not "turn on location"); outdoors within 60 s INSIDE with ±≤25 m | Test F |
| 6 | Airplane mode for 15 min on shift; walk out of the fence and back | Sync row "NO INTERNET · n saved"; GPS row keeps changing (INSIDE → OUTSIDE READING → OUTSIDE → INSIDE); portal shows nothing yet | Test C |
| 7 | Airplane mode off | Within 30 s Sync "UP TO DATE"; portal timeline shows exit/return with original times, SYNCED LATE badges | Test D |
| 8 | Kill the app (swipe away) mid-sync with events queued | On relaunch Sync resumes; no duplicates in the portal | Stage 3 |
| 9 | Edit the site's fence in the portal (move pin, radius 250) | Within one heartbeat the Duty site row shows the new radius and config version; device page shows "v N applied" | Test E |
| 10 | Lock the screen for 30 min on shift | Portal keeps receiving checks every 10 min (no "verification overdue") | Test G |
| 11 | Battery below 20 % | Monitoring row says "battery low, checking every 20 min"; outside updates still every 3 min | Stage 4 |
| 12 | Tap EMERGENCY, confirm | Feedback "EMERGENCY SENT with your last position"; call offer; portal red banner within seconds; `/alerts` row OPEN with position and incident | Stage 5 |
| 13 | Acknowledge it in the portal with a note | Within one heartbeat the phone shows "Acknowledged by <name> HH:MM · note" | Stage 5 |
| 14 | Airplane mode; tap EMERGENCY | "EMERGENCY NOT DELIVERED YET" dialog with **Call operations** (opens dialer) and **Send SMS instead** (opens SMS app with `EMERGENCY <name> at <site>`) | Stage 5 |
| 15 | Send Need assistance, Report incident (message), Shift going well | Each appears under "Sent to operations" with the right state progression; portal rows and incident for the report | Stage 5 |
| 16 | Operations-mode phone: receive a call from a registered guard, let it ring out | Call card: "Missed call · number" with delivery state; portal `/calls` and missed-call alert | Stage 6 / call monitoring |
| 17 | Release APK: set server to `http://…` | "Server URL must use https://" | Stage 9 |
| 18 | Release APK: `adb logcat` during a sync | No `I/` lines from the app; only `W`/`E` | Stage 9 |
| 19 | Device page after a release install | `buildType release`, no secure-storage warning | Stage 9 |

When all rows pass, replace the UNVERIFIED entries in `docs/IMPLEMENTATION_AUDIT.md` with the results and the logcat excerpts.

## Location requests (app v1.5.0)

| # | Step | Expected |
|---|---|---|
| L1 | On the guard's Location tab press **Request current location** while the phone is online and outdoors | Queued → Delivered within `commandPollSeconds` (30 s default) → Locating → Position received with ±accuracy, time and provider; the phone's Communication history shows "Operations asked for your current position" and "Position sent to operations" |
| L2 | Same, phone indoors | Position received only if accuracy is within the limit; otherwise **Failed · poor accuracy** with the coordinates shown for information |
| L3 | Same, location permission revoked | Failed · permission denied, within one poll interval |
| L4 | Same, location services off | Failed · location disabled |
| L5 | Same, phone in flight mode | Request stays Queued with the "phone has not checked in" note, then Expired after the deadline; no GPS runs when the phone reconnects after the deadline (its history shows nothing for that request) |
| L6 | Request during an active shift check | One acquisition only (Diagnostics shows no overlapping GPS run); answer uses the fresh monitoring fix if ≤ 30 s old |
| L7 | Press the button twice | Second press reuses the first request (no second GPS run) |
| L8 | Site form → **Request guard phone position** → confirm | Candidate drawn with accuracy circle; coordinates only change after confirmation; saved source "Guard phone GPS"; config version increments; the phone's next heartbeat reports the new version |
| L9 | Mock-location app enabled on the phone | Result flagged "Mock location reported"; cannot be used as a site candidate; integrity warning on the device |
