/**
 * The verification router: which way, if any, to check where a guard is. Pure, no database.
 *
 *   request → guard → phone type → eligibility → method → result
 *
 * Android guards are checked by the guard app's GPS. A network check is only a fallback when their
 * GPS has gone quiet for longer than the policy allows, and it is stored apart from GPS history.
 * Basic phones can only be checked by the network, and only with consent, an authorised provider
 * and an active shift. Unknown phone types never qualify. Whatever the router decides, call and SMS
 * attendance carry on unchanged: location strengthens attendance, it never blocks it.
 */
import type { MobileOperator, NetworkCheckTrigger, NetworkLocationResult, PhoneType } from "@prisma/client";

export type NetworkPolicy = {
  enabled: boolean;
  cooldownMinutes: number;
  maxPerShift: number;
  monthlyCap: number;
  maxAgeSeconds: number;
  androidStaleMinutes: number;
  onShiftStart: boolean;
  midShift: boolean;
  onShiftEnd: boolean;
  onIncomingCall: boolean;
  afterWelfareCall: boolean;
  androidFallback: boolean;
  retryUncertain: boolean;
};

export const DEFAULT_NETWORK_POLICY: NetworkPolicy = {
  enabled: false, cooldownMinutes: 30, maxPerShift: 4, monthlyCap: 500, maxAgeSeconds: 300, androidStaleMinutes: 20,
  onShiftStart: false, midShift: false, onShiftEnd: false, onIncomingCall: false, afterWelfareCall: false, androidFallback: false, retryUncertain: false,
};

export function parseNetworkPolicy(raw: Record<string, string | undefined>): NetworkPolicy {
  const b = (k: keyof NetworkPolicy) => { const v = raw[`networkLocation.${k}`]; return v == null ? (DEFAULT_NETWORK_POLICY[k] as boolean) : v === "true"; };
  const n = (k: keyof NetworkPolicy, min: number) => { const v = Number(raw[`networkLocation.${k}`]); return Number.isFinite(v) && v >= min ? v : (DEFAULT_NETWORK_POLICY[k] as number); };
  return {
    enabled: b("enabled"), cooldownMinutes: n("cooldownMinutes", 1), maxPerShift: n("maxPerShift", 1), monthlyCap: n("monthlyCap", 0), maxAgeSeconds: n("maxAgeSeconds", 30), androidStaleMinutes: n("androidStaleMinutes", 5),
    onShiftStart: b("onShiftStart"), midShift: b("midShift"), onShiftEnd: b("onShiftEnd"), onIncomingCall: b("onIncomingCall"), afterWelfareCall: b("afterWelfareCall"), androidFallback: b("androidFallback"), retryUncertain: b("retryUncertain"),
  };
}

export type RouteFacts = {
  trigger: NetworkCheckTrigger;
  phoneType: PhoneType;
  operator: MobileOperator;
  networkEligible: boolean;
  consentAt: Date | null;
  /** The shift is running (with a little margin either side); checks are shift-limited. */
  inShift: boolean;
  /** The site has coordinates and a network duty area turned on. */
  siteHasArea: boolean;
  providerConfigured: boolean;
  /** Android only: minutes since the last usable GPS fix from the guard app, null if none this shift. */
  gpsAgeMinutes: number | null;
  /** Minutes since this guard's last network request that was actually sent, null if none. */
  minutesSinceLastSent: number | null;
  sentThisShift: number;
  sentThisMonth: number;
};

export type Route =
  | { method: "GPS"; reason: string }
  | { method: "NETWORK" }
  | { method: "RECORD"; result: NetworkLocationResult; reason: string } // nothing is sent; the reason is kept
  | { method: "SKIP"; reason: string }; // nothing is sent or kept (cooldown, caps)

