# Scheduled welfare checks

Sites can ask guards "are you well?" at set local times or at an interval, by SMS, by a call from
the operations gateway phone, or by an automated voice call with a key-press menu (IVR). Sites with no
schedule keep the original single welfare SMS at `welfare.offsetPercent` of the shift.

**A connected call is not a welfare response.** Only a key press, an SMS reply, a guard's own call to
the gateway, or a person confirming settles a check. An unanswered call says nothing about where the
guard is.

## Configuration (site form → Welfare checks)

| Field | Column | Notes |
|---|---|---|
| Check at | `Location.welfareTimes` | Harare 24-hour times, `00:00, 03:00`. Overnight shifts get both. |
| Or every (minutes) | `Location.welfareIntervalMinutes` | From the shift start, 15 minimum. |
| Ask by | `Location.welfareChannel` | SMS, GATEWAY_CALL or VOICE |
| Tries before escalating | `welfareMaxAttempts` | Default 2 |
| Minutes between calls | `welfareRetryMinutes` | Default 10 |
| Text before escalating | `welfareSmsFallback` | Default on; skipped if the guard has SMS turned off |
| Guard exemption | `Guard.welfareExempt` | The site schedule skips this guard |

Due points at the exact start or end are left out (arrival and completion have their own checks). A
point the engine first sees more than 30 minutes late is skipped, not sent late.

## Flow

`runWelfareSchedule(now)` (engine step 6b, `src/lib/welfare/scheduled.ts`):

1. For on-site shifts at scheduled sites, create one `WelfareCheck` per due point
   (`scheduleKey = <shiftId>:<ISO due time>`, unique, so concurrent runs cannot duplicate).
2. Place it by channel:
   - **SMS:** the WELFARE template; `pendingPrompt = WELFARE`.
   - **VOICE:** `voiceProvider().placeWelfareCall`. With no provider, the check goes straight to SMS fallback (or escalation) and is never shown as a call.
   - **GATEWAY_CALL:** a `CallRequest` on the operations phone (`idempotencyKey welfare:<id>:<attempt>`). The operator confirms and speaks to the guard.
3. Follow up (`nextFollowUp`, pure, in `welfare-rules.ts`): WAIT, RETRY, SMS_FALLBACK or ESCALATE.
   Escalation sets NO_RESPONSE, increments `missedChecks`, adds a WELFARE_MISSED timeline line and
   sends a supervisor notification, which is CRITICAL from the second missed check.
4. A gateway call reported CONNECTED/COMPLETED becomes CALL_ANSWERED plus a PENDING welfare evidence
   row. It waits for the operator to confirm and is never escalated as "no answer".
5. A shift that closes with a check open stops asking; the check is closed as NO_RESPONSE without
   escalation.

Call statuses: CALL_SCHEDULED, CALL_INITIATED, CALL_RINGING, CALL_ANSWERED, RESPONSE_CONFIRMED,
NO_ANSWER, BUSY, FAILED, ESCALATED.

## IVR

Prompt (`WELFARE_PROMPT`): *"Omega Protection Services shift verification. Press 1 if your shift is
going well. Press 2 if you need assistance. Press 3 for an emergency."*

| Key | Effect |
|---|---|
| 1 | WELL; IVR evidence; pending welfare cleared; client "welfare OK" update (real providers only) |
| 2 | ASSISTANCE; ASSISTANCE_REQUEST incident (source VOICE); shift ASSISTANCE; supervisor notified |
| 3 | Emergency; EMERGENCY incident (CRITICAL); shift CRITICAL; emergency alert; EMERGENCY_ACK SMS so the guard can text details |

A key press arriving after escalation still counts, and the supervisor is told it came late. A
settled check never moves back.

## Voice provider webhook

`POST /api/voice/webhook/<provider>`, accepted only for the configured `VOICE_PROVIDER`.

- Header `x-voice-timestamp`: Unix milliseconds. Refused if more than 5 minutes from server time.
- Header `x-voice-signature`: hex HMAC-SHA256 of `"<timestamp>.<raw body>"` with `VOICE_WEBHOOK_SECRET`.
  With no secret configured, every webhook is refused.
- Each `(provider, eventId)` is applied once (`VoiceWebhookEvent`). On a processing error the id is
  forgotten and 500 returned, so the provider's retry is applied.
- `reference` (the welfare check id, sent as call metadata) finds the check for an earlier attempt's
  call. A status-only report about an earlier attempt is ignored; a key press counts.

## Provider status

**No real voice provider is integrated.** Only `simulated` exists. It is refused in production builds
unless `ALLOW_SIMULATED_VOICE=1`, and everything it reports is flagged simulated. Programmable voice
with Zimbabwe (+263) termination, per-minute cost and webhook signing must be confirmed with a
provider, and the cost approved, before one is added. Do not assume the current SMS provider (Sendai)
offers voice. To add one, implement `VoiceProvider` in `src/lib/voice/provider.ts`, register it, and
map its status and digits in `parseReport`.

| Env var | Meaning |
|---|---|
| `VOICE_PROVIDER` | Unset: no voice calls (VOICE sites fall back to SMS) |
| `VOICE_WEBHOOK_SECRET` | Shared signing secret |
| `ALLOW_SIMULATED_VOICE` | `1` permits the simulator in a production build (demo only) |

## Tests

`tests/welfare.test.ts` (11) and `scripts/dev/welfare-e2e.ts` (`npm run test:welfare`, 42 checks,
including the HTTP webhook against a dev server started with `VOICE_PROVIDER=simulated
VOICE_WEBHOOK_SECRET=e2e-voice-secret`).
