import { test } from "node:test";
import assert from "node:assert/strict";
import { routeVerification, parseNetworkPolicy, DEFAULT_NETWORK_POLICY, type RouteFacts } from "../src/lib/network-location/router-rules";
import { mapCamaraVerification, networkProviderFor } from "../src/lib/network-location/provider";

const ON = { ...DEFAULT_NETWORK_POLICY, enabled: true };
const basic = (o: Partial<RouteFacts> = {}): RouteFacts => ({
  trigger: "INCOMING_CALL", phoneType: "BASIC", operator: "ECONET", networkEligible: true, consentAt: new Date(), inShift: true,
  siteHasArea: true, providerConfigured: true, gpsAgeMinutes: null, minutesSinceLastSent: null, sentThisShift: 0, sentThisMonth: 0, ...o,
});
const result = (r: ReturnType<typeof routeVerification>) => (r.method === "RECORD" ? r.result : r.method);

test("a basic phone with consent, a shift, an area and a provider is checked by the network", () => {
  assert.equal(routeVerification(basic(), ON).method, "NETWORK");
});

test("unknown phone types never qualify", () => {
  assert.equal(result(routeVerification(basic({ phoneType: "UNKNOWN" }), ON)), "NETWORK_UNSUPPORTED");
  assert.equal(result(routeVerification(basic({ phoneType: "OTHER" }), ON)), "NETWORK_UNSUPPORTED");
});

test("off, not eligible, no consent or outside a shift: recorded, never sent", () => {
  assert.equal(result(routeVerification(basic(), DEFAULT_NETWORK_POLICY)), "NETWORK_LOCATION_UNAVAILABLE");
  assert.equal(result(routeVerification(basic({ networkEligible: false }), ON)), "NETWORK_NOT_AUTHORISED");
  assert.equal(result(routeVerification(basic({ consentAt: null }), ON)), "NETWORK_NOT_AUTHORISED");
  assert.equal(result(routeVerification(basic({ inShift: false }), ON)), "NETWORK_NOT_AUTHORISED");
});

test("no area, no known network or no provider: recorded with the reason", () => {
  assert.equal(result(routeVerification(basic({ siteHasArea: false }), ON)), "NETWORK_UNSUPPORTED");
  assert.equal(result(routeVerification(basic({ operator: "UNKNOWN" }), ON)), "NETWORK_UNSUPPORTED");
  assert.equal(result(routeVerification(basic({ providerConfigured: false }), ON)), "NETWORK_PROVIDER_UNAVAILABLE");
});

test("cooldown, per-shift and monthly limits skip without a record", () => {
  assert.equal(routeVerification(basic({ minutesSinceLastSent: 5 }), ON).method, "SKIP");
  assert.equal(routeVerification(basic({ minutesSinceLastSent: 31 }), ON).method, "NETWORK");
  assert.equal(routeVerification(basic({ sentThisShift: 4 }), ON).method, "SKIP");
  assert.equal(routeVerification(basic({ sentThisMonth: 500 }), ON).method, "SKIP");
  assert.equal(routeVerification(basic({ sentThisMonth: 5000 }), { ...ON, monthlyCap: 0 }).method, "NETWORK", "0 means no cap");
});

test("Android: GPS first; the network only when GPS has gone quiet and the fallback is on", () => {
  const android = (o: Partial<RouteFacts>) => basic({ phoneType: "ANDROID", trigger: "ANDROID_FALLBACK", ...o });
  assert.equal(routeVerification(android({ gpsAgeMinutes: 3 }), { ...ON, androidFallback: true }).method, "GPS");
  assert.equal(routeVerification(android({ gpsAgeMinutes: 45 }), ON).method, "GPS", "fallback off: keep waiting for the app");
  assert.equal(routeVerification(android({ gpsAgeMinutes: 45 }), { ...ON, androidFallback: true }).method, "NETWORK");
  assert.equal(routeVerification(android({ gpsAgeMinutes: null }), { ...ON, androidFallback: true }).method, "NETWORK");
  assert.equal(routeVerification(android({ gpsAgeMinutes: 45, trigger: "MANUAL" }), ON).method, "NETWORK", "an admin may ask");
});

test("CAMARA-style answers map to our states; an old position is stale, whatever it says", () => {
  const now = new Date("2026-10-21T22:00:00Z");
  const t = (s: number) => new Date(now.getTime() - s * 1000).toISOString();
  assert.equal(mapCamaraVerification({ verificationResult: "TRUE", lastLocationTime: t(60) }, 300, now).result, "NETWORK_VERIFIED_INSIDE");
  assert.equal(mapCamaraVerification({ verificationResult: "FALSE", lastLocationTime: t(60) }, 300, now).result, "NETWORK_VERIFIED_OUTSIDE");
  const partial = mapCamaraVerification({ verificationResult: "PARTIAL", matchRate: 64, lastLocationTime: t(60) }, 300, now);
  assert.equal(partial.result, "NETWORK_PARTIAL_MATCH");
  assert.equal(partial.matchRate, 64);
  assert.equal(mapCamaraVerification({ verificationResult: "UNKNOWN" }, 300, now).result, "NETWORK_LOCATION_UNAVAILABLE");
  assert.equal(mapCamaraVerification({ verificationResult: "TRUE", lastLocationTime: t(900) }, 300, now).result, "NETWORK_LOCATION_STALE");
});

test("operator adapters are unconfigured and never claim an answer", async () => {
  const prev = process.env.NETWORK_LOCATION_PROVIDER;
  delete process.env.NETWORK_LOCATION_PROVIDER;
  for (const op of ["ECONET", "NETONE", "TELECEL"] as const) {
    const p = networkProviderFor(op)!;
    assert.equal(p.configured(), false);
    assert.equal(p.simulated, false);
    const a = await p.verify({ phone: "+263771234567", area: { latitude: -17.8, longitude: 31.0, radiusM: 1000 }, maxAgeSeconds: 300, reference: "t" });
    assert.equal(a.result, "NETWORK_PROVIDER_UNAVAILABLE");
  }
  assert.equal(networkProviderFor("UNKNOWN"), null);
  if (prev) process.env.NETWORK_LOCATION_PROVIDER = prev;
});

test("policy settings parse with safe defaults", () => {
  const p = parseNetworkPolicy({ "networkLocation.enabled": "true", "networkLocation.cooldownMinutes": "-3", "networkLocation.onIncomingCall": "true" });
  assert.equal(p.enabled, true);
  assert.equal(p.onIncomingCall, true);
  assert.equal(p.cooldownMinutes, DEFAULT_NETWORK_POLICY.cooldownMinutes);
  assert.equal(parseNetworkPolicy({}).enabled, false);
});
