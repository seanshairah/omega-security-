"use server";

import { revalidatePath } from "next/cache";
import { actor } from "./_helpers";
import { decideEvidence } from "@/lib/attendance/call-attendance";
import { db } from "@/lib/db";

/** Confirm or reject a pending (or provisional) attendance record. Operations admins only; audited. */
export async function decideAttendanceEvidence(id: string, approve: boolean, note?: string) {
  const user = await actor("ADMIN");
  await decideEvidence(id, approve, { id: user.id, name: user.name }, note);
  const e = await db.attendanceEvidence.findUnique({ where: { id }, select: { shiftId: true, guardId: true } });
  if (e) { revalidatePath(`/shifts/${e.shiftId}`); revalidatePath(`/guards/${e.guardId}`); }
}
