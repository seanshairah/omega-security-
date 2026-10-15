import { db } from "@/lib/db";
import { guarded, json, error } from "@/lib/api";
import { createGateway, effectiveStatus, gatewayInclude } from "@/lib/gateway/service";
import { getSettingNumber } from "@/lib/settings";

export const GET = guarded("SUPERVISOR", async () => {
  const [items, offlineMinutes] = await Promise.all([db.gatewayDevice.findMany({ include: gatewayInclude, orderBy: { deviceName: "asc" } }), getSettingNumber("gateway.offlineMinutes")]);
  return json({ items: items.map((g) => ({ ...g, tokenHash: undefined, activationCode: undefined, status: effectiveStatus(g, offlineMinutes) })) });
});

export const POST = guarded("ADMIN", async (req, _ctx, user) => {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof b.deviceName !== "string" || b.deviceName.trim().length < 2) return error("deviceName is required");
  if (typeof b.phoneNumber !== "string") return error("phoneNumber is required");
  const g = await createGateway({ deviceName: b.deviceName, phoneNumber: b.phoneNumber, locationId: typeof b.locationId === "string" ? b.locationId : null, notes: typeof b.notes === "string" ? b.notes : null, actor: { userId: user.id, name: user.name } });
  return json({ ...g, tokenHash: undefined }, 201);
});
