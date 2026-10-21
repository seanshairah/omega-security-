# v1.8 testing audit and plan: hybrid attendance

Audited 21 October 2026 on branch `claude/brave-hopper-92o6rw` (PR #26, head `52c4a03`), against the
results of the isolated v1.8 test (`localhost:3002`, `omega_v18_test`, Pixel 6 Pro).

All work here runs in a separate cloud container with its own local PostgreSQL. It never reaches the
isolated test environment, `sentinel`, `omega-pg` on 5433, or production. Anything that needs the
Pixel is written up as a device test, not reported as passed.

## Part A: issues from testing, confirmed against the code

| # | Issue | Root cause (from the code) | Fix |
|---|---|---|---|
| A | GPS "unavailable", `site_has_no_coordinates` | **Correct behaviour.** The phone's config takes the duty site from the *shift* (`guardDeviceConfig`), not the gateway's optional `locationId`. ABC Warehouse has no coordinates, so there is nothing to judge against. ~98 m accuracy is the phone's fix, not a geofence result. | No GPS change. Make the missing coordinates impossible to miss (B). |
| B | Site without coordinates | Data. Warnings exist on the site page and New shift, but not where attendance is read (shift page, Monitoring, operations). | Warning wherever GPS attendance is shown, a "site not configured" state, and a list of active sites without coordinates. Never fabricated: no `0,0`, no guard position as the site. |
| C | Phone showed no shift, then ACTIVE | Two rules disagree. The config endpoint sends the **earliest** unclosed shift that ended within 60 min. The phone treats a shift as active from start −10 min to end +30 min. With back-to-back shifts and the earlier one not yet closed, the phone gets the earlier shift, judges it over and shows "No shift". Config also refreshes only on heartbeats (2 min), so a shift created after activation shows up to 2 min late. | One pure `selectDeviceShift` on the server using the phone's own window: the shift containing now, else the next one, else the most recent within 30 min. Unit-tested, overnight shifts included. |
| D | "No internet" while the backend says SYNCED | `isOnline` is Android's "has a network with INTERNET" flag. Over `adb reverse` the server is reachable through USB with no network, and the home screen gave network state priority over a heartbeat that had just worked. The reverse also happens: `heartbeatOk` stays true until a heartbeat *fails*, so a stopped service would still say Online. | The chip judges server reachability by the last heartbeat: Online if one succeeded within 3 intervals, whatever Android says about the network; *Not heard from* if none for longer; No internet only when neither holds. |
| E | SQLite queue | **No shared queue in this branch.** Ten call sites each build their own `EventQueue` (a `SQLiteOpenHelper`), and the home screen builds a new one every 3 s. `@Synchronized` locks per instance, so writers on different instances are not serialised (risk of `database is locked`), and unclosed helpers leak connections. The shared-queue refactor you mention isn't in this repository; if it exists on your machine, it hasn't been pushed. | One application-scoped `EventQueue.get(context)` with write-ahead logging; every caller uses it. Schema version unchanged, so no queued row is touched on upgrade. |
| F | `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | Debug builds are signed with each machine's own `~/.android/debug.keystore`. The 1.8.0 debug APK in `artifacts/` was built in this container, so its key differs from one built on your Mac. | Optional shared development keystore (`OMEGA_DEBUG_KEYSTORE*` in `local.properties` or the environment, never committed). Documented: build debug APKs on one machine, never uninstall to "fix" it. |
| G | HTTP/HTTPS | Separation intact: release has `DEV_HTTP_HOSTS=""` and `requireHttps`; debug cleartext only for listed hosts. | No change. Covered by the existing test. |
| — | Dependencies | 5 findings (4 high): `postcss` bundled in Next 15, and `deepmerge-ts` in the Prisma CLI. Both run at build or CLI time, never on request input. npm's fix is a major upgrade of Next and Prisma. | Pin patched versions through `overrides`; keep only if build, generate and the tests pass. Otherwise document. |

## Part B: basic-phone attendance, what exists and what is missing

The operations gateway already logs every call on its SIM, offline too (durable queue), and the
server already normalises the caller's number, matches a guard by `Guard.phone`, links the live
shift, writes the shift timeline and alerts on missed calls from guards on duty.

Missing:

1. **The call drives no attendance decision.** `handleCall` only acts on a call seen on the guard's
   own Android phone. A basic phone ringing the control room is logged, nothing more.
2. **Late calls lose their shift.** `findLiveShiftForGuard` excludes closed shifts, so a call synced
   after the engine closed the shift is stored with no shift.
3. **No phone type, operator, alternative numbers or assigned gateway on the guard.** `deviceKind` is
   derived from registered APK devices and cannot say "basic phone on NetOne".
4. **No evidence record.** Attendance is one status; the source of each fact (call, SMS, GPS,
   manual) is not stored separately.
5. **No missed-call policy, no check-out by call, no wrong-gateway policy.**

What Android allows (target SDK 35, Android 15 to 17): an ordinary app may observe call state and,
with permission, the call log (number, direction, duration, answered or not). It cannot answer a
call, play a prompt, read keypad digits or hang up a cellular call. No IVR is simulated on a normal
call. Automated prompts need a programmable voice provider or a PBX (Phase 3).

## Part C, D: welfare and location

- Welfare today: one mid-shift SMS (`welfare.*` settings) with a reply window and escalation. No
  schedule per site, no voice channel.
- Network location: nothing exists. A web search found no public evidence of CAMARA / GSMA Open
  Gateway location APIs from Econet, NetOne or Telecel in Zimbabwe, nor a published Zimbabwe voice
  coverage page from Africa's Talking. Interfaces and a simulator only; live adapters stay
  unconfigured until an operator agreement exists.

## Plan, as built

1. **Stabilise**: A–G above.
2. **Call attendance**: guard phone profile; `AttendanceEvidence`; a pure call classifier (check-in /
   welfare / check-out / pending / ignored) from shift timing and attendance state, never from the
   number alone; policy settings (answered-call minimum, missed-call mode, wrong-gateway mode,
   windows); historical shift matching for late calls; manual correction with audit.
3. **Welfare checks**: per-site schedule (times or interval), channels SMS / voice / gateway call,
   voice provider interface with a simulator, signed webhooks with replay protection, statuses
   from *scheduled* to *escalated*, retries, SMS fallback, supervisor escalation.
4. **Location verification**: router by phone type and eligibility; `NetworkLocationProvider` with
   simulation and unconfigured carrier adapters; `NetworkLocationCheck` storage; separate network
   policy radius; consent, cooldown, daily cap; Android fallback only when GPS evidence is stale.
5. **Evidence everywhere**: labels (GPS verified, Network verified, Call confirmed, SMS confirmed,
   IVR response, Manually verified, Location uncertain / unavailable, Attendance pending) on the
   shift timeline, guard page, Monitoring and operations filters; tests, docs, readiness.

A call confirms that a call happened. It never proves who held the phone or where they were, and the
system never shows it as location evidence.
