# Android Permissions (after Phase 2)

The full rationale per permission is in [PERMISSIONS.md](PERMISSIONS.md). This page records what Phase 2 changed: **nothing is added**.

| Capability added in Phase 2 | Permission | Note |
|---|---|---|
| Emergency / status alerts | none | events go through the existing outbox and HTTPS endpoint |
| Position attached to an alert | existing `ACCESS_FINE_LOCATION` / `ACCESS_BACKGROUND_LOCATION` | the last fix already held by the monitoring coordinator; no new stream |
| "Call operations" | none | `ACTION_DIAL` opens the dialer with the number; the guard presses call. `CALL_PHONE` is deliberately not requested |
| "Send SMS instead" | none | `ACTION_SENDTO smsto:` opens the SMS app with a pre-filled keyword message; `SEND_SMS` is deliberately not requested |
| Battery-aware monitoring | none | reads the battery level via `BatteryManager`, no permission |
| Communication history | none | local SQLite |

## State machine reminder

`resolveAppState()` (Stage 1) still decides the screen: `NOT_ACTIVATED` → activation; `PERMISSIONS_INCOMPLETE` → onboarding once; `READY` → dashboard; `PERMISSION_REVOKED` → dashboard with a warning and the **Grant permissions** button; `REACTIVATION_REQUIRED` → "ask the administrator". Guard mode requires location *Allow all the time* plus phone and call log; operations mode requires phone and call log.

## What a guard is told

Onboarding explains each permission in plain words and what is **not** collected (audio, messages, contacts, photos, position outside shifts). The Alerts screen repeats the one line that matters there: "Alerts carry your last known position and the message you type. Nothing else."
