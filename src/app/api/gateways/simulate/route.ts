import { db } from "@/lib/db";
import { guarded, json, error } from "@/lib/api";
import { simulatorEnabled } from "@/lib/env-check";
import { audit } from "@/lib/audit";
import { simulateGatewayEvent, type SimulateInput } from "@/lib/gateway/simulate";

/** Demo: POST { gatewayId, eventType, phoneNumber?, callId?, direction?, durationSeconds? } behaves exactly like the phone posting the event. */
export const POST = guarded("ADMIN", async (req, _ctx, user) => {
  if (!simulatorEnabled()) return error("The simulator is disabled in this environment (SIMULATOR_ENABLED).", 403);
  const b = (await req.json().catch(() => ({}))) as Partial<SimulateInput>;
  if (!b.gatewayId || !b.eventType) return error("gatewayId and eventType are required");
  const device = await db.gatewayDevice.findUnique({ where: { id: b.gatewayId } });
  if (!device) return error("Gateway not found", 404);
  await audit({ userId: user.id, actor: user.name, action: "GATEWAY_EVENT_SIMULATED", entity: "GatewayDevice", entityId: device.id, details: { eventType: b.eventType, phoneNumber: b.phoneNumber ?? null } });
  return json(await simulateGatewayEvent(device, b as SimulateInput));
});
