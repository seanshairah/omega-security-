import { headers } from "next/headers";
import type { Role } from "@prisma/client";
import { getSessionUser, type SessionUser } from "@/lib/auth/session";
import { hasRole } from "@/lib/auth/rbac";
import { audit as writeAudit } from "@/lib/audit";

export type ActionState = { error?: string; ok?: boolean } | undefined;

export async function actor(minimum: Role = "ADMIN"): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user || !hasRole(user, minimum)) throw new Error("You do not have permission to do that.");
  return user;
}

export async function auditAs(user: SessionUser, action: string, entity: string, entityId?: string, details?: Record<string, unknown>) {
  const h = await headers();
  await writeAudit({ userId: user.id, actor: user.name, action, entity, entityId, details: details as never, ip: h.get("x-forwarded-for") ?? h.get("x-real-ip"), userAgent: h.get("user-agent") });
}

export function fail(e: unknown): ActionState {
  const msg = e instanceof Error ? e.message : "Something went wrong.";
  if (/Unique constraint/.test(msg)) return { error: "A record with that phone number, ID or code already exists." };
  return { error: msg };
}
