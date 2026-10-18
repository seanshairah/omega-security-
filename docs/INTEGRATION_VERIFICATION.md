# Full System Integration Verification (Phase 3, Stage 8)

Each requirement of Stage 8, the evidence that proves it, and where the proof runs. All server-side proofs are automated and run with `npm run test:e2e` against a local database (`npm run dev` with `SMS_PROVIDER=simulated`).

| Requirement | Evidence | Suite |
|---|---|---|
| SMS still functions independently | A feature-phone guard with no device anywhere: `YES` confirms arrival (PRESENT or LATE with `arrivalConfirmedAt`, `locationVerification = NOT_APPLICABLE`), `HELP` sets ASSISTANCE with one incident and one notification; the guard has no GPS rows and no app alerts | `integration-e2e` §1; `gateway-e2e` 32–33; `location-e2e` Test 12; `alerts-e2e` SMS EMERGENCY |
| Feature-phone guards remain supported | Same as above; every dashboard list shows "—" / "SMS attendance" for them (Live map lists them under *Without a point*) | `integration-e2e` §1; Stage 7 pages |
| APK messages use compatible backend workflows | App `SHIFT_OK` after SMS `WELL`: the welfare check is answered once and the app line is a separate `GUARD_OK` timeline entry; app `NEED_ASSISTANCE` then SMS `HELP`: shift ASSISTANCE once, one alert row, one SMS incident, no duplicate incident for assistance | `integration-e2e` §2 |
| Existing call monitoring remains intact | Guard-phone call folded to one ENDED record attributed to the guard and shift with INSIDE location; operations-gateway missed call from a guard attributed and alerted | `integration-e2e` §4; `gateway-e2e` (29 checks) |
| GPS events correctly associate with guards and shifts | Every location row belongs to the device's guard and the live shift, none to the other guard, even when posted out of order | `integration-e2e` §5; `location-e2e` section-50 scenario |
| Offline synchronisation handles every event type | One shuffled batch with location (check, exit, outside, returned, unavailable), alerts (status update, security alert), call (started, missed) and device-status events plus three duplicates: every event acked `ok` once, duplicates `duplicate`, nothing rejected; location story stored once in time order and `SYNCED_LATE`; exit/return alerts once each; alerts `SYNCED_LATE` with original times; call reduced to one MISSED record with location; device status applied; raw log one row per `eventId` | `integration-e2e` §5–6 |
| No duplicate status/attendance processing across SMS and APK | A GPS `SHIFT_STARTED` never confirms arrival; the first SMS `YES` confirms it and GPS corroborates (`VERIFIED`); a second `YES` and further fixes leave `arrivalConfirmedAt` unchanged with exactly one `ARRIVAL_CONFIRMED` timeline line | `integration-e2e` §2–3; `location-e2e` arrival correlation |

## Results

See `docs/IMPLEMENTATION_AUDIT.md` → *Phase 3 gate results* for the run that accompanied the release.

## What a device run adds

The matrix above exercises the server and the shared workflows with the phone's exact payloads. The phone side (outbox, triggers, dialogs) is covered by JVM unit tests and compilation; `docs/DEVICE_TEST_PLAN.md` lists the hardware runs that close the loop.
