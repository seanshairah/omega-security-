# Guard Communication (status messages from the app)

Besides the emergency button, a guard phone can tell operations seven things in one tap. All go through the same durable outbox and sync engine as calls and location events (there is no second delivery path), keep the time they were pressed, and show their delivery and acknowledgement state on the phone.

| Button | Event type | Message | Operations must acknowledge | Server effects |
|---|---|---|---|---|
| Need assistance | `NEED_ASSISTANCE` | optional | yes | shift → `ASSISTANCE` (unless already higher), WARNING notification, timeline |
| Report incident | `INCIDENT_REPORT` | required | yes | incident `OTHER` / `HIGH` (source `APP`), shift → `INCIDENT`, WARNING notification, timeline |
| Security alert | `SECURITY_ALERT` | required | yes | incident `SUSPICIOUS_ACTIVITY` / `HIGH`, WARNING notification, timeline |
| Running late | `RUNNING_LATE` | optional | yes | WARNING notification, timeline |
| Status update | `STATUS_UPDATE` | required | no (stored resolved) | INFO notification, timeline |
| Shift going well | `SHIFT_OK` | none | no | INFO notification, timeline (`GUARD_OK`) |
| Shift handover | `HANDOVER` | optional | no | INFO notification, timeline (`HANDOVER_NOTICE`) |
| Call operations | — | — | — | opens the dialer with the control-room number from the server config |

Every message carries the phone's last known position with its accuracy and age (never a fresh stream; the regular monitoring provides that).

## Where operations sees them

- **Guard alerts** page: everything that needs acknowledgement, open first; informational messages under *Last 7 days*.
- **Overview** card and sidebar count while anything is open.
- **Guard → Communication** tab: alerts interleaved with SMS and calls, with the acknowledgement as its own line.
- **Shift timeline**: one line per message, one per acknowledgement.
- **Incidents**: the records opened by incident reports and security alerts.

## What the guard sees

Dashboard (*Sent to operations* card, last four) and the Alerts screen (last thirty):

| Phone state | Meaning |
|---|---|
| Saved on the phone · waiting for internet | in the outbox, no connection yet |
| Received by the server HH:MM · waiting for operations to acknowledge | server acked the event |
| Acknowledged by <name> HH:MM · "<note>" | operations pressed Acknowledge |
| Handled · <name> | resolved |
| Rejected by the server | malformed; will not be retried |

"Received by the server" and "acknowledged by a person" are different states on purpose: delivery is not the same as someone having read it.

## Offline

A message sent without internet is saved and delivered later with its original time (`SYNCED_LATE` on the server). The guard is told so immediately and, for the serious types, offered **Call operations** / **Send SMS instead** (the SMS carries the matching keyword, `HELP` or `INCIDENT`, so the unchanged SMS pipeline handles it).

## Feature-phone guards

Nothing changes for them: `YES`, `WELL`, `HELP`, `INCIDENT`, `EMERGENCY` by SMS work exactly as before and are verified by the regression step in `scripts/dev/alerts-e2e.ts`.
