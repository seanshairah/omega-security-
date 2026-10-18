# Troubleshooting

## The app does not detect calls

Check, in this order:

1. **Permissions.** Android Settings → Apps → Security Gateway → Permissions: *Phone* and *Call logs* must be allowed. Without *Call logs* (Android 9+) calls are detected but numbers are not: the portal shows "unknown number".
2. **Android version.** Android 7+ is required. On Android 10+ outgoing numbers only come from the call log after the call ends (the app handles this; the first event may say "unknown number" until the call ends).
3. **Service running.** The notification "Security Gateway · Online" must be visible. If not, open the app; it restarts the service. Check `adb logcat -s GatewayService CallMonitor` on a connected phone.
4. **Battery optimisation / manufacturer restrictions.** See ANDROID_INSTALLATION.md step 6. Symptoms: works for an hour after opening, then stops; works while charging only.
5. **SIM.** The call must reach this phone's SIM; a dual-SIM phone reports calls on either SIM.
6. **Network.** Call detection works offline; the events show up when data or Wi‑Fi returns. The app's Settings shows "Events waiting to send".

## Gateway shows offline in the portal

1. Internet on the phone (mobile data or Wi‑Fi). Open the app: *Status* says "NO INTERNET" if so.
2. Server URL: Settings on the phone must match the portal domain exactly, with `https://`. Use **Test connection**.
3. Activation: the device must be *Active* in Gateway phones. "DEVICE REVOKED" on the phone means it was revoked or disabled in the portal; register and activate again.
4. Token: if the admin generated a **New code** for a device, the old token is void; activate the phone again with the new code.
5. Backend: `GET https://<domain>/api/health` must return 200. Vercel logs show 401/403/429 from `/api/gateways/*`.
6. Firewall / captive portal on the Wi‑Fi: try mobile data.
7. The offline threshold (Settings → Call gateway) must be larger than the heartbeat interval; with 120 s heartbeats and a 5 min threshold one missed heartbeat does not flip the status.

## A guard is identified incorrectly, or not identified

1. **Normalisation.** Both sides are normalised to E.164 (`+263…`). Check the guard's number on the profile: `0771234567`, `263771234567` and `+263 77 123 4567` all match; a number saved under a different country code does not.
2. **Duplicate phone numbers.** Guard phone numbers are unique in the database, so two guards cannot share one. A guard who changed SIM must have the profile updated.
3. **Unknown caller.** Open the call → "Associate with an existing guard" links the calls and all other calls from that number; then update the guard's phone number so future calls match automatically.
4. Hidden or withheld numbers arrive as "unknown number" and cannot be matched.

## Duplicate calls in the log

1. Every event has an `eventId`; a replay is acknowledged as `duplicate`. If you see two rows for one call, their `callId` differs: the phone restarted mid-call (new UUID) or two gateway phones received the same call.
2. Retries: the app only deletes a queued event after the server acknowledges it; a timeout after the server already processed it is harmless.
3. The call detail page lists the raw events and what the reducer did with each one.

## Existing SMS stopped working

Treat this as a serious regression. The call gateway does not touch SMS; verify:

1. `SMS_PROVIDER`, `SMS_API_KEY`, `SMS_SENDER_ID`, `SMS_WEBHOOK_SECRET` are unchanged in the hosting environment variables.
2. Settings → SMS gateway shows "Connected", a positive balance and a verified sender identity (Sendai).
3. The webhook URL in the Sendai dashboard is still `https://<domain>/api/sms/webhook/sendai`.
4. Communications → Message logs shows outbound rows; status `FAILED` carries the provider's error.
5. The engine is ticking: `GET /api/automation/tick` with the admin session, or the GitHub Actions run history.
6. Database: `SmsMessage`, `MessageTemplate`, `Setting` rows are intact (`npx tsx scripts/dev/db-counts.ts`).
7. Rule out the gateway completely: it can be disabled by disabling every device; SMS continues regardless.

## Guard phone shows "GPS: UNKNOWN" or no checks

The dashboard now shows three separate rows: **Shift**, **GPS** (with the reason underneath) and **Sync**. Read the reason first; each one has a different fix.

| GPS reason on the phone | Meaning | Fix |
|---|---|---|
| *GPS accuracy ±121.4 m is worse than the 100 m limit* | A fix was obtained but it is too loose to decide. Not "outside". | Move to open sky and tap **Check location now**. Raise *Worst usable GPS accuracy* only for very large sites. |
| *No GPS fix* | Nothing came back within 60 s. | Near a window or outdoors; GPS does not need data or airtime. |
| *Location is switched off on the phone* | Location services are off. | Turn them on in the phone's Settings. |
| *Location permission was removed* | The app lost its location permission. | Tap **Grant permissions** → **Allow all the time**. |
| *The duty site has no coordinates* | The site was never placed on the map. | Locations → Edit → **Position and geofence**: use the map picker. |
| *Reading … is too close to the site boundary* | Distance ± accuracy straddles the fence. | Normal near the fence; the next check decides. |
| **GPS: OFF · no shift being monitored** | No shift within 10 minutes. | Create the shift; the phone picks up the config within one heartbeat. |

Other checks:

1. The **Sync** row is about internet, not GPS. *NO INTERNET · 3 event(s) saved on the phone* with *GPS: INSIDE SITE* means the guard is on site and the events will arrive later as SYNCED LATE.
2. **Check location now** never cancels a check that is already running; it joins it and runs one more afterwards. The button is disabled for a moment after each tap.
3. Battery managers: the overdue alert means the phone was online but sent no check; see the per-brand settings in ANDROID_INSTALLATION.md.
4. `adb logcat -s LocationMonitor GatewayService` shows each check, its provider and accuracy, and the classification.

## Guard shown outside but is on site

GPS error, a fence that is too small for the site, or the wrong coordinates. Check the accuracy on the event (±m), compare the map with the real site, and enlarge the radius or move the centre. The exit alert says "GPS is not exact" for this reason; call the guard.

## Events arrive late or out of order

Expected after an outage: they are marked SYNCED LATE and keep their original times. If the phone shows "Events waiting to send" for a long time with internet available, open Settings → Test connection; a revoked token or a wrong server URL is the usual cause.

## Android build fails

- `SDK location not found`: set `ANDROID_HOME` and run `npm run android:sync`.
- `Unsupported class file major version` / JDK errors: use JDK 17 or 21.
- `429 Too Many Requests` from Maven Central: the project already lists Google's mirror first; retry, or set up a Gradle proxy.
- `R8 missing class javax.annotation…`: already covered by `app/proguard-rules.pro`; if you add libraries, add their `-dontwarn` lines there.
- Release APK will not install over the existing app: different signing key. Uninstall first (the phone must be re-activated) or sign with the original key.

## Missed-call alert does not appear

Alerts for missed calls from guards on duty are always raised. For guards off duty, Settings → Call gateway → *Alert on missed calls* must be Yes. Unknown callers need *Alert on unknown callers*. "Mark handled" on the call clears its alert.
