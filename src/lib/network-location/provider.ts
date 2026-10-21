/**
 * Mobile-network location verification, behind one interface.
 *
 * Nothing here talks to a real operator. As of this writing there is no public evidence that
 * Econet, NetOne or Telecel offer a location-verification API (GSMA Open Gateway / CAMARA or
 * otherwise) to third parties; see docs/NETWORK_LOCATION.md. The three operator adapters exist so
 * the rest of the system is ready when one is contracted. They are unconfigured: they never send a
 * request and always answer NETWORK_PROVIDER_UNAVAILABLE. No endpoint, credential or capability is
 * assumed for them.
 *
 * The request and answer follow the shape of the CAMARA Location Verification API (a circle and a
 * maximum age in; TRUE / FALSE / PARTIAL / UNKNOWN, a match rate and the last location time out),
 * because that is the published standard an operator would most likely offer. A verification answer
 * is a yes or no about an area: it is never turned into coordinates.
 */
import type { MobileOperator, NetworkLocationResult } from "@prisma/client";

export type VerifyArea = { latitude: number; longitude: number; radiusM: number };

export type VerifyRequest = { phone: string; area: VerifyArea; maxAgeSeconds: number; reference: string };

export type VerifyAnswer = {
  result: NetworkLocationResult;
  observedAt?: Date | null;
  matchRate?: number | null;
  uncertaintyM?: number | null;
  providerRef?: string | null;
  costUnits?: number | null;
  error?: string | null;
};

export interface NetworkLocationProvider {
  readonly name: string;
  readonly operator: MobileOperator | "ANY";
  /** Simulated answers are flagged everywhere and never count as real location evidence. */
  readonly simulated: boolean;
  /** Has the owner configured an authorised integration (credentials, contract)? */
  configured(): boolean;
  /** The authorisation the request is made under (contract or consent reference), stored with the result. */
  authorisationRef(): string | null;
  verify(req: VerifyRequest): Promise<VerifyAnswer>;
}

/** The answer of a CAMARA-style verifyLocation call, as published in the CAMARA specification. */
export type CamaraVerification = { verificationResult: "TRUE" | "FALSE" | "PARTIAL" | "UNKNOWN"; matchRate?: number; lastLocationTime?: string };

/** Maps a CAMARA-style answer to our result. A position older than the allowed age is stale, whatever it says. */
export function mapCamaraVerification(r: CamaraVerification, maxAgeSeconds: number, now: Date): Pick<VerifyAnswer, "result" | "observedAt" | "matchRate"> {
  const observedAt = r.lastLocationTime ? new Date(r.lastLocationTime) : null;
  const valid = observedAt && !Number.isNaN(observedAt.getTime()) ? observedAt : null;
  if (valid && now.getTime() - valid.getTime() > maxAgeSeconds * 1000) return { result: "NETWORK_LOCATION_STALE", observedAt: valid, matchRate: r.matchRate ?? null };
  const result: NetworkLocationResult =
    r.verificationResult === "TRUE" ? "NETWORK_VERIFIED_INSIDE"
      : r.verificationResult === "FALSE" ? "NETWORK_VERIFIED_OUTSIDE"
        : r.verificationResult === "PARTIAL" ? "NETWORK_PARTIAL_MATCH"
          : "NETWORK_LOCATION_UNAVAILABLE";
  return { result, observedAt: valid, matchRate: r.verificationResult === "PARTIAL" ? r.matchRate ?? null : null };
}

/**
 * An operator with no authorised integration. It never sends anything. To enable one, implement
 * `verify` against that operator's actual documentation, under a signed agreement, with
 * credentials in environment variables, and make `configured()` check them.
 */
class UnconfiguredOperatorAdapter implements NetworkLocationProvider {
  readonly simulated = false;
  constructor(readonly name: string, readonly operator: MobileOperator) {}
  configured() { return false; }
  authorisationRef() { return null; }
  async verify(): Promise<VerifyAnswer> {
    return { result: "NETWORK_PROVIDER_UNAVAILABLE", error: `No authorised ${this.name} integration is configured.` };
  }
}

export const EconetLocationAdapter = () => new UnconfiguredOperatorAdapter("econet", "ECONET");
export const NetOneLocationAdapter = () => new UnconfiguredOperatorAdapter("netone", "NETONE");
export const TelecelLocationAdapter = () => new UnconfiguredOperatorAdapter("telecel", "TELECEL");

/** Scripted answers for tests and demonstrations, by phone number. Default: inside. */
const scripted = new Map<string, CamaraVerification | "ERROR">();
export function setSimulatedNetworkAnswer(phone: string, answer: CamaraVerification | "ERROR" | null) {
  if (answer) scripted.set(phone, answer); else scripted.delete(phone);
}

class SimulationLocationAdapter implements NetworkLocationProvider {
  readonly name = "simulation";
  readonly operator = "ANY" as const;
  readonly simulated = true;
  configured() { return process.env.NODE_ENV !== "production" || process.env.ALLOW_SIMULATED_NETWORK_LOCATION === "1"; }
  authorisationRef() { return "simulation"; }
  async verify(req: VerifyRequest): Promise<VerifyAnswer> {
    const a = scripted.get(req.phone) ?? { verificationResult: "TRUE", lastLocationTime: new Date().toISOString() };
    if (a === "ERROR") return { result: "NETWORK_ERROR", error: "simulated provider error", providerRef: `sim_${req.reference}` };
    return { ...mapCamaraVerification(a, req.maxAgeSeconds, new Date()), providerRef: `sim_${req.reference}`, costUnits: 0 };
  }
}

/**
 * The adapter for a guard's network. NETWORK_LOCATION_PROVIDER=simulation routes every network to
 * the simulation adapter (refused in production builds unless explicitly allowed); otherwise each
 * operator gets its own adapter, which today is unconfigured. Unknown networks get none.
 */
export function networkProviderFor(operator: MobileOperator): NetworkLocationProvider | null {
  const mode = (process.env.NETWORK_LOCATION_PROVIDER ?? "").trim().toLowerCase();
  if (mode === "simulation") {
    const sim = new SimulationLocationAdapter();
    return sim.configured() ? sim : null;
  }
  if (operator === "ECONET") return EconetLocationAdapter();
  if (operator === "NETONE") return NetOneLocationAdapter();
  if (operator === "TELECEL") return TelecelLocationAdapter();
  return null;
}
