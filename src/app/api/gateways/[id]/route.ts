import { db } from "@/lib/db";
import { guarded, json, error } from "@/lib/api";
import { effectiveStatus, gatewayInclude, setGatewayDisabled, updateGateway } from "@/lib/gateway/service";
import { getSettingNumber } from "@/lib/settings";

type Ctx = { params: Promise<{ id: string }> };

export const GET = guarded<Ctx>("SUPERVISOR", async (_req, ctx) => {
  const { id } = await ctx.params;
  const [g, offlineMinutes] = await Promise.all([db.gatewayDevice.findUnique({ where: { id }, include: { ...gatewayInclude, callLogs: { orderBy: { startedAt: "desc" }, take: 20, include: { guard: { select: { id: true, firstName: true, lastName: true } } } } } }), getSettingNumber("gateway.offlineMinutes")]);
  if (!g) return error("Gateway not found", 404);
  return json({ ...g, tokenHash: undefined, status: effectiveStatus(g, offlineMinutes) });
});

export const PATCH = guarded<Ctx>("ADMIN", async (req, ctx, user) => {
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const actor = { userId: user.id, name: user.name };
  if (typeof b.disabled === "boolean") await setGatewayDisabled(id, b.disabled, actor);
  const g = await updateGateway(id, { deviceName: typeof b.deviceName === "string" ? b.deviceName : undefined, phoneNumber: typeof b.phoneNumber === "string" ? b.phoneNumber : undefined, locationId: b.locationId === null || typeof b.locationId === "string" ? (b.locationId as string | null) : undefined, notes: typeof b.notes === "string" ? b.notes : undefined }, actor);
  return json({ ...g, tokenHash: undefined });
});
