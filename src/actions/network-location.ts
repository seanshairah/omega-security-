"use server";

import { revalidatePath } from "next/cache";
import { actor } from "./_helpers";
import { db } from "@/lib/db";
import { requestNetworkVerification } from "@/lib/network-location/service";

/**
 * An operations admin asks the guard's network where their phone is, for one shift. The router
 * still applies consent, the shift window, cooldown and caps; a refusal comes back as the reason.
 */
export async function requestNetworkCheck(shiftId: string) {
  const user = await actor("ADMIN");
  const s = await db.shift.findUniqueOrThrow({ where: { id: shiftId }, select: { guardId: true } });
  const r = await requestNetworkVerification({ guardId: s.guardId, shiftId, trigger: "MANUAL", actor: { userId: user.id, name: user.name } });
  revalidatePath(`/shifts/${shiftId}`);
  if (r.method === "SKIP" || r.method === "GPS") throw new Error(r.reason ?? "No check was made.");
}
