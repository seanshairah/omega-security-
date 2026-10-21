# Hybrid location verification and network location

Location verification strengthens attendance; it never gates it. A guard who clocks in by call or SMS
stays clocked in whatever a location check says. GPS, network and communication evidence are kept as
separate records, so a call is never displayed as GPS and a network estimate never overwrites GPS.

## Router

`routeVerification` (`src/lib/network-location/router-rules.ts`, pure) decides, per request:

```
request → guard → phone type → eligibility → method → result
```

| Phone | Method |
|---|---|
| ANDROID (guard app) | GPS from the app. A network check is a fallback only when GPS has been quiet for `androidStaleMinutes` and `androidFallback` is on, or an admin asks. |
| BASIC | Network only, with consent, an active shift, a site network area, a known network and an authorised provider. Otherwise a record of why not. |
| UNKNOWN / OTHER | Never qualifies (NETWORK_UNSUPPORTED). |

Outcomes: **GPS** (nothing stored), **NETWORK** (one request sent, result stored), **RECORD** (no
request; the reason is stored, e.g. NETWORK_NOT_AUTHORISED), **SKIP** (cooldown, per-shift or monthly
cap; nothing stored).

## Results

`NetworkLocationCheck.result`: NETWORK_VERIFIED_INSIDE, NETWORK_VERIFIED_OUTSIDE,
NETWORK_PARTIAL_MATCH, NETWORK_LOCATION_STALE, NETWORK_LOCATION_UNAVAILABLE,
NETWORK_PROVIDER_UNAVAILABLE, NETWORK_NOT_AUTHORISED, NETWORK_UNSUPPORTED, NETWORK_ERROR.

Each row keeps the provider, trigger, requested area (centre and radius), max age, the network's
observation time, match rate, uncertainty, authorisation reference, provider reference, cost units,
`simulated`, and request and completion times. **No guard coordinates are derived from a yes/no
answer.**

Effects:

- **Inside:** PRESENCE evidence, source NETWORK ("Network verified"; "Simulated network check · not real evidence" when simulated).
- **Outside:** a LOCATION_EXCEPTION notification asking a person to call the guard. Attendance is untouched.
- **Everything else:** stored and shown, never evidence.

Every sent check also adds a NETWORK_LOCATION timeline line ending "Not GPS."

## Separate policies

The GPS geofence (`Location.geofenceRadiusM`, accuracy limit, exit confirmation) is unchanged and is
never widened for network checks. The network duty area is its own: `Location.networkVerifyEnabled`
plus `Location.networkRadiusM`, centred on the site's (or the shift override's) coordinates. Ask the
operator which area sizes they actually support before choosing a radius.

## Triggers and limits (Settings → Network location; all off by default)

`networkLocation.enabled`, `onShiftStart`, `midShift`, `onShiftEnd`, `onIncomingCall`,
`afterWelfareCall`, `androidFallback` (+ `androidStaleMinutes`), `retryUncertain`, `cooldownMinutes`
(30), `maxPerShift` (4), `monthlyCap` (500, 0 = none), `maxAgeSeconds` (300). An admin can also press
**Check by network** on a shift, which is audited. Every trigger has a dedupe key (`SHIFT_START:<shiftId>`,
`call:<callLogId>`, `welfare:<checkId>`…), so the engine cannot repeat a check. Checks are limited to
the shift (15 minutes either side).

## Providers

`NetworkLocationProvider` (`src/lib/network-location/provider.ts`): `configured()`,
`authorisationRef()`, `verify({ phone, area, maxAgeSeconds, reference })`. The request and answer
follow the shape of the CAMARA Location Verification API (circle plus maxAge in; TRUE / FALSE /
PARTIAL / UNKNOWN, matchRate and lastLocationTime out). `mapCamaraVerification` turns that answer
into our states and treats an old position as stale.

| Adapter | Status |
|---|---|
| `econet`, `netone`, `telecel` | **Unconfigured.** Never send a request; always NETWORK_PROVIDER_UNAVAILABLE. No endpoint, credential or capability is assumed. |
| `simulation` | For tests and demonstrations (`NETWORK_LOCATION_PROVIDER=simulation`). Refused in production builds unless `ALLOW_SIMULATED_NETWORK_LOCATION=1`. Every result is flagged simulated. |

To enable a real operator: obtain a signed agreement and the operator's API documentation, implement
`verify` against it, keep the credentials in environment variables, make `configured()` check them,
set a real `authorisationRef`, add a request timeout (a timeout or exception is stored as
NETWORK_ERROR), and run `scripts/dev/network-location-e2e.ts` plus a live test with consenting staff.

## Zimbabwean operator API availability (assessed 21 October 2026)

Desk research only. Nothing was confirmed with the operators themselves.

- **GSMA Open Gateway / CAMARA.** The specifications exist: Location Verification, Location
  Retrieval and Geofencing Subscriptions. The public GSMA and channel-partner material lists the
  operators that have launched them. **Econet Wireless Zimbabwe, NetOne and Telecel Zimbabwe do not
  appear in any public listing found**, including the Africa channel-partner announcements.
- **Econet, NetOne, Telecel.** No public subscriber-location API, and no published location
  partnership, was found for any of them.
- **Programmable voice (for IVR).** Africa's Talking documents a voice API, but its published coverage
  did not show Zimbabwe at the time of research. Any provider's +263 termination, price per minute
  and webhook signing must be confirmed in writing before use.

Conclusion: **no authorised network-location service is available to Omega today.** The adapters
stay unconfigured. Basic-phone attendance (calls, SMS, welfare checks) works without one. The next
step is a written enquiry to each operator's enterprise or wholesale team asking about CAMARA
Location Verification, pricing, consent requirements and the legal basis under Zimbabwe's Cyber and
Data Protection Act.

Sources:

- https://www.gsma.com/solutions-and-impact/gsma-open-gateway/gsma-open-gateway-api-descriptions/
- https://www.gsma.com/solutions-and-impact/gsma-open-gateway/open-gateway-unlocking-the-power-of-network-apis/
- https://www.gsma.com/solutions-and-impact/gsma-open-gateway/netapi-telecom-gsma-open-gateway-channel-partner-africa/
- https://github.com/api-evangelist/open-gateway
- https://AfricasTalking.com/voice
- https://learn.microsoft.com/en-us/connectors/africastalkingvoice
- https://blog.africastalking.com/building-a-virtual-call-center-with-africas-talking-voice-api-a-guide-for-smes-and-startups-3f2cc4e2184b
- https://en.wikipedia.org/wiki/Econet_Global

## Privacy

- Consent is per guard (`networkLocationConsentAt`) and checked on every request. Clearing it in the guard form revokes it immediately.
- Checks happen only within a shift (data minimisation).
- Only the requested area and the answer are stored.
- Manual requests are audited. Cooldown and caps bound both cost and intrusion.
- No retention purge runs on network checks yet; deleting them is an owner decision.
- Nothing here uses SS7, IMSI catchers, SIM interception or any carrier-security bypass. Only an operator's authorised API may be added.

## Tests

`tests/network-location.test.ts` (9) and `scripts/dev/network-location-e2e.ts`
(`npm run test:network-location`, 32 checks).
