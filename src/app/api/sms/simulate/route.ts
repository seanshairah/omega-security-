import { db } from "@/lib/db";
import { guarded, json, error } from "@/lib/api";
import { processIncomingMessage } from "@/lib/sms/pipeline";
import { audit } from "@/lib/audit";
import { normalisePhone } from "@/lib/phone";

/** Demo: POST { guardId | phone, body } behaves exactly like the gateway delivering a reply. */
export const POST = guarded("ADMIN", async (req, _ctx, user) => {
  const b = (await req.json().catch(() => ({}))) as { guardId?: string; phone?: string; body?: string };
  if (!b.body?.trim()) return error("body is required");
  let phone = b.phone ? normalisePhone(b.phone) : undefined;
  if (!phone && b.guardId) phone = (await db.guard.findUnique({ where: { id: b.guardId } }))?.phone;
  if (!phone) return error("guardId or phone is required");
  await audit({ userId: user.id, actor: user.name, action: "SMS_SIMULATED", details: { phone, body: b.body } });
  const result = await processIncomingMessage({ from: phone, body: b.body, provider: "simulated" });
  return json(result);
});
