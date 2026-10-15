# SMS integration

The SMS system is the existing, unchanged foundation: Sendai (or Africa's Talking, Twilio, generic HTTP, simulated) behind `SmsProvider`, outbound through `sendSms`/`sendTemplated`, inbound through `POST /api/sms/webhook/<provider>` and `processIncomingMessage`, with editable templates and the per-minute automation engine. The complete description is in [SMS_WORKFLOW.md](SMS_WORKFLOW.md).

What the Android work added around it, without touching it:

- After a guard's **YES** is processed, one additive hook (`verifyArrivalFromSms`) looks for a GPS fix from the guard's device and stamps `Attendance.locationVerification`. It is wrapped in try/catch, runs only for Android guards, and cannot change the attendance status or the reply.
- Calls and location events write to the same shift timeline table as SMS, so one shift page tells the whole story.
- The guard profile's **Communication** tab merges SMS and calls.

Feature-phone guards use SMS and calls exactly as before. If every device is switched off, nothing in the SMS flow changes. See TROUBLESHOOTING → *Existing SMS stopped working* for the regression checklist.
