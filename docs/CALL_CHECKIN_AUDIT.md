# Stage 1 audit: call-triggered check-in

What already exists, what is reused unchanged, and what this feature adds.

## Reused unchanged

| Capability | Where | Note |
|---|---|---|
| Call detection on the phone | `android/.../call/CallMonitor.kt`, `CallTracker.kt` | Already enqueues `CALL_STARTED/ENDED/MISSED` through the durable outbox, and on a guard phone already attaches the last fix and asks for a fresh location check around the call |
| Call ingestion and de-duplication | `src/lib/gateway/events.ts` → `applyCallEvent` | `@@unique([gatewayDeviceId, callId])` makes a replayed call event a no-op. Guard matching and `findLiveShiftForGuard` already run on every call |
| Remote GPS request lifecycle | `src/lib/gateway/location-requests.ts`, `DeviceLocationRequest` | PENDING → DELIVERED → PROCESSING → COMPLETED/FAILED/EXPIRED, command poll, accuracy limit, mock detection, `resultEventId` idempotency |
| Accuracy-aware geofence | `src/lib/geofence.ts` → `classifyFix` | INSIDE only when `distance + accuracy <= radius`; OUTSIDE only when `distance - accuracy > radius`; otherwise UNKNOWN with reason `poor_accuracy` or `on_boundary` |
| Minute scheduler | `src/lib/automation/engine.ts` | Idempotent steps keyed on timestamp columns |
| Settings | `src/lib/settings.ts` | Typed, admin-editable, already used for every other threshold |
| Audit log | `src/lib/audit.ts` | Used for every manual override |

## What was missing

1. **No check-in expectation.** A shift had an arrival SMS flow but nothing that expected a *call* at the start of the shift, so there was no state to be "awaiting", "overdue" or "missed" against.
2. **No qualifying-call rule.** Every call from a guard was recorded, but any call would have looked like a check-in. There was no notion of an authorised check-in destination.
3. **GPS was never triggered by a call.** Location requests were only ever created by an operator pressing a button.
4. **No grace or lateness arithmetic.** `Attendance.lateMinutes` existed but nothing computed it from a verified arrival.
5. **Call and fix were not correlated.** A call row and a location request row had no shared identifier tying them to one arrival decision.

## Design decisions taken

- **The GPS trigger is server-side.** A qualifying call creates a `DeviceLocationRequest` with purpose `CHECKIN`. This reuses the whole tested command path rather than adding a second Android mechanism. The phone needs no new protocol: `purpose` is a free-text column and the handler already answers any request.
- **One row per shift.** `AttendanceCheckIn` has `shiftId @unique`, so concurrent processing cannot create two attendance decisions for one shift.
- **Separate states.** Call received, GPS verification pending, and attendance verified are distinct statuses. A call alone never sets attendance.
- **The arrival time is the GPS capture time**, not the call time and not the server processing time, because that is the moment physical presence was evidenced. The call time is kept separately and both appear in the interface.
- **Feature-phone guards keep the SMS flow** and are recorded with verification source `SMS_ONLY`, never as GPS-verified.