export function routeVerification(f: RouteFacts, p: NetworkPolicy): Route {
  if (f.phoneType === "UNKNOWN" || f.phoneType === "OTHER") return { method: "RECORD", result: "NETWORK_UNSUPPORTED", reason: "The guard's phone type is not known, so no location check is made." };
  if (f.phoneType === "ANDROID") {
    const fresh = f.gpsAgeMinutes != null && f.gpsAgeMinutes < p.androidStaleMinutes;
    if (fresh) return { method: "GPS", reason: "The guard app's GPS is current." };
    if (f.trigger !== "MANUAL" && !p.androidFallback) return { method: "GPS", reason: "Network fallback for Android guards is turned off. Waiting for the guard app." };
  }
  if (!p.enabled) return { method: "RECORD", result: "NETWORK_LOCATION_UNAVAILABLE", reason: "Network location checks are turned off." };
  if (!f.networkEligible || !f.consentAt) return { method: "RECORD", result: "NETWORK_NOT_AUTHORISED", reason: !f.networkEligible ? "The guard is not set up for network location checks." : "No consent from the guard is recorded." };
  if (!f.inShift) return { method: "RECORD", result: "NETWORK_NOT_AUTHORISED", reason: "Network checks are only made during the guard's shift." };
  if (f.operator === "UNKNOWN" || f.operator === "OTHER") return { method: "RECORD", result: "NETWORK_UNSUPPORTED", reason: "The guard's mobile network is not known or not supported." };
  if (!f.siteHasArea) return { method: "RECORD", result: "NETWORK_UNSUPPORTED", reason: "The site has no network duty area (coordinates and a network radius)." };
  if (!f.providerConfigured) return { method: "RECORD", result: "NETWORK_PROVIDER_UNAVAILABLE", reason: "No authorised location service is configured for this network." };
  if (f.minutesSinceLastSent != null && f.minutesSinceLastSent < p.cooldownMinutes) return { method: "SKIP", reason: `Checked ${Math.round(f.minutesSinceLastSent)} min ago; the cooldown is ${p.cooldownMinutes} min.` };
  if (f.sentThisShift >= p.maxPerShift) return { method: "SKIP", reason: `Already ${f.sentThisShift} network checks this shift (limit ${p.maxPerShift}).` };
  if (p.monthlyCap > 0 && f.sentThisMonth >= p.monthlyCap) return { method: "SKIP", reason: `The monthly limit of ${p.monthlyCap} network checks is reached.` };
  return { method: "NETWORK" };
}

/** Results that say something about place; the rest say why there is no answer. */
export const NETWORK_RESULT_META: Record<NetworkLocationResult, { label: string; tone: "ok" | "warn" | "critical" | "info" | "neutral" | "muted"; located: boolean }> = {
  NETWORK_VERIFIED_INSIDE: { label: "Network: inside the duty area", tone: "ok", located: true },
  NETWORK_VERIFIED_OUTSIDE: { label: "Network: outside the duty area", tone: "critical", located: true },
  NETWORK_PARTIAL_MATCH: { label: "Network: partly inside", tone: "warn", located: true },
  NETWORK_LOCATION_STALE: { label: "Network position too old", tone: "warn", located: false },
  NETWORK_LOCATION_UNAVAILABLE: { label: "Network location unavailable", tone: "muted", located: false },
  NETWORK_PROVIDER_UNAVAILABLE: { label: "No network location service", tone: "muted", located: false },
  NETWORK_NOT_AUTHORISED: { label: "Network check not authorised", tone: "muted", located: false },
  NETWORK_UNSUPPORTED: { label: "Network check not supported", tone: "muted", located: false },
  NETWORK_ERROR: { label: "Network check failed", tone: "warn", located: false },
};

export const NETWORK_TRIGGER_LABEL: Record<NetworkCheckTrigger, string> = {
  SHIFT_START: "shift start", MID_SHIFT: "mid-shift", SHIFT_END: "shift end", INCOMING_CALL: "guard's call",
  AFTER_WELFARE_CALL: "after the welfare call", MANUAL: "requested", RETRY_UNCERTAIN: "retry after an unclear result", ANDROID_FALLBACK: "GPS gone quiet",
};
