import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { getSessionUser, type SessionUser } from "./session";

export const ROLE_LABEL: Record<Role, string> = {
  SUPER_ADMIN: "Super admin",
  ADMIN: "Operations admin",
  SUPERVISOR: "Supervisor",
};

const RANK: Record<Role, number> = { SUPERVISOR: 1, ADMIN: 2, SUPER_ADMIN: 3 };

export function hasRole(user: SessionUser | null, minimum: Role): boolean {
  if (!user) return false;
  return RANK[user.role] >= RANK[minimum];
}

/** Capabilities, so pages and routes never compare role strings directly. */
export const can = {
  manageUsers: (u: SessionUser | null) => hasRole(u, "SUPER_ADMIN"),
  configureSystem: (u: SessionUser | null) => hasRole(u, "SUPER_ADMIN"),
  viewAudit: (u: SessionUser | null) => hasRole(u, "SUPER_ADMIN"),
  manageGuards: (u: SessionUser | null) => hasRole(u, "ADMIN"),
  manageLocations: (u: SessionUser | null) => hasRole(u, "ADMIN"),
  manageShifts: (u: SessionUser | null) => hasRole(u, "ADMIN"),
  manageIncidents: (u: SessionUser | null) => hasRole(u, "SUPERVISOR"),
  sendSms: (u: SessionUser | null) => hasRole(u, "ADMIN"),
  simulate: (u: SessionUser | null) => hasRole(u, "ADMIN"),
  viewReports: (u: SessionUser | null) => hasRole(u, "SUPERVISOR"),
};

/** For pages: redirect to login if unauthenticated, to dashboard if under-privileged. */
export async function requireUser(minimum: Role = "SUPERVISOR"): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!hasRole(user, minimum)) redirect("/dashboard?denied=1");
  return user;
}

/** For route handlers: returns the user or null; caller responds 401/403. */
export async function apiUser(minimum: Role = "SUPERVISOR"): Promise<{ user: SessionUser | null; status: 200 | 401 | 403 }> {
  const user = await getSessionUser();
  if (!user) return { user: null, status: 401 };
  if (!hasRole(user, minimum)) return { user, status: 403 };
  return { user, status: 200 };
}
