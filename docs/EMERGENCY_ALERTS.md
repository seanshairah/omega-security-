# Emergency Alerts (guard app)

The red **EMERGENCY** button on the guard's phone, end to end. The SMS keyword flow (texting `EMERGENCY` to the control-room number) is unchanged and remains the path for feature-phone guards and the fallback when a smartphone has no data.

## 1. On the phone

1. The guard taps **EMERGENCY** (dashboard or Alerts screen) and confirms *SEND EMERGENCY* in a dialog. No long-press tricks, no accidental sends.
2. `AlertSender` writes an `EMERGENCY` event to the durable outbox **first** (SQLite, priority `EMERGENCY`), with:
   - the shift id the phone is monitoring, if any;
   - the **last known fix** (latitude, longitude, accuracy, INSIDE/OUTSIDE/UNKNOWN, and its age in seconds). It does **not** wait for a fresh GPS fix: the alert goes with what the phone has, and a location check is requested in parallel so a fresh `LOCATION_CHECK` follows within the minute.
3. The sync engine is triggered at once (`Trigger.EMERGENCY`); emergency rows go before everything else and retry with a backoff capped at 60 s.
4. What the guard sees:
   - **Online:** "EMERGENCY SENT with your last position. Operations has been alerted." plus an offer to call the control room (`ACTION_DIAL`, no call permission needed).
   - **Offline:** "EMERGENCY NOT DELIVERED YET" with the plain statement that it is saved and will be sent automatically, and two buttons that work without data: **Call operations** and **Send SMS instead** (pre-filled `EMERGENCY <name> at <site>` to the control-room number, which goes through the existing SMS pipeline).
5. The Alerts screen and the dashboard's *Sent to operations* card show the state of each alert: *Saved on the phone · waiting for internet* → *Received by the server HH:MM · waiting for operations* → *Acknowledged by <name> HH:MM · "<note>"* → *Handled*.

## 2. On the server (`src/lib/gateway/alerts.ts`)

For an `EMERGENCY` event from a guard-mode device:

| Step | Result |
|---|---|
| Store | `GuardAlert` row: `OPEN`, `requiresAck`, message, position + accuracy + state + age, `occurredAt` = when pressed, `receivedAt` = now, `syncStatus` LIVE / SYNCED / SYNCED_LATE |
| Incident | `Incident` category `EMERGENCY`, severity `CRITICAL`, source `APP`, linked to the alert |
| Shift | status raised to `CRITICAL` with `emergencyAt` (never downgraded later) |
| Timeline | `EMERGENCY` check-in line with the message and the position wording |
| Notification | `CRITICAL`: "EMERGENCY ALERT RECEIVED FROM <GUARD> — <SITE> — HH:MM", with the guard's phone and the supervisor; push to all subscribed browsers |
| Ack | `ok` (or `duplicate` on replay; the row is created once) |

Position wording is deliberately careful: "inside <site> ±9 m", "outside <site> ±40 m, 12 min old", "position unverified" or "No position available at the time of the alert". A stale or vague fix is never turned into a confident "outside".

## 3. In the portal

- **Guard alerts** (`/alerts`): open alerts first, with guard, type, message, where, status, and **Acknowledge** / **Resolve** buttons (supervisors and above). Acknowledging records who and when, an optional note to the guard, acknowledges the linked incident, and writes a timeline line.
- **Overview** dashboard: a red "Guard alerts from phones" card while any alert is open; the sidebar shows the open count.
- The guard's **Communication** tab and the shift **Timeline** carry the alert and its acknowledgement.
- Incidents opened by alerts appear under Incidents as usual.

## 4. Back to the phone

Every heartbeat (default 2 min) returns the guard's alerts of the last 48 h with their status, acknowledger, time and note. The phone updates its `comm_log`, so the guard sees "Acknowledged by Rutendo Makoni 14:07 · 'Response unit dispatched'" without opening anything.

## 5. Offline and failure behaviour

| Situation | Behaviour |
|---|---|
| No internet | Saved; sent automatically on reconnect with the original time (`SYNCED_LATE`); guard told plainly it has **not** reached operations and offered call / SMS |
| Phone dies or app killed after pressing | Row is already in SQLite; sent on next start |
| Server rejects (malformed) | Row marked `FAILED`; guard told "Rejected by the server · tell your supervisor" |
| Device revoked | 401; nothing sent; dashboard says DEVICE REVOKED |
| No GPS fix ever | Alert sent without a position; the notification says so; a check is requested |
| Sent twice (retry after lost ack) | Second is `duplicate`; one alert, one incident |

## 6. Tests

- `tests/alerts.test.ts`: metadata, validation, position wording.
- `scripts/dev/alerts-e2e.ts` (20 checks): emergency with and without a fix, duplicate replay, all seven status types, late sync time, acknowledgement on the heartbeat, incident acknowledgement, ops gateway and revoked device refusals, SMS EMERGENCY keyword regression.
- Device-only (unverified until run on hardware): the confirmation dialog, the offline fallback dialog with dialer and SMS intents, the acknowledgement appearing on the phone.
