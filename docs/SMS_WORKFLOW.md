# SMS workflow (existing system, unchanged)

The SMS system is the foundation of the portal and is untouched by the call gateway. This page documents it as it runs today.

```
Shift reaches its start time
        ↓
Automation engine (runAutomationTick, every minute)
        ↓
sendTemplated(shift, "ARRIVAL")  →  SmsProvider.sendSMS()  →  SmsMessage row (OUTBOUND, type ARRIVAL)
        ↓
Guard replies "YES"
        ↓
Provider calls POST /api/sms/webhook/<provider>   (signature verified by the provider adapter)
        ↓
processIncomingMessage(): phone → guard → live shift → expected prompt → interpretation
        ↓
Attendance PRESENT/LATE · ShiftCheckIn ARRIVAL_CONFIRMED · notification if late · ARRIVAL_CONFIRMED reply
        ↓
(optional) client site-status SMS if the site opted in
```

## Components

| Piece | File | Notes |
| --- | --- | --- |
| Provider abstraction | `src/lib/sms/provider.ts`, `src/lib/sms/index.ts` | `SmsProvider { sendSMS, verifyWebhook, parseInbound, parseDeliveryReports?, sendWhatsApp?, sendEmail? }`; chosen by `SMS_PROVIDER` |
| Providers | `src/lib/sms/providers/{sendai,africastalking,twilio,http,simulated}.ts` | Sendai is the Zimbabwean production gateway; `simulated` logs instead of sending |
| Outbound | `src/lib/sms/outbound.ts` | `sendSms` (signature appended, logged, audited) and `sendTemplated` (renders a template with shift variables) |
| Templates | `src/lib/sms/templates.ts`, editable under **Communications → Templates** | `{{guard_name}}`, `{{location}}`, `{{start_time}}`… |
| Inbound pipeline | `src/lib/sms/pipeline.ts` | YES / NO / 1 / 2 / 3 / INCIDENT / EMERGENCY / free text, depending on the shift's `pendingPrompt` |
| Webhook | `src/app/api/sms/webhook/[provider]/route.ts` | inbound messages and delivery reports |
| Engine | `src/lib/automation/engine.ts` | arrival, reminder, escalation, welfare check, missed welfare, handover, completion, completion timeout, missed shift |
| Simulator | **Communications → Simulator** | plays the guard's phone through the same pipeline |

## Timeline of one shift

| When | Message | Reply | Effect |
| --- | --- | --- | --- |
| start | `ARRIVAL` "Have you arrived…? Reply YES or NO" | YES | attendance PRESENT (LATE after the grace period), timeline ARRIVAL_CONFIRMED |
| | | NO | NOT_CONFIRMED, supervisor notified, keeps listening for YES |
| start + grace | `ARRIVAL_REMINDER` | | status LATE |
| + escalation | (none) | | NOT_CONFIRMED, supervisor notified |
| midpoint | `WELFARE` "1 well, 2 assistance, 3 incident" | 1 | WELFARE_OK |
| | | 2 | ASSISTANCE incident, supervisor notified |
| | | 3 then text | INCIDENT with the guard's description |
| any time | | EMERGENCY | CRITICAL shift, EMERGENCY incident, push + dashboard alert |
| end | `COMPLETION` "Reply YES completed, NO still on duty" | YES | COMPLETED |
| | | NO | STILL_ON_DUTY, supervisor notified |
| end + window | (none) | | closed as completed, unconfirmed |

Timings are in **Settings → Automation**.

## Environment variables

`SMS_PROVIDER`, `SMS_API_KEY`, `SMS_API_SECRET`, `SMS_SENDER_ID`, `SMS_WEBHOOK_SECRET`, `SMS_HTTP_SEND_URL` (http provider only). None were renamed or repurposed by the call gateway.

## How the call gateway relates

It does not. Calls and SMS are two independent channels that meet only in the database: both write to the shift timeline (`ShiftCheckIn`) and both appear in a guard's **Communication** tab. A missed call never changes attendance; a YES reply never changes a call record. If the gateway phones are off, nothing above changes.
