"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { incidentSchema, formToObject, firstIssue } from "@/lib/validation";
import { createIncident as createIncidentRecord } from "@/lib/services/incidents";
import { recordEvent } from "@/lib/services/shifts";
import { actor, auditAs, fail, type ActionState } from "./_helpers";

export async function createIncident(_: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const user = await actor("SUPERVISOR");
    const r = incidentSchema.safeParse(formToObject(fd));
    if (!r.success) return { error: firstIssue(r.error) };
    const d = r.data;
    const inc = await createIncidentRecord({ ...d, source: "ADMIN", occurredAt: d.occurredAt ? new Date(d.occurredAt) : new Date(), actorUserId: user.id, actorName: user.name });
    if (d.shiftId) await recordEvent(d.shiftId, d.guardId, "INCIDENT_REPORTED", { source: "ADMIN", note: `${inc.incidentNo} logged by ${user.name}: ${d.description}` });
    id = inc.id;
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/incidents");
  redirect(`/incidents/${id}`);
}

export async function acknowledgeIncident(id: string) {
  const user = await actor("SUPERVISOR");
  const inc = await db.incident.update({ where: { id }, data: { status: "ACKNOWLEDGED", acknowledgedAt: new Date(), supervisorId: user.id } });
  await auditAs(user, "INCIDENT_ACKNOWLEDGED", "Incident", id, { incidentNo: inc.incidentNo });
  revalidatePath(`/incidents/${id}`);
  revalidatePath("/", "layout");
}

export async function resolveIncident(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await actor("SUPERVISOR");
    const notes = String(fd.get("resolutionNotes") ?? "").trim();
    if (notes.length < 5) return { error: "Add a short resolution note." };
    const inc = await db.incident.update({ where: { id }, data: { status: "RESOLVED", resolutionNotes: notes, resolvedAt: new Date(), supervisorId: user.id } });
    // Return the shift to a calm state if nothing else is open on it.
    if (inc.shiftId) {
      const stillOpen = await db.incident.count({ where: { shiftId: inc.shiftId, status: { in: ["OPEN", "ACKNOWLEDGED"] } } });
      const shift = await db.shift.findUnique({ where: { id: inc.shiftId } });
      if (shift && stillOpen === 0 && ["INCIDENT", "ASSISTANCE", "CRITICAL"].includes(shift.status) && shift.endAt > new Date()) {
        await db.shift.update({ where: { id: shift.id }, data: { status: "ON_DUTY" } });
        await recordEvent(shift.id, shift.guardId, "ADMIN_NOTE", { source: "ADMIN", note: `${inc.incidentNo} resolved by ${user.name}. Shift returned to on duty.` });
      }
    }
    await auditAs(user, "INCIDENT_RESOLVED", "Incident", id, { incidentNo: inc.incidentNo });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/incidents");
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Super admin only: text the client about an incident at their site. The message is reviewed before sending. */
export async function closeIncident(id: string) {
  const user = await actor("ADMIN");
  const inc = await db.incident.update({ where: { id }, data: { status: "CLOSED" } });
  await auditAs(user, "INCIDENT_CLOSED", "Incident", id, { incidentNo: inc.incidentNo });
  revalidatePath(`/incidents/${id}`);
}
