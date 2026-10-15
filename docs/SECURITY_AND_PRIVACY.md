# Security and privacy

## Access control

- Portal: bcrypt passwords, HttpOnly JWT session cookie (7 days), roles SUPERVISOR < ADMIN < SUPER_ADMIN enforced by `guarded()` on routes and `requireUser()`/`can.*` on pages and actions.
- Devices: activation code (6 characters from an unambiguous alphabet, 24-hour expiry, single use) exchanged once for a 256-bit random token; only its SHA-256 hash is stored. Every device request re-reads the device row, so disable and revoke take effect on the next request. A device can only ever act as itself: its guard, its mode and its events are bound server-side to the token; a request cannot name another guard or device.
- HTTPS everywhere; the app refuses plain HTTP except for localhost/emulator addresses.
- Rate limits: activation 10/min per IP, heartbeat 30/min, events 120/min, config 60/min per device (per server instance on Vercel).
- Server-side validation of every event: types, coordinates, accuracy, timestamps clamped to [now − 7 d, now + 5 min], string lengths; unknown fields ignored.
- Idempotency: unique `eventId` per event; one call row per `(device, callId)`.

## Audit log

Recorded with user, time, IP and user agent: device registered / activated / code regenerated / updated / disabled / enabled / revoked / online after offline / offline; simulated events; settings and template changes; call handled; caller linked / ignored / blocked; **guard location viewed** (`LOCATION_VIEWED`, on the profile's Location tab and the current-location API); the existing guard, shift, site, incident and user actions. Super admins read it under Audit log.

## Data collected by the app

| Data | Guard device | Operations gateway |
| --- | --- | --- |
| Position (lat, lng, accuracy, provider, speed, bearing), only during shifts (10 min before to 30 min after) | yes | no |
| Call metadata (number, direction, time, duration, outcome) | yes | yes |
| Battery, network type, app and Android version, permission state | yes | yes |
| Audio, microphone, camera, contacts, SMS content, photos, position outside shifts | **never** | **never** |

The onboarding screen on a guard phone states this before any permission is requested. There is no hidden mode: the service shows a permanent notification whose text includes the monitoring state.

## Location data handling

- Events, not tracks: arrival, periodic checks (every 10 min inside), exit, outside updates (every 3 min), return, unavailable, call-time. Retention `geofence.locationRetentionDays` (default 180); timeline lines stay with the shift.
- Wording in the UI is neutral by design: *Location exception*, *Outside assigned site*, *Location verification required*, *Location unavailable*. An exception asks for a phone call, it does not accuse.
- GPS spoofing: mock providers are flagged (`LOCATION INTEGRITY WARNING`), accuracy and provider are stored. No anti-spoofing guarantee is made.
- Who can see location: supervisors and above, like the rest of the operational data; each view is audited.

## Legal basis and policy

Monitoring is tied to configured shifts for legitimate security operations. Do not switch on tracking outside shifts (the app has no such setting). Tell guards what is collected (the onboarding text can be read to them), keep the retention short, and limit portal accounts to people who need them.

## Secrets

`.env` is never committed. Production secrets live in Vercel environment variables. No credential is built into the APK; the only build-time value is the default server address.
