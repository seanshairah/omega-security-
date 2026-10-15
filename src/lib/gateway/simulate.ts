/** Developer simulation: build the same event the phone would send and push it through the real intake. */
import { randomUUID } from "node:crypto";
import type { GatewayDevice } from "@prisma/client";
import { processGatewayEvents } from "./events";
import type { GatewayEventType } from "./call-state";

export type SimulateInput = { gatewayId: string; eventType: GatewayEventType; phoneNumber?: string; callId?: string; direction?: "INCOMING" | "OUTGOING"; durationSeconds?: number; answered?: boolean; at?: string };

export async function simulateGatewayEvent(device: GatewayDevice, input: SimulateInput) {
  const callId = input.callId ?? `sim-${randomUUID()}`;
  const event = { eventId: `sim-${randomUUID()}`, eventType: input.eventType, callId, phoneNumber: input.phoneNumber, direction: input.direction, timestamp: input.at ?? new Date().toISOString(), durationSeconds: input.durationSeconds, answered: input.answered, meta: { simulated: true } };
  const [ack] = await processGatewayEvents(device, [event], { simulated: true });
  return { callId, ack };
}
