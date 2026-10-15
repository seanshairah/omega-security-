# Call gateway (backend)

Backend side of call reporting from both device modes. The app side is in [ANDROID_GATEWAY.md](ANDROID_GATEWAY.md).

- **Intake** `POST /api/gateways/events`: validated per event; stored raw in `GatewayEvent` (unique `eventId`); call events fold into `CallLog` by `(device, callId)` through the pure reducer in `src/lib/gateway/call-state.ts` (RINGING → ANSWERED → ENDED, or MISSED; outgoing not answered → FAILED; never regresses a finished call).
- **Attribution.** Operations gateway: the caller number is normalised and must match exactly one guard, else *unknown caller* (admin can link, add as guard, ignore or block). Guard device: the call belongs to the device's guard whatever the other number.
- **Shift and site.** The live shift at call time (`findLiveShiftForGuard`, the same rule the SMS pipeline uses) gives the shift, site and client; else the gateway's site.
- **Location on calls.** Guard-device call events may carry `location {latitude, longitude, locationState}`; stored on the call (`latitude`, `longitude`, `locationState`) and shown on the call page.
- **Correlation.** Opposite-direction calls between a gateway and a guard device on matching numbers within 90 s are linked both ways (`correlatedCallId`).
- **Timeline.** `CALL_INCOMING`, `CALL_OUTGOING`, `CALL_ANSWERED`, `CALL_ENDED`, `CALL_MISSED` on the shift.
- **Alerts.** Missed incoming call on an operations gateway from a guard: `MISSED_CALL`, critical when the guard is on duty ("ACTIVE GUARD MISSED CALL"), warning otherwise (switchable). Unknown caller: info (switchable). A guard's own missed call is not alerted: it means the guard did not answer, which is the control room's own observation.
- **Stale calls** without an end event are closed as `UNKNOWN` after 30 minutes by the engine.
- **Simulation.** Simulator → Call gateway simulator posts the same events through the same intake.
