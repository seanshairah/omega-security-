import { db } from "@/lib/db";
import type { IncidentCategory, IncidentSource, Severity } from "@prisma/client";
import { audit } from "@/lib/audit";

export type CreateIncidentInput = {
  guardId: string;
  locationId: string;
  shiftId?: string | null;
  category: IncidentCategory;
  severity: Severity;
  description: string;
  source: IncidentSource;
  supervisorId?: string | null;
  occurredAt?: Date;
  actorUserId?: string | null;
  actorName?: string;
};

export async function nextIncidentNo(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await db.incident.count({ where: { incidentNo: { startsWith: `INC-${year}-` } } });
  return `INC-${year}-${String(count + 1).padStart(4, "0")}`;
}

export async function createIncident(input: CreateIncidentInput) {
  const incidentNo = await nextIncidentNo();
  const incident = await db.incident.create({
    data: {
      incidentNo,
      guardId: input.guardId,
      locationId: input.locationId,
      shiftId: input.shiftId ?? null,
      category: input.category,
      severity: input.severity,
      description: input.description,
      source: input.source,
      supervisorId: input.supervisorId ?? null,
      occurredAt: input.occurredAt ?? new Date(),
    },
  });
  await audit({ userId: input.actorUserId, actor: input.actorName ?? "system", action: "INCIDENT_CREATED", entity: "Incident", entityId: incident.id, details: { incidentNo, category: input.category, severity: input.severity } });
  return incident;
}

export const CATEGORY_LABEL: Record<IncidentCategory, string> = {
  THEFT: "Theft",
  UNAUTHORIZED_ACCESS: "Unauthorised access",
  MEDICAL_EMERGENCY: "Medical emergency",
  FIRE: "Fire",
  VIOLENCE: "Violence",
  EQUIPMENT_PROBLEM: "Equipment problem",
  SUSPICIOUS_ACTIVITY: "Suspicious activity",
  ASSISTANCE_REQUEST: "Assistance request",
  EMERGENCY: "Emergency",
  OTHER: "Other",
};

export const sevTone = (s: string) => (s === "CRITICAL" || s === "HIGH" ? "critical" : s === "MEDIUM" ? "warn" : "neutral") as "critical" | "warn" | "neutral";
export const statusTone = (s: string) => (s === "OPEN" ? "critical" : s === "ACKNOWLEDGED" ? "warn" : "ok") as "critical" | "warn" | "ok";
