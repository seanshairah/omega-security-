# Operations gateway (OPERATIONS_GATEWAY mode)

The control-room phone. Same APK; a device registered with mode *Operations gateway* and (optionally) a site. It reports incoming, outgoing, answered, missed and ended calls with number, direction, timestamps and duration, and sends heartbeats. It does not use GPS: an operations call cannot tell where the guard is; only the guard's own device can report that.

Full detail is in [ANDROID_GATEWAY.md](ANDROID_GATEWAY.md) (app behaviour, Android limits, event contract) and [CALL_GATEWAY.md](CALL_GATEWAY.md) (backend processing and correlation). Installation: [ANDROID_INSTALLATION.md](ANDROID_INSTALLATION.md).

## Correlation with guard devices

When the control room calls a guard who has a guard device, two records arrive: the gateway's `OUTGOING` call to the guard's number and the guard phone's `INCOMING` call from the gateway's number, usually within a few seconds, the latter carrying the guard's latest fix. The backend links them both ways (`CallLog.correlatedCallId`) when the numbers match and the start times are within 90 seconds, so the dashboard shows one conversation with the guard's location state at the time. The same happens when the guard calls the control room.
