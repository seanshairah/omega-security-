import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export type AuditInput = {
  userId?: string | null;
  actor?: string;
  action: string;
  entity?: string;
  entityId?: string;
  details?: Prisma.InputJsonValue;
  ip?: string | null;
  userAgent?: string | null;
};

export async function audit(input: AuditInput) {
  try {
    await db.auditLog.create({
      data: {
        userId: input.userId ?? null,
        actor: input.actor ?? (input.userId ? "user" : "system"),
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        details: input.details,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  } catch (err) {
    console.error("audit log failed", err);
  }
}
