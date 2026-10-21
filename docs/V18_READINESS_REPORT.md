# v1.8 stabilisation, basic-phone attendance, welfare and location: readiness report

Date: 21 October 2026. Branch `claude/brave-hopper-92o6rw` (PR #26). Nothing has been deployed,
merged or migrated in production.

**Verdict: not production-ready yet.** The server-side work is complete and tested against a local
database. Three things stand between it and production:

1. Physical-device testing has not been done.
2. The three new migrations must be applied to production with approval.
3. The release keystore does not exist.

Automated IVR and network location are built behind interfaces but have **no real provider**: they
are not features operators can use today.

## Deliverables

| # | Deliverable | Where |
|---|---|---|
| 1 | Repository audit | `docs/V18_AUDIT_AND_PLAN.md` |
| 2 | Issues and root causes (A–G) | same, Part A |
| 3 | Implementation plan | same, "Plan, as built" |
| 4 | Files modified | the commits below; `git diff --stat 52c4a03..HEAD` |
| 5 | Database migrations | see Migrations below |
| 6–8 | Basic-phone attendance, call check-in/out, gateway integration | `docs/BASIC_PHONE_ATTENDANCE.md` |
| 9–10 | Welfare-call architecture, voice-provider status | `docs/WELFARE_CHECKS.md` (no real provider) |
| 11–12 | Network-location interfaces, Zimbabwean operator assessment | `docs/NETWORK_LOCATION.md` |
| 13 | Android fixes | Phase 1 commit: shared EventQueue (WAL, one helper), connection state from heartbeats, shared debug keystore option |
| 14 | Unified attendance timeline | `AttendanceEvidence` now written for CALL, SMS, GPS, IVR, NETWORK and MANUAL; shift page cards for evidence, welfare checks and network checks |
| 15 | Dashboard enhancements | Active operations: filters by phone type and arrival source, missed-welfare and not-checked-out tabs, "by call / GPS verified" under each arrival; guard profile: last call, SMS, GPS fix, network check, welfare status |
| 16–17 | Test and regression results | below |
| 18 | Remaining dependencies | below |
| 19 | Security assessment | below |
| 20 | Production readiness | this document |
| 21 | Developer documentation | the three docs above, plus this report |
| 22 | Operations manual | `docs/OPERATIONS_MANUAL.md` |

Commits on the branch for this work:

- `fefc612`: Phase 1, stabilise.
- `47c7069`: Phase 2, basic-phone attendance.
- `8058677`: Phase 3, welfare and voice.
- `36e42c3`: Phase 4, network location.
- The Phase 5 commit that carries this report.

## Test results (executed 21 October 2026, local PostgreSQL in the build container)

| Suite | Result |
|---|---|
| TypeScript typecheck, ESLint | clean |
| Unit tests (`npm test`) | 150 / 150 |
| Time zone tests (UTC) | 12 / 12 |
| Basic-phone attendance e2e | 25 / 25 |
| Welfare e2e, including the signed HTTP webhook | 42 / 42 |
| Network location e2e | 32 / 32 |
| Check-in / auto check-in | 48 / 48, 48 / 48 |
| Call requests, client notifications | 31 / 31, 51 / 51 |
| Scheduler, shift edit | 17 / 17, 22 / 22 |
| Gateway, integration, alerts | 30 / 30, 20 / 20, 20 / 20 |
| Location, location requests | 38 / 38, 43 / 43 |
| Client SMS updates check | passed |
| Android unit tests (`testDebugUnitTest --rerun`) | 61 / 61 |
| `next build` | passed |

Coverage against the brief:

- **Basic-phone cases 1–20:** all covered by the basic-phone e2e. Case 19 (network API unavailable)
  is covered by the network e2e.
- **Welfare-call cases:** all covered. Every voice case uses the simulated provider.
- **Network cases:** all covered, with the simulation adapter.

**Not executed:**

- Any Android physical-device or emulator test for this round, including the Android regression list
  in Part H §45.
- Any real call to a real gateway phone.
- Any real voice or network provider.

## Physical tests still required (need a real phone; cannot be run from the build container)

1. Gateway phone (operations mode): a feature phone calls it. The call appears under the guard's
   shift as a clock-in by call, within one sync.
2. Same, with the gateway offline (aeroplane mode) for 30 minutes, then back online. The call arrives
   flagged late, at its real time.
3. A missed call (hang up while ringing) is held for confirmation.
4. Operations-phone welfare call: the phone shows the request, the operator calls, and the portal
   shows "Answered, no response yet" until the operator confirms.
5. Pixel 6 Pro guard app: GPS check-in at a site with coordinates now also shows a "GPS verified"
   evidence row.
6. Debug installs across machines with the shared keystore (`OMEGA_DEBUG_KEYSTORE`): no
   INSTALL_FAILED_UPDATE_INCOMPATIBLE.
7. The connection chip goes to "Not connected" when heartbeats stop, and back.
8. A back-to-back shift: the phone shows the shift in progress, not the next one.

## Migrations (additive only; applied to the local test database only)

| Migration | Adds |
|---|---|
| `20261021100000_basic_phone_call_attendance` | phone-profile columns on Guard (with backfill `phoneType = ANDROID` for guard-app guards); AttendanceEvidence; six enums |
| `20261021120000_welfare_schedule_voice` | welfare schedule columns on Location; `Guard.welfareExempt`; welfare call columns on WelfareCheck; VoiceWebhookEvent; `IncidentSource.VOICE`; two enums |
| `20261021140000_network_location` | NetworkLocationCheck; `Location.networkVerifyEnabled` and `networkRadiusM`; `CheckInType.NETWORK_LOCATION`; two enums |

Review notes:

- Nothing is dropped, renamed or narrowed. All new columns are nullable or have defaults.
- `ALTER TYPE … ADD VALUE` (`IncidentSource.VOICE`, `CheckInType.NETWORK_LOCATION`) is allowed in a
  transaction from PostgreSQL 12 on. The new values are not used within the same migration, which is
  the one restriction.
- Vercel builds do not run migrations. **Apply them with `prisma migrate deploy` against production,
  with approval, before merging.** Otherwise the deployed code queries columns that do not exist.
- Take a Neon branch or snapshot first.

## Security assessment

**Voice webhook**

- HMAC-SHA256 over timestamp and raw body, with a constant-time compare.
- Refused when no secret is set. A 5-minute window prevents replay.
- Per-event dedupe, and only the configured provider is accepted.
- No request rate limit: the signature is the gate. A flood of unsigned requests costs one HMAC each.

**Simulated providers** (voice and network) are refused in production builds unless explicitly
allowed. Their output is flagged everywhere and excluded from arrival-source counts.

**Caller identity**

- A number shared by two guards identifies neither.
- Withheld and unknown numbers are assigned to nobody.
- Intent comes from timing, not the number.

**Manual decisions** (confirming or rejecting evidence, manual arrival and completion, manual network
checks) require ADMIN and are audited.

**Network location**

- Consent is checked per request, and requests are limited to the shift.
- Only the requested area is stored; no coordinates are derived.
- Cooldown, per-shift and monthly caps apply.
- Nothing bypasses carrier security.

**Logs.** New `console.error` lines carry error messages only, never phone numbers or coordinates.
Notifications inside the portal include the guard's number, as before.

**Gaps**

- No retention purge for NetworkLocationCheck or AttendanceEvidence (owner decision).
- Provider credentials do not exist yet. When they do, they go in environment variables only.

**Dependencies.** `npm audit --omit=dev` reports **0** vulnerabilities. The full audit shows 5 high
findings, all in the dev-only `braces` chain under `eslint-config-next`. No fix is available
upstream. It does not ship to production.

## Remaining dependencies and owner actions

1. **Approve and apply the three migrations to production**, then merge PR #26. Merging deploys.
2. **Create the release keystore** on your own machine with `npm run android:keystore`, back it up in two places, then `npm run android:release` and `npm run apk:manifest` (`docs/APK_DISTRIBUTION.md`). The 1.8.0 APKs in `artifacts/android` are debug-signed until then.
3. **Run the physical tests above.**
4. **Voice provider**, if automated IVR is wanted: choose one with confirmed +263 coverage, get the
   per-minute price approved, then set `VOICE_PROVIDER` and `VOICE_WEBHOOK_SECRET`.
5. **Network location**, if wanted: written enquiries to Econet, NetOne and Telecel about CAMARA
   Location Verification, pricing and the legal basis. Nothing is enabled until an agreement exists.
6. Carried over from before:
   - change the leaked admin password;
   - top up the Sendai SMS balance;
   - set up the external cron;
   - re-register "Control Room 1" in operations mode.
7. Decide retention for network checks and attendance evidence.
