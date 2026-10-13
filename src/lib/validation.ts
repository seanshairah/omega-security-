import { z } from "zod";
import { normalisePhone, isValidPhone } from "@/lib/phone";

export const phoneSchema = z.string().trim().min(6, "Phone number is required").transform((v) => normalisePhone(v)).refine(isValidPhone, "Enter a valid phone number, e.g. 0772 123 456");
const opt = (s: z.ZodString) => s.trim().optional().transform((v) => (v ? v : null));

export const guardSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  phone: phoneSchema,
  nationalId: z.string().trim().min(3, "National ID is required"),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]),
  dateOfBirth: opt(z.string()),
  address: opt(z.string()),
  emergencyContactName: opt(z.string()),
  emergencyContactPhone: opt(z.string()),
  employmentStatus: z.enum(["ACTIVE", "ON_LEAVE", "SUSPENDED", "INACTIVE"]),
  dateEmployed: opt(z.string()),
  supervisorId: opt(z.string()),
  homeLocationId: opt(z.string()),
  notes: opt(z.string()),
});

export const clientSchema = z.object({
  code: z.string().trim().min(2, "Code is required").toUpperCase(),
  name: z.string().trim().min(2, "Name is required"),
  industry: opt(z.string()),
  contactName: opt(z.string()),
  contactPhone: opt(z.string()),
  contactEmail: opt(z.string()),
  address: opt(z.string()),
  notes: opt(z.string()),
});

export const locationSchema = z.object({
  code: z.string().trim().min(2, "Site code is required").toUpperCase(),
  name: z.string().trim().min(2, "Site name is required"),
  clientId: z.string().min(1, "Client is required"),
  siteType: opt(z.string()),
  address: z.string().trim().min(2, "Address is required"),
  contactName: opt(z.string()),
  contactPhone: opt(z.string()),
  requiredGuards: z.coerce.number().int().min(1).max(50),
  shiftPattern: z.enum(["DAY_8", "NIGHT_8", "DAY_12", "NIGHT_12", "CUSTOM"]),
  supervisorId: opt(z.string()),
  specialInstructions: opt(z.string()),
});

export const shiftSchema = z.object({
  guardId: z.string().min(1, "Guard is required"),
  locationId: z.string().min(1, "Location is required"),
  supervisorId: opt(z.string()),
  date: z.string().min(10, "Date is required"),
  startTime: z.string().min(5, "Start time is required"),
  endTime: z.string().min(5, "End time is required"),
  instructions: opt(z.string()),
  notes: opt(z.string()),
});

export const recurrenceSchema = z.object({
  guardId: z.string().min(1, "Guard is required"),
  locationId: z.string().min(1, "Location is required"),
  supervisorId: opt(z.string()),
  daysOfWeek: z.array(z.coerce.number().int().min(0).max(6)).min(1, "Pick at least one day"),
  startTime: z.string().min(5),
  endTime: z.string().min(5),
  startsOn: z.string().min(10, "Start date is required"),
  endsOn: opt(z.string()),
  instructions: opt(z.string()),
});

export const incidentSchema = z.object({
  guardId: z.string().min(1, "Guard is required"),
  locationId: z.string().min(1, "Location is required"),
  shiftId: opt(z.string()),
  category: z.enum(["THEFT", "UNAUTHORIZED_ACCESS", "MEDICAL_EMERGENCY", "FIRE", "VIOLENCE", "EQUIPMENT_PROBLEM", "SUSPICIOUS_ACTIVITY", "ASSISTANCE_REQUEST", "EMERGENCY", "OTHER"]),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  description: z.string().trim().min(5, "Describe what happened"),
  occurredAt: opt(z.string()),
  supervisorId: opt(z.string()),
});

export const userSchema = z.object({
  name: z.string().trim().min(2, "Name is required"),
  email: z.string().trim().email("Enter a valid email").toLowerCase(),
  role: z.enum(["SUPER_ADMIN", "ADMIN", "SUPERVISOR"]),
  title: opt(z.string()),
  phone: opt(z.string()),
  password: z.string().min(8, "Password must be at least 8 characters").optional().or(z.literal("")),
});

export function formToObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.endsWith("[]")) {
      const key = k.slice(0, -2);
      if (Array.isArray(out[key])) (out[key] as unknown[]).push(v);
      else out[key] = [v];
    } else out[k] = v;
  }
  return out;
}

export function firstIssue(err: z.ZodError): string {
  const i = err.issues[0];
  return i ? `${i.message}` : "Invalid input";
}
