"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import type { MessageChannel } from "@prisma/client";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { sendToRecipients, type Recipient, type SendOutcome } from "@/lib/messaging";
import { ON_SITE_STATUSES, LIVE_STATUSES } from "@/lib/services/shifts";
import { audit } from "@/lib/audit";

export type Audience =
  | { kind: "guards"; ids: string[] }
  | { kind: "onDuty" }
  | { kind: "live" }
  | { kind: "location"; locationId: string }
  | { kind: "allGuards" }
  | { kind: "watched" }
  | { kind: "staff" };

export async function resolveAudience(a: Audience): Promise<Recipient[]> {
  const g = (rows: { id: string; firstName: string; lastName: string; phone: string; email: string | null }[]) => rows.map((r) => ({ guardId: r.id, name: `${r.firstName} ${r.lastName}`, phone: r.phone, email: r.email }));
  switch (a.kind) {
    case "guards": return g(await db.guard.findMany({ where: { id: { in: a.ids } } }));
    case "onDuty": return g((await db.shift.findMany({ where: { status: { in: ON_SITE_STATUSES } }, include: { guard: true }, distinct: ["guardId"] })).map((s) => s.guard));
    case "live": return g((await db.shift.findMany({ where: { status: { in: LIVE_STATUSES } }, include: { guard: true }, distinct: ["guardId"] })).map((s) => s.guard));
    case "location": return g((await db.shift.findMany({ where: { locationId: a.locationId, status: { in: LIVE_STATUSES } }, include: { guard: true }, distinct: ["guardId"] })).map((s) => s.guard));
    case "allGuards": return g(await db.guard.findMany({ where: { active: true, employmentStatus: "ACTIVE" } }));
    case "watched": return g(await db.guard.findMany({ where: { watched: true, active: true } }));
    case "staff": return (await db.user.findMany({ where: { active: true } })).map((u) => ({ userId: u.id, name: u.name, phone: u.phone, email: u.email }));
  }
}

export async function sendMessages(input: { channel: MessageChannel; audience: Audience; body: string; subject?: string }): Promise<{ ok: boolean; error?: string; results?: SendOutcome[] }> {
  const user = await getSessionUser();
  if (!can.sendSms(user)) return { ok: false, error: "Not permitted." };
  const body = input.body.trim();
  if (!body) return { ok: false, error: "Write a message first." };
  if (input.channel === "EMAIL" && !input.subject?.trim()) return { ok: false, error: "Email needs a subject." };
  const recipients = await resolveAudience(input.audience);
  if (recipients.length === 0) return { ok: false, error: "No recipients match that audience." };
  if (recipients.length > 200) return { ok: false, error: "That is more than 200 recipients. Narrow the audience." };
  const results = await sendToRecipients({ channel: input.channel, recipients, body, subject: input.subject?.trim(), actor: { id: user!.id, name: user!.name } });
  await audit({ userId: user!.id, actor: user!.name, action: "BROADCAST_SENT", details: { channel: input.channel, audience: input.audience.kind, recipients: recipients.length, sent: results.filter((r) => r.ok).length } });
  revalidatePath("/sms");
  return { ok: true, results };
}

export async function setGuardWatched(guardId: string, watched: boolean, note?: string) {
  const user = await getSessionUser();
  if (!can.manageGuards(user)) throw new Error("Not permitted.");
  const g = await db.guard.update({ where: { id: guardId }, data: { watched, watchedAt: watched ? new Date() : null, watchedById: watched ? user!.id : null, watchNote: watched ? note?.trim() || null : null } });
  await audit({ userId: user!.id, actor: user!.name, action: watched ? "GUARD_WATCH_ON" : "GUARD_WATCH_OFF", entity: "Guard", entityId: guardId, details: { name: `${g.firstName} ${g.lastName}`, note } });
  revalidatePath("/", "layout");
}
