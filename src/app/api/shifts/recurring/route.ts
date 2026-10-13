import { db } from "@/lib/db";
import { guarded, json, error } from "@/lib/api";
import { recurrenceSchema, firstIssue } from "@/lib/validation";
import { materialiseRecurrences } from "@/lib/services/shifts";
import { getSettingNumber } from "@/lib/settings";
import { audit } from "@/lib/audit";

export const GET = guarded("SUPERVISOR", async () => json({ items: await db.shiftRecurrence.findMany({ include: { guard: true, location: true }, orderBy: { createdAt: "desc" } }) }));

export const POST = guarded("ADMIN", async (req, _ctx, user) => {
  const r = recurrenceSchema.safeParse(await req.json().catch(() => ({})));
  if (!r.success) return error(firstIssue(r.error));
  const d = r.data;
  const rec = await db.shiftRecurrence.create({ data: { guardId: d.guardId, locationId: d.locationId, supervisorId: d.supervisorId, daysOfWeek: d.daysOfWeek, startTime: d.startTime, endTime: d.endTime, startsOn: new Date(d.startsOn), endsOn: d.endsOn ? new Date(d.endsOn) : null, instructions: d.instructions } });
  await audit({ userId: user.id, actor: user.name, action: "RECURRENCE_CREATED", entity: "ShiftRecurrence", entityId: rec.id });
  const created = await materialiseRecurrences(await getSettingNumber("recurrence.horizonDays"));
  return json({ recurrence: rec, shiftsCreated: created }, 201);
});
