# Sentinel — system design

Sentinel is the guard workforce and shift management system for Omega Security.
Admins run operations from a web portal. Guards interact only by two-way SMS.

This document is the design that the code implements. It covers:

1. System architecture
2. Database schema
3. Main user flows
4. API structure
5. SMS webhook flow
6. Automation logic
7. Dashboard structure
8. Project folder structure

---

## 1. System architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  Admin browser                                                       │
│  Next.js App Router pages (server components) + small client islands │
└───────────────┬──────────────────────────────────────────────────────┘
                │ server actions (forms)  ·  REST /api/* (JSON)
┌───────────────▼──────────────────────────────────────────────────────┐
│  Next.js server (Node.js, TypeScript)                                │
│                                                                      │
│  lib/services/*      domain services (guards, shifts, incidents…)    │
│  lib/sms/pipeline    inbound SMS interpreter (state machine)         │
│  lib/sms/outbound    template rendering + provider dispatch          │
│  lib/sms/providers   Simulated · Twilio · Africa's Talking · HTTP    │
│  lib/automation      shift automation engine (runs every minute)     │
│  lib/auth            session cookie (JWT, HttpOnly) + RBAC           │
│  lib/audit           audit log writer                                │
│  lib/notifications   dashboard notifications (+ future channels)     │
└───────┬──────────────────────────────────────────┬───────────────────┘
        │ Prisma                                   │ HTTPS
┌───────▼───────────┐                   ┌──────────▼──────────────────┐
│  PostgreSQL       │                   │  SMS gateway                │
│                   │                   │  send API  → guard handset  │
│                   │                   │  webhook   ← guard reply    │
└───────────────────┘                   └─────────────────────────────┘
```

Principles

- One deployable: the Next.js server hosts the UI, the REST API, the SMS webhook and the automation engine. No message broker, no separate worker, until scale demands it.
- The automation engine is a pure function `runAutomationTick(now)`. It is idempotent: every action it takes is recorded on the shift (`arrivalSmsSentAt`, `welfareSmsSentAt`…) so a tick can run twice without double-sending.
- The engine runs in-process on a 60-second timer (`AUTOMATION_INPROCESS=true`) or is called by an external cron via `POST /api/automation/tick` with a bearer secret. Both call the same function.
- SMS providers sit behind one interface. The provider is chosen by `SMS_PROVIDER`. The `simulated` provider stores messages without sending, so the full workflow works in demo mode.
- An SMS `YES` proves the guard answered from the registered handset at a timestamp. It does not prove location. The data model keeps `latitude/longitude/source` on check-ins so a future mobile app can add GPS, geofencing and photos without a schema rewrite.

Technology

| Layer     | Choice                                         |
| --------- | ---------------------------------------------- |
| Frontend  | Next.js 15 (App Router), React 19, TypeScript  |
| Styling   | Tailwind CSS 4, shadcn-style components in-repo |
| Backend   | Next.js route handlers + server actions, Node   |
| Database  | PostgreSQL 16, Prisma 6                         |
| Auth      | bcrypt passwords, signed JWT session cookie, role checks on every page and route |
| SMS       | Provider abstraction, env-configured            |
| Icons     | Phosphor (fill weight), one family              |

---

## 2. Database schema

Entities (Prisma models). Operational records are never hard-deleted; guards, locations, clients and users carry `active`/`deactivatedAt`.

```
User            id, name, email, passwordHash, role(SUPER_ADMIN|ADMIN|SUPERVISOR), phone, active, lastLoginAt
Client          id, code, name, contactName, contactPhone, contactEmail, address, active
Location        id, code, name, clientId→Client, address, contactName, contactPhone,
                requiredGuards, shiftPattern(DAY_8|NIGHT_8|DAY_12|NIGHT_12|CUSTOM),
                supervisorId→User, specialInstructions, active
Guard           id, guardNo, firstName, lastName, phone(unique), nationalId(unique), gender, dateOfBirth,
                address, emergencyContactName, emergencyContactPhone,
                employmentStatus(ACTIVE|ON_LEAVE|SUSPENDED|INACTIVE), dateEmployed,
                supervisorId→User, homeLocationId→Location, photoUrl, notes, active, deactivatedAt
Shift           id, guardId→Guard, locationId→Location, supervisorId→User,
                date, startAt, endAt, durationMinutes, instructions, notes,
                status(SCHEDULED|AWAITING_ARRIVAL|ON_DUTY|LATE|NOT_CONFIRMED|ASSISTANCE|INCIDENT|CRITICAL|
                       COMPLETED|MISSED|CANCELLED),
                recurrenceId→ShiftRecurrence?,
                -- automation markers (idempotency)
                arrivalSmsSentAt, arrivalReminderSentAt, arrivalEscalatedAt,
                welfareSmsSentAt, welfareReminderSentAt, welfareMissedAt,
                completionSmsSentAt, completionReminderSentAt, handoverSmsSentAt,
                -- awaiting state for the SMS interpreter
                pendingPrompt(NONE|ARRIVAL|WELFARE|INCIDENT_DESCRIPTION|COMPLETION)
ShiftRecurrence id, guardId, locationId, supervisorId, daysOfWeek[], startTime, endTime, startsOn, endsOn, active
Attendance      id, shiftId(unique)→Shift, status(PENDING|PRESENT|LATE|NOT_REPORTED|COMPLETED|LEFT_EARLY|STILL_ON_DUTY|INCIDENT),
                arrivalConfirmedAt, lateMinutes, completionConfirmedAt, welfareStatus, missedChecks
ShiftCheckIn    id, shiftId, guardId, type(ARRIVAL|WELFARE|COMPLETION|MANUAL), result, at,
                source(SMS|ADMIN|APP), latitude?, longitude?, smsMessageId?
WelfareCheck    id, shiftId, sentAt, respondedAt, response(WELL|ASSISTANCE|INCIDENT|NO_RESPONSE)
Incident        id, incidentNo, guardId, locationId, shiftId?, occurredAt, category, severity,
                status(OPEN|ACKNOWLEDGED|RESOLVED|CLOSED), description, supervisorId, resolutionNotes, resolvedAt,
                source(SMS|ADMIN|EMERGENCY)
SmsMessage      id, direction(OUTBOUND|INBOUND), from, to, body, type(ARRIVAL|ARRIVAL_REMINDER|WELFARE|
                INCIDENT|ASSISTANCE|COMPLETION|HANDOVER|EMERGENCY|GENERAL|CLARIFICATION),
                guardId?, shiftId?, locationId?, status(QUEUED|SENT|DELIVERED|FAILED|RECEIVED),
                providerMessageId, provider, error, interpretedAs, createdAt
MessageTemplate id, key(unique), name, body, variables[], active
Setting         key(unique), value   — grace period, reminder, escalation, welfare offset, completion window…
Notification    id, type, severity(INFO|WARNING|CRITICAL), title, body, guardId?, shiftId?, incidentId?,
                readAt, createdAt
AuditLog        id, userId?, actor, action, entity, entityId, details(json), ip, userAgent, createdAt
```

Key indexes: `Guard.phone` unique (SMS routing), `Shift(startAt)`, `Shift(status)`, `Shift(guardId, startAt)`,
`SmsMessage(createdAt)`, `SmsMessage(guardId)`, `Incident(status)`, `Notification(readAt)`, `AuditLog(createdAt)`.

Phone numbers are stored normalised to E.164 (`+2637…`). The webhook normalises the sender before lookup.

---

## 3. Main user flows

**Set-up.** Super admin signs in → creates a client → creates a location under it (required guards, shift pattern, supervisor) → adds guards (phone is mandatory and unique).

**Scheduling.** Admin creates a shift: guard, location, date, start, end. Duration and welfare midpoint are computed. Or creates a recurrence (Mon–Sun 18:00–06:00 at ABC Warehouse); the engine materialises the next 14 days of shifts nightly.

**The shift lifecycle (the core flow).**

```
SCHEDULED
  │ start time reached → engine sends ARRIVAL sms            → AWAITING_ARRIVAL
  │   reply YES  → attendance PRESENT (LATE if after grace)  → ON_DUTY
  │   reply NO   → attendance NOT_REPORTED, notify supervisor → NOT_CONFIRMED
  │   no reply after grace     → REMINDER sms                → LATE
  │   no reply after escalation→ notify, attendance NOT_REPORTED → NOT_CONFIRMED
  │ midpoint reached → WELFARE sms (1/2/3)
  │   reply 1 → welfare WELL                                 → ON_DUTY
  │   reply 2 → ASSISTANCE, notify supervisor                → ASSISTANCE
  │   reply 3 → ask for description; next free-text reply = incident → INCIDENT
  │   no reply after welfare window → welfare NO_RESPONSE, notify → (missed check)
  │ EMERGENCY at any time → CRITICAL, incident, notify all admins, ack sms
  │ end time reached → COMPLETION sms
  │   reply YES      → attendance COMPLETED                   → COMPLETED
  │   reply NO       → STILL_ON_DUTY, notify
  │   reply INCIDENT → incident workflow
  │   no reply after completion window → auto-close as COMPLETED (unconfirmed), notify
```

**Monitoring.** Operations watch *Active operations*: one row per live shift with arrival time, welfare result and status glyph. Clicking a row opens the shift timeline.

**Incidents.** Created from SMS (3, INCIDENT, EMERGENCY) or manually. Supervisor acknowledges, adds resolution notes, resolves.

**Reporting.** Attendance report filtered by guard / location / date range / status, CSV export. Guard performance derived from attendance.

**Demo.** The Simulator page lists live shifts and lets an admin "reply as the guard" (YES, NO, 1, 2, 3, INCIDENT, EMERGENCY, free text) and advance the automation engine. Everything goes through the same pipeline as a real webhook.

---

## 4. API structure

All routes require a session cookie except `/api/auth/login`, the SMS webhook (signed) and the automation tick (bearer secret). JSON in, JSON out. Errors are `{ error: string }` with 4xx/5xx.

```
POST   /api/auth/login                 { email, password }
POST   /api/auth/logout

GET    /api/guards?q=&status=&locationId=      list / search
POST   /api/guards                             create
GET    /api/guards/:id                         detail + history
PATCH  /api/guards/:id                         edit
POST   /api/guards/:id/deactivate

GET/POST    /api/clients
GET/PATCH   /api/clients/:id
GET/POST    /api/locations
GET/PATCH   /api/locations/:id

GET    /api/shifts?from=&to=&status=&guardId=&locationId=
POST   /api/shifts                              create (computes duration)
GET    /api/shifts/:id                          detail + timeline
PATCH  /api/shifts/:id                          edit / reassign / cancel
POST   /api/shifts/recurring                    create recurrence + materialise
GET    /api/shifts/active                       live board

GET    /api/attendance?from=&to=&guardId=&locationId=&status=
GET    /api/reports/attendance.csv?…same filters
GET    /api/reports/performance

GET/POST   /api/incidents
GET/PATCH  /api/incidents/:id                   acknowledge / resolve

GET    /api/sms/messages?guardId=&shiftId=&type=&direction=
POST   /api/sms/send                            manual message to a guard
POST   /api/sms/webhook/:provider               inbound from gateway (twilio | africastalking | http | simulated)
POST   /api/sms/simulate                        { guardId | phone, body }  demo inbound

GET/PUT   /api/templates
GET/PUT   /api/settings
GET       /api/notifications      POST /api/notifications/:id/read
GET       /api/audit
GET/POST  /api/users              PATCH /api/users/:id

POST   /api/automation/tick                     Authorization: Bearer AUTOMATION_SECRET
```

Server actions back the admin forms and call the same service functions as the REST routes.

---

## 5. SMS webhook flow

```
Gateway POST /api/sms/webhook/:provider
   │
   ├─ provider adapter verifies signature / secret
   ├─ provider adapter parses { from, to, body, providerMessageId }
   ▼
processIncomingMessage({ from, body, provider })
   1. normalise phone → E.164
   2. store SmsMessage(INBOUND, status RECEIVED)
   3. guard = Guard.findUnique(phone)   — unknown? log, reply "number not recognised", stop
   4. shift = guard's live shift (status not COMPLETED/CANCELLED/MISSED and
              startAt-2h ≤ now ≤ endAt+2h), nearest to now
   5. token = normalise(body): trim, upper, strip punctuation
      global keywords first:  EMERGENCY  → emergency workflow (any shift state)
                              INCIDENT   → incident workflow
   6. expected = shift.pendingPrompt
        ARRIVAL               accepts YES | NO
        WELFARE               accepts 1 | 2 | 3 (and WELL/HELP/INCIDENT synonyms)
        INCIDENT_DESCRIPTION  accepts any text ≥ 3 chars → Incident.description
        COMPLETION            accepts YES | NO | INCIDENT
        NONE                  YES/1 are acknowledged politely, free text is logged
   7. valid → update Attendance / WelfareCheck / Incident / Shift.status
             → write ShiftCheckIn (timeline)
             → notify admins where the rule says so
             → send confirmation SMS (templated)
      invalid → send CLARIFICATION sms restating the accepted replies; no state change
   8. mark SmsMessage.interpretedAs, write AuditLog(SMS_RECEIVED)
   9. return 200 to the gateway (always, so it does not retry on business errors)
```

Provider adapters:

| Provider         | Inbound auth                               | Zimbabwe coverage |
| ---------------- | ------------------------------------------ | ----------------- |
| africastalking   | `SMS_WEBHOOK_SECRET` as `?key=` or header  | yes (Econet, NetOne, Telecel) |
| twilio           | X-Twilio-Signature HMAC                    | via international numbers |
| http (generic)   | `X-Webhook-Secret` header                  | any local gateway (e.g. BulkSMS, Clickatell, Esendex ZW) |
| simulated        | session + admin role                       | demo only |

---

## 6. Automation logic

`runAutomationTick(now)` runs every minute. Settings (all editable in *Settings*):

| key                         | default | meaning |
| --------------------------- | ------- | ------- |
| arrival.sendOffsetMinutes   | 0       | send arrival SMS this many minutes before start (0 = at start) |
| arrival.graceMinutes        | 15      | wait before the reminder |
| arrival.escalationMinutes   | 15      | wait after reminder before NOT_CONFIRMED + notify |
| welfare.offsetPercent       | 50      | where in the shift the welfare check fires |
| welfare.responseMinutes     | 20      | wait before a missed welfare check |
| completion.responseMinutes  | 30      | wait before auto-closing an unconfirmed shift |
| handover.notifyMinutes      | 30      | notify incoming guard this long before start |
| recurrence.horizonDays      | 14      | how far ahead recurring shifts are materialised |

Per tick, in order:

1. **Materialise recurrences** for the horizon (skips existing).
2. **Arrival**: shifts `SCHEDULED` with `startAt - sendOffset ≤ now` → send ARRIVAL, set `AWAITING_ARRIVAL`, `pendingPrompt=ARRIVAL`, `arrivalSmsSentAt`.
3. **Arrival reminder**: `AWAITING_ARRIVAL`, no arrival, `arrivalSmsSentAt + grace ≤ now`, no reminder → send REMINDER, status `LATE`, notify "arrived late / not yet confirmed".
4. **Arrival escalation**: `LATE`, `arrivalReminderSentAt + escalation ≤ now` → status `NOT_CONFIRMED`, attendance `NOT_REPORTED`, notify supervisor + admins.
5. **Welfare**: shifts on duty (ON_DUTY/LATE/ASSISTANCE/INCIDENT) with `startAt + duration×offset ≤ now`, no welfare sent → send WELFARE, `pendingPrompt=WELFARE`.
6. **Missed welfare**: welfare sent, no response, `welfareSmsSentAt + responseMinutes ≤ now` → WelfareCheck NO_RESPONSE, attendance.missedChecks++, notify.
7. **Handover notice**: incoming shift starting within `handover.notifyMinutes` at a location where an outgoing shift is live → one HANDOVER sms to the incoming guard (and the outgoing guard is told who relieves them).
8. **Completion**: live shifts with `endAt ≤ now`, no completion sent → send COMPLETION, `pendingPrompt=COMPLETION`.
9. **Completion timeout**: completion sent, no reply after `completion.responseMinutes` → status COMPLETED, attendance `COMPLETED` with `completionConfirmedAt=null`, notify "shift ended without confirmation".
10. **Missed shifts**: `SCHEDULED`/`AWAITING_ARRIVAL`/`LATE`/`NOT_CONFIRMED` with `endAt ≤ now` and no arrival → status `MISSED`, attendance `NOT_REPORTED`.

Each step writes a ShiftCheckIn/timeline event and an SmsMessage. Each step is guarded by a timestamp column so the tick is idempotent.

---

## 7. Dashboard structure

Layout follows the Sentinel reference: white sidebar on a warm grey ground, a white breadcrumb bar with a live status pill, search, refresh, notifications and the admin's avatar.

```
┌ Sidebar ─────────┐ ┌ Top bar: Operations › Overview · ● All systems operational · search · ⟳ · 🔔 · avatar ┐
│ Home              │ ┌─────────┬─────────┬─────────┬─────────┐
│ Operations ⌃      │ │Guards on│ Not     │ Open    │ Completed│   KPI cards: title, one-line description,
│   Overview        │ │duty     │reported │incidents│ today    │   big figure, delta, 7-day sparkline
│   Active shifts   │ └─────────┴─────────┴─────────┴─────────┘
│   Shifts          │ ┌───────────────────────────┬──────────────┐
│   Attendance      │ │ Operations trend (line)   │ Attendance   │   trend: scheduled / arrived / completed
│   Incidents       │ │ last 12 h / 24 h / 7 d    │ gauge + word │   gauge: today's attendance rate
│ Workforce ⌃       │ └───────────────────────────┴──────────────┘
│   Guards          │ ┌───────────────────────────┬──────────────┐
│   Clients         │ │ Needs attention (list)    │ Send a       │   list: emergencies, assistance,
│   Locations       │ │ › rows with chevrons      │ message      │   not reported, missed checks
│ Communications    │ └───────────────────────────┴──────────────┘
│   SMS logs        │
│   Templates       │
│ Reports           │
│ Users · Settings  │
│ [Demo mode card]  │
└───────────────────┘
```

Status glyphs are consistent everywhere: 🟢 emerald = normal, 🟠 amber = attention, 🔴 vermillion = critical, ⚪ hollow = pending. An EMERGENCY renders a full-width red banner at the top of every page until acknowledged.

Screens: Dashboard · Active operations · Shifts (+ new, + recurring, + detail/timeline) · Guards (+ new, + detail with history, attendance, deployments, incidents, performance) · Clients · Locations (+ detail with deployed guards) · Attendance (+ CSV) · Incidents (+ detail) · SMS logs · Templates · Reports · Users · Settings · Audit log · Simulator.

---

## 8. Project folder structure

```
.
├── docs/ARCHITECTURE.md          this document
├── prisma/
│   ├── schema.prisma
│   └── seed.ts                   demo data (Omega Security, 5 clients, 8 sites, 16 guards, live shifts)
├── scripts/tick.ts               run one automation tick from the shell / cron
├── src/
│   ├── app/
│   │   ├── (auth)/login/
│   │   ├── (app)/                authenticated shell: sidebar + top bar
│   │   │   ├── dashboard/  operations/  shifts/  guards/  clients/  locations/
│   │   │   ├── attendance/ incidents/  sms/  templates/  reports/
│   │   │   ├── users/  settings/  audit/  simulator/
│   │   ├── api/                  REST + webhook + automation tick
│   │   ├── layout.tsx  globals.css
│   ├── components/
│   │   ├── ui/                   button, card, badge, input, select, table, dialog…
│   │   ├── layout/               sidebar, topbar, page header, emergency banner
│   │   ├── dashboard/            kpi card, trend chart, gauge, attention list
│   │   └── …feature components
│   ├── lib/
│   │   ├── db.ts                 Prisma client
│   │   ├── auth/                 session, password, rbac
│   │   ├── audit.ts  notifications.ts  settings.ts  phone.ts  time.ts
│   │   ├── sms/
│   │   │   ├── provider.ts       SmsProvider interface + registry
│   │   │   ├── providers/        simulated · twilio · africastalking · http
│   │   │   ├── templates.ts      render {{variables}}
│   │   │   ├── outbound.ts       sendTemplated(), sendToGuard()
│   │   │   └── pipeline.ts       processIncomingMessage()
│   │   ├── automation/engine.ts  runAutomationTick()
│   │   └── services/             guards, clients, locations, shifts, incidents, attendance, reports
│   └── instrumentation.ts        starts the in-process scheduler
├── .env.example
└── README.md
```
