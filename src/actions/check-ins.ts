"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { decide, requestFix } from "@/lib/attendance/check-in-service";
import { actor } from "./_helpers";

/** A supervisor resolves a check-in exception. The reason is required and is audited. */
export async function decideCheckIn(id: string, decision: "APPROVE" | "REJECT", reason: string) {
  const user = await actor("SUPERVISOR");
  await decide(id, decision, { userId: user.id, name: user.name }, reason);
  revalidatePath("/attendance/check-ins");
  revalidatePath("/attendance");
}

/** Ask the guard's phone for another fix against an open check-in. */
export async function retryCheckInFix(id: string) {
  await actor("SUPERVISOR");
  const row = await db.attendanceCheckIn.findUniqueOrThrow({ where: { id } });
  const shift = await db.shift.findUniqueOrThrow({ where: { id: row.shiftId }, include: { guard: true, location: true, attendance: true, attendanceCheckIn: true, supervisor: true } });
  await requestFix(id, shift);
  revalidatePath("/attendance/check-ins");
}
