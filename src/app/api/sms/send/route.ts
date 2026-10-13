import { db } from "@/lib/db";
import { guarded, json, error } from "@/lib/api";
import { sendSms } from "@/lib/sms/outbound";

export const POST = guarded("ADMIN", async (req, _ctx, user) => {
  const b = (await req.json().catch(() => ({}))) as { guardId?: string; body?: string };
  if (!b.guardId || !b.body?.trim()) return error("guardId and body are required");
  const guard = await db.guard.findUnique({ where: { id: b.guardId } });
  if (!guard) return error("Guard not found", 404);
  const msg = await sendSms({ to: guard.phone, body: b.body.trim(), type: "GENERAL", guardId: guard.id, actor: user.name, userId: user.id });
  return json(msg, msg.status === "FAILED" ? 502 : 201);
});
