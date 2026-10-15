# Development

Setup, commands and tooling are in [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md). Additions for the GPS work:

- `src/lib/geofence.ts` and `android/.../geofence/GeofenceEngine.kt` must stay in step; both have the same section-50 test. Change one, change the other.
- New settings go in `src/lib/settings.ts` (`SETTING_DEFS`); defaults apply immediately, `npm run db:seed` writes the rows.
- Maps: `src/components/map/site-map.tsx` (Leaflet, OpenStreetMap tiles, client-only). Pass `site` and `points`; no API key.
- Simulators: `src/lib/gateway/simulate.ts` builds the same event the phone would send; both simulator components call the `simulateGateway` server action.
- Android: `GatewayService` runs three loops (heartbeat, sync, monitor). `LocationMonitor.step()` is the place to change fix acquisition; `stepMonitor` the place to change policy.
- Emulator testing: Android Studio *Extended controls → Location* sets a fix; set a route to walk out of the fence. `adb emu geo fix <lng> <lat>` does the same from the command line.
