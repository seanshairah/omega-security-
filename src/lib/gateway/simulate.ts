/** Developer simulation: build the same event the phone would send and push it through the real intake. */
import { randomUUID } from "node:crypto";
import type { GatewayDevice } from "@prisma/client";
import { processGatewayEvents } from "./events";
import type { GatewayEventType } from "./call-state";
import type { LOCATION_EVENT_TYPES } from "./location-events";

export type SimulateInput = { gatewayId: string; eventType: GatewayEventType | (typeof LOCATION_EVENT_TYPES)[number] | "DEVICE_STATUS"; phoneNumber?: string; callId?: string; direction?: "INCOMING" | "OUTGOING"; durationSeconds?: number; answered?: boolean; at?: string; latitude?: number; longitude?: number; accuracyM?: number; locationState?: "INSIDE" | "OUTSIDE" | "UNKNOWN"; distanceM?: number; reason?: string; durationOutsideSeconds?: number; mock?: boolean; meta?: Record<string, unknown> };

export async function simulateGatewayEvent(device: GatewayDevice, input: SimulateInput) {
  const callId = input.callId ?? `sim-${randomUUID()}`;
  const event = { eventId: `sim-${randomUUID()}`, eventType: input.eventType, callId, phoneNumber: input.phoneNumber, direction: input.direction, timestamp: input.at ?? new Date().toISOString(), durationSeconds: input.durationSeconds, answered: input.answered, latitude: input.latitude, longitude: input.longitude, accuracyM: input.accuracyM, locationState: input.locationState, distanceM: input.distanceM, reason: input.reason, durationOutsideSeconds: input.durationOutsideSeconds, mock: input.mock, meta: { simulated: true, ...(input.meta ?? {}) } };
  const [ack] = await processGatewayEvents(device, [event], { simulated: true });
  return { callId, ack };
}
