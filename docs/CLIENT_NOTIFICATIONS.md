# Client notifications

Every message to a client (written in the portal or sent by a rule) goes through
`lib/client-notifications/service.ts` and is kept in `ClientNotification`.

## Notify client

The **Notify client** button (shift, guard, incident, site and Monitoring) opens a composer that
shows the client, site, guard and shift it worked out, a type, the recipient, the channel, an editable
message from a template, and after sending, its delivery status.

- **The client comes from the site**, through the shift, the guard's current shift, or the incident.
  It is never chosen by hand, so a message cannot go to an unrelated client.
- **Recipients are approved addresses only**: the site's client-update number and email, the site
  contact and the client contact, as recorded on the site and client. A number typed into the
  composer is refused. To add one, edit the site or client.
- **Channels**: SMS, and email where the provider supports it (Sendai email needs
  `SENDAI_EMAIL_IDENTITY_ID`). No new paid service was added.
- **No coordinates**: templates never include positions, and a message that looks like map
  coordinates is refused unless the super admin sends it.

## Who may send what

| Type | Operations admin | Super admin | Supervisor | Rule |
|---|---|---|---|---|
| Arrived, verified on site, running late, missed check-in, shift completed, replacement dispatched, site status, all well, custom | sends | sends | drafts | sends (if the site asks) |
| Absent, outside the site, emergency, assistance | drafts | sends / approves | drafts | drafts only |

A draft is *Awaiting approval* and nothing is sent. Drafts appear first on the client page and on the
site page, and the approver can edit the text before approving. An internal notification says a
draft is waiting.

## Statuses

*Sent* means the provider accepted it. *Delivered* appears only when the provider's delivery report
says so (carried from the SMS webhook). *Failed* keeps the provider's reason (for example
`402 insufficient funds`). Nothing is shown as delivered because it was queued.

## Automatic rules, per site

Set on the site form, under client updates (the site must have client updates switched on):

| Switch | When | Message |
|---|---|---|
| Arrival | GPS check-in verified, or SMS YES, whichever first | "guard verified on site" / "guard on site", once per shift |
| Late | check-in escalated with the phone online, or no reply to the SMS arrival check and reminder | "running late", once per shift |
| Missed check-in (absent) | as above, when this is on instead of late | "check-in not confirmed" |
| Outside | guard's phone outside the site beyond the escalation time | **draft** for the super admin |
| Emergency | an emergency or critical incident | **draft** for the super admin |
| All well, shift ended | as before | as before |

The supervisor is always told first; the client rules run after the internal alert. A phone that is
merely offline never produces a client message.

## Duplicates

Each rule message has a key per rule, shift (or incident) and channel. A repeated GPS fix, an event
the phone retries, a second engine tick or an SMS YES after a GPS check-in finds the key taken and
sends nothing. A composer send is keyed by the attempt, so a double click sends once.

## History

Client page (`/clients/<id>`), site page and incident page: type, status, recipient, channel, who
sent or approved it (or which rule), time, failure reason, guard, shift or incident. Every send,
draft, approval and discard is also in the audit log and on the shift timeline.

## Tests

`npx tsx scripts/dev/client-notification-e2e.ts` (51 checks) against a local database with the
simulated provider. A real SMS or email to a real client has **not** been sent: Sendai is out of
credit (see `UPGRADE_AUDIT.md`, P2).
