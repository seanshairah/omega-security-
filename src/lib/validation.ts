import { z } from "zod";
import { normalisePhone, isValidPhone } from "@/lib/phone";
import { coordinatePairError } from "@/lib/site-config";
import { parseWelfareTimes } from "@/lib/welfare/welfare-rules";

export const phoneSchema = z.string().trim().min(6, "Phone number is required").transform((v) => normalisePhone(v)).refine(isValidPhone, "Enter a valid phone number, e.g. 0772 123 456");
/** Checkbox: present ("on") when ticked, absent when not. */
const flag = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());
const opt = (s: z.ZodString) => s.trim().optional().transform((v) => (v ? v : null));

export const guardSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  phone: phoneSchema,
  nationalId: z.string().trim().min(3, "National ID is required"),
  email: z.string().trim().email("Enter a valid email").toLowerCase().optional().or(z.literal("")).transform((v) => (v ? v : null)),
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
  // Phone and attendance
  phoneType: z.enum(["BASIC", "ANDROID", "OTHER", "UNKNOWN"]).default("UNKNOWN"),
  mobileOperator: z.enum(["ECONET", "NETONE", "TELECEL", "OTHER", "UNKNOWN"]).default("UNKNOWN"),
  alternatePhones: z.string().optional().transform((v, ctx) => {
    const out: string[] = [];
    for (const raw of (v ?? "").split(/[,;\n]/).map((x) => x.trim()).filter(Boolean)) {
      let p: string;
      try { p = normalisePhone(raw); } catch { p = ""; }
      if (!p || !isValidPhone(p)) { ctx.addIssue({ code: "custom", message: `"${raw}" is not a valid phone number` }); return z.NEVER; }
      if (!out.includes(p)) out.push(p);
    }
    return out;
  }),
  preferredAttendance: z.enum(["CALL", "SMS", "APP"]).default("SMS"),
  callAttendanceEnabled: flag,
  smsAttendanceEnabled: flag,
  welfareExempt: flag,
  assignedGatewayId: opt(z.string()),
  phoneVerified: flag,
  networkLocationEligible: flag,
  networkLocationConsent: flag,
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
  latitude: z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().min(-90).max(90).optional()).transform((v) => v ?? null),
  longitude: z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().min(-180).max(180).optional()).transform((v) => v ?? null),
  geofenceRadiusM: z.preprocess((v) => (v === "" || v == null ? 150 : Number(v)), z.number().int().min(20, "Radius must be at least 20 m").max(5000, "Radius must be at most 5000 m")),
  coordinatesSource: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.enum(["MAP", "MANUAL", "TEST", "BROWSER", "GUARD_DEVICE"]).optional()).transform((v) => v ?? null),
  placeId: opt(z.string()),
  clientUpdates: flag,
  clientUpdatePhone: opt(z.string()),
  notifyClientArrival: flag,
  notifyClientWelfare: flag,
  notifyClientCompletion: flag,
  notifyClientLate: flag,
  notifyClientAbsent: flag,
  notifyClientOutside: flag,
  notifyClientEmergency: flag,
  clientUpdateEmail: opt(z.string().email("Enter a valid email address")),
  defaultGatewayId: opt(z.string()),
  // Scheduled welfare checks. Neither times nor an interval: the single mid-shift welfare SMS.
  welfareTimes: opt(z.string()),
  welfareIntervalMinutes: z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().int().min(15, "Check at most every 15 minutes").max(720).optional()).transform((v) => v ?? null),
  welfareChannel: z.preprocess((v) => (v === "" || v == null ? "SMS" : v), z.enum(["SMS", "VOICE", "GATEWAY_CALL"])),
  welfareMaxAttempts: z.preprocess((v) => (v === "" || v == null ? 2 : Number(v)), z.number().int().min(1).max(5)),
  welfareRetryMinutes: z.preprocess((v) => (v === "" || v == null ? 10 : Number(v)), z.number().int().min(2).max(60)),
  welfareSmsFallback: flag,
  // Network duty area: its own radius, never the GPS geofence's.
  networkVerifyEnabled: flag,
  networkRadiusM: z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().int().min(50, "The network area must be at least 50 m").max(50000).optional()).transform((v) => v ?? null),
}).superRefine((d, ctx) => {
  if (d.networkVerifyEnabled && d.networkRadiusM == null) ctx.addIssue({ code: "custom", message: "Give the network duty area a radius, or turn network checks off for this site.", path: ["networkRadiusM"] });
  if (d.networkVerifyEnabled && (d.latitude == null || d.longitude == null)) ctx.addIssue({ code: "custom", message: "Network checks need the site's coordinates.", path: ["networkVerifyEnabled"] });
  const e = coordinatePairError(d.latitude, d.longitude);
  if (e) ctx.addIssue({ code: "custom", message: e, path: ["latitude"] });
  try { parseWelfareTimes(d.welfareTimes); } catch (err) { ctx.addIssue({ code: "custom", message: (err as Error).message, path: ["welfareTimes"] }); }
});

const optNum = (min: number, max: number) => z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().min(min).max(max).optional()).transform((v) => v ?? null);

/** Shift-level geofence override: a gate post or patrol area that differs from the site centre. */
const shiftGeofenceFields = {
  overrideGeofence: flag,
  geofenceLatitude: optNum(-90, 90),
  geofenceLongitude: optNum(-180, 180),
  geofenceRadiusM: z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().int().min(20, "Radius must be at least 20 m").max(5000, "Radius must be at most 5000 m").optional()).transform((v) => v ?? null),
  geofenceNote: opt(z.string()),
};
function refineShiftGeofence<T extends { overrideGeofence: boolean; geofenceLatitude: number | null; geofenceLongitude: number | null; geofenceRadiusM: number | null; geofenceNote: string | null }>(d: T, ctx: z.RefinementCtx) {
  if (!d.overrideGeofence) return;
  const e = coordinatePairError(d.geofenceLatitude, d.geofenceLongitude) ?? (d.geofenceLatitude == null ? "Place the shift geofence on the map or untick the override." : null);
  if (e) ctx.addIssue({ code: "custom", message: e, path: ["geofenceLatitude"] });
}
function clearUnusedOverride<T extends { overrideGeofence: boolean; geofenceLatitude: number | null; geofenceLongitude: number | null; geofenceRadiusM: number | null; geofenceNote: string | null }>(d: T): T {
  return d.overrideGeofence ? d : { ...d, geofenceLatitude: null, geofenceLongitude: null, geofenceRadiusM: null, geofenceNote: null };
}

export const shiftGeofenceSchema = z.object(shiftGeofenceFields).superRefine(refineShiftGeofence).transform(clearUnusedOverride);

export const shiftSchema = z.object({
  guardId: z.string().min(1, "Guard is required"),
  locationId: z.string().min(1, "Location is required"),
  supervisorId: opt(z.string()),
  date: z.string().min(10, "Date is required"),
  startTime: z.string().min(5, "Start time is required"),
  endTime: z.string().min(5, "End time is required"),
  instructions: opt(z.string()),
  notes: opt(z.string()),
  ...shiftGeofenceFields,
}).superRefine(refineShiftGeofence).transform(clearUnusedOverride);

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
