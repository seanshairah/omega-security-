# System architecture

Omega Protection Services operations platform: one Next.js application (web dashboard and API), one PostgreSQL database, the existing SMS provider, and one Android app with two modes. Detailed design of the original portal is in [ARCHITECTURE.md](ARCHITECTURE.md); this page is the whole picture after the Android and GPS work.

```mermaid
flowchart TB
  Admin[Operations staff<br/>browser, phone] --> Web[Web dashboard<br/>Next.js App Router pages + server actions]
  Web --> API[Backend API<br/>src/app/api/*]
  API --> DB[(PostgreSQL · Prisma)]
  subgraph SMS [SMS · unchanged]
    Sendai[Sendai / other provider] <--> SmsLib[lib/sms: outbound, pipeline, templates]
    Sendai --> Webhook[/api/sms/webhook/provider]
  end
  subgraph Calls [Calls]
    Ops[Operations gateway phone<br/>Security Gateway app · OPERATIONS_GATEWAY] -->|call events| Events[/api/gateways/events/]
  end
  subgraph GPS [GPS]
    Guard[Guard's Android phone<br/>Security Gateway app · GUARD] -->|location events, calls with location| Events
    Guard -->|config: shift, site, radius, policy| Config[/api/gateways/config/]
  end
  Webhook --> DB
  Events --> DB
  Engine[Automation engine · every minute<br/>SMS steps, gateway offline, location overdue, escalation, retention] --> SmsLib
  Engine --> DB
```

## Components

| Component | Where | Role |
| --- | --- | --- |
| Web dashboard | `src/app/(app)/**`, `src/components/**` | Server-rendered pages for guards, sites, shifts, attendance, incidents, calls, devices, reports, settings; small client islands (simulators, maps, forms). |
| Backend API | `src/app/api/**` | Session-cookie routes for the portal, Bearer-token routes for devices, signature-verified SMS webhook. |
| Database | `prisma/schema.prisma`, `prisma/migrations/*` | PostgreSQL (Neon in production). See [DATABASE.md](DATABASE.md). |
| SMS | `src/lib/sms/**` | Provider abstraction (Sendai in production), templates, inbound interpreter, automation. Unchanged. See [SMS_INTEGRATION.md](SMS_INTEGRATION.md). |
| Call gateway | `src/lib/gateway/{auth,service,call-state,events,calls,simulate}.ts` | Device registration and tokens, call event intake, dedupe, guard matching, correlation. See [CALL_GATEWAY.md](CALL_GATEWAY.md). |
| GPS and geofencing | `src/lib/geofence.ts`, `src/lib/gateway/location-events.ts` | Accuracy-aware classification, monitoring state machine (mirrored in Kotlin), location event intake, SMS+GPS verification, overdue and escalation. See [GPS_AND_GEOFENCING.md](GPS_AND_GEOFENCING.md). |
| Guard APK / Operations gateway | `android/` | One Kotlin app; the server tells it its mode at activation. See [GUARD_ANDROID_APP.md](GUARD_ANDROID_APP.md) and [OPERATIONS_GATEWAY.md](OPERATIONS_GATEWAY.md). |
| Offline queue | `android/.../data/EventQueue.kt`, `service/SyncEngine.kt` | SQLite outbox, acknowledged per event, replayed in order. See [OFFLINE_MODE.md](OFFLINE_MODE.md). |
| Automation engine | `src/lib/automation/engine.ts` | Twelve steps per minute; the SMS steps come first, the gateway and location steps run in their own try/catch after them. |

## Data flow for one shift (Android guard)

```mermaid
sequenceDiagram
  participant E as Engine
  participant S as SMS provider
  participant G as Guard phone (app)
  participant B as Backend
  E->>S: 18:00 ARRIVAL SMS (existing)
  G->>B: GET /api/gateways/config (cached before the shift)
  S->>B: "YES" via webhook (existing) → attendance CONFIRMED
  G->>G: 18:03 GPS fix, local classify → INSIDE
  G->>B: SHIFT_STARTED {inside, 20 m, ±12 m}
  B->>B: ARRIVAL VERIFIED (SMS + GPS inside)
  G->>G: 19:00, 20:00 local checks INSIDE (queued; only ever uploaded as small events)
  G->>G: 22:15 OUTSIDE 420 m → wait 60 s → 435 m → LOCATION_EXIT
  G--xB: no internet: event stays in the outbox
  G->>G: 22:25 LOCATION_OUTSIDE · 23:05 LOCATION_RETURNED (50 min outside)
  G->>B: 23:40 internet back: batch upload, original timestamps
  B->>B: stored as SYNCED_LATE, timeline + alerts, never shown as live
```

## Boundaries that the design enforces

- **GPS needs no airtime or data; uploading needs data.** Classification and the exit/return decisions happen on the phone. Only compact events are uploaded.
- **Device offline ≠ guard left the site.** Silence raises `DEVICE_OFFLINE`; only a confirmed outside reading raises `LOCATION_EXIT`.
- **UNKNOWN ≠ OUTSIDE.** Poor accuracy, no fix, permission revoked and location disabled are reported as `LOCATION_UNAVAILABLE` with a reason.
- **Feature-phone guards are first-class.** Their shifts use SMS and calls exactly as before; `Guard.deviceKind` separates the two populations.
- **Nothing is live that is not live.** `syncStatus` (`LIVE`, `SYNCED`, `SYNCED_LATE`) is derived from the upload delay and shown everywhere.
- **No audio, no surveillance outside shifts.** Monitoring starts ten minutes before a shift and ends thirty minutes after it; the app's notification is visible the whole time.
