/** Types and labels of the guard activity feed. Pure: safe to import from client components. */
export type ActivityCategory = "device" | "gps" | "geofence" | "shift" | "alert" | "sms" | "call" | "request";
export type ActivitySeverity = "info" | "success" | "warning" | "critical";
export type ActivityItem = { id: string; at: string; category: ActivityCategory; severity: ActivitySeverity; title: string; detail?: string; href?: string; late?: boolean };

export const ACTIVITY_CATEGORIES: { key: ActivityCategory; label: string }[] = [
  { key: "alert", label: "Alerts" }, { key: "geofence", label: "Geofence" }, { key: "gps", label: "GPS" }, { key: "request", label: "GPS requests" },
  { key: "shift", label: "Shift" }, { key: "sms", label: "SMS" }, { key: "call", label: "Calls" }, { key: "device", label: "Device" },
];
