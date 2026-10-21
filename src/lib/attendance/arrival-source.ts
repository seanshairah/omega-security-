/**
 * How a shift's arrival is known, for lists and filters. The strongest confirmed evidence wins:
 * GPS, then the network, then a person, then a call, an SMS or a key press. A call or an SMS never
 * reads as GPS. Pure: the caller passes the shift's confirmed evidence sources.
 */
import type { EvidenceSource } from "@prisma/client";

export type ArrivalSource = "GPS" | "NETWORK" | "MANUAL" | "CALL" | "SMS" | "CONFIRMED" | "NONE";

const ORDER: EvidenceSource[] = ["GPS", "NETWORK", "MANUAL", "CALL", "SMS", "IVR", "MISSED_CALL"];

export function arrivalSource(input: { arrivalConfirmedAt: Date | null; gpsVerified: boolean; confirmedSources: EvidenceSource[] }): ArrivalSource {
  if (input.gpsVerified || input.confirmedSources.includes("GPS")) return "GPS";
  const best = ORDER.find((s) => input.confirmedSources.includes(s));
  if (best === "NETWORK" || best === "MANUAL" || best === "CALL" || best === "SMS") return best;
  if (best === "IVR" || best === "MISSED_CALL") return "CALL";
  // Arrivals confirmed before evidence was recorded (older shifts) say only that they were confirmed.
  return input.arrivalConfirmedAt ? "CONFIRMED" : "NONE";
}

export const ARRIVAL_SOURCE_LABEL: Record<ArrivalSource, string> = {
  GPS: "GPS verified", NETWORK: "Network verified", MANUAL: "Confirmed by a supervisor", CALL: "By call", SMS: "By SMS", CONFIRMED: "Confirmed", NONE: "Not confirmed",
};

export type PhoneGroup = "ANDROID" | "BASIC" | "UNKNOWN";
export function phoneGroup(g: { phoneType: string; deviceKind: string }): PhoneGroup {
  if (g.deviceKind === "ANDROID_GUARD" || g.phoneType === "ANDROID") return "ANDROID";
  if (g.phoneType === "BASIC") return "BASIC";
  return "UNKNOWN";
}
