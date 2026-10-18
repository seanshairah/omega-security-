"use server";

import { revalidatePath } from "next/cache";
import { acknowledgeAlert as ack, resolveAlert as resolve } from "@/lib/gateway/alerts";
import { actor } from "./_helpers";

/** Operations acknowledges a guard's alert: the guard's phone shows who and when on its next heartbeat. */
export async function acknowledgeAlert(id: string, note?: string) {
  const user = await actor("SUPERVISOR");
  await ack(id, { userId: user.id, name: user.name }, note);
  revalidatePath("/alerts");
  revalidatePath("/dashboard");
}

export async function resolveAlert(id: string, note?: string) {
  const user = await actor("SUPERVISOR");
  await resolve(id, { userId: user.id, name: user.name }, note);
  revalidatePath("/alerts");
  revalidatePath("/dashboard");
}
