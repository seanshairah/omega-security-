import { db } from "@/lib/db";

export type SettingDef = {
  key: string;
  label: string;
  description: string;
  group: "arrival" | "welfare" | "completion" | "handover" | "recurrence" | "general" | "gateway" | "geofence" | "checkin";
  default: string;
  type: "number" | "text" | "boolean";
};

export const SETTING_DEFS: SettingDef[] = [
  { key: "arrival.sendOffsetMinutes", label: "Arrival check lead time", description: "Minutes before shift start to send the arrival check. 0 sends it at the start time.", group: "arrival", default: "0", type: "number" },
  { key: "arrival.graceMinutes", label: "Arrival grace period", description: "Minutes to wait for a reply before sending the arrival reminder.", group: "arrival", default: "15", type: "number" },
  { key: "arrival.escalationMinutes", label: "Arrival escalation", description: "Minutes after the reminder before the shift is marked Not confirmed and the supervisor is notified.", group: "arrival", default: "15", type: "number" },
  { key: "welfare.offsetPercent", label: "Welfare check point", description: "Where in the shift the welfare check is sent, as a percentage of the duration. 50 is the midpoint.", group: "welfare", default: "50", type: "number" },
  { key: "welfare.responseMinutes", label: "Welfare response window", description: "Minutes to wait for a reply before recording a missed welfare check.", group: "welfare", default: "20", type: "number" },
  { key: "completion.responseMinutes", label: "Completion response window", description: "Minutes after the shift end to wait for confirmation before closing the shift as unconfirmed.", group: "completion", default: "30", type: "number" },
  { key: "handover.notifyMinutes", label: "Handover notice", description: "Minutes before a relieving shift starts to tell both guards about the handover.", group: "handover", default: "30", type: "number" },
  { key: "recurrence.horizonDays", label: "Recurring shift horizon", description: "How many days ahead recurring shifts are created.", group: "recurrence", default: "14", type: "number" },
  { key: "general.companyName", label: "Company name", description: "Shown in the portal and in message signatures.", group: "general", default: "Omega Protection Services", type: "text" },
  { key: "general.controlRoomPhone", label: "Control room phone", description: "Quoted in client messages so the client knows who to call.", group: "general", default: "+263 772 100 100", type: "text" },
  // Android call gateway
  { key: "gateway.heartbeatSeconds", label: "Heartbeat interval", description: "Seconds between heartbeats from each gateway phone. Sent to the phone on activation and on every heartbeat.", group: "gateway", default: "120", type: "number" },
  { key: "gateway.commandPollSeconds", label: "Command poll interval", description: "Seconds between a guard phone's checks for operations commands (location requests) while online. 15–300. Shorter means faster answers and more battery/data.", group: "gateway", default: "30", type: "number" },
  { key: "gateway.offlineMinutes", label: "Offline threshold", description: "Minutes without a heartbeat before a gateway is shown as offline and a warning is raised.", group: "gateway", default: "5", type: "number" },
  { key: "gateway.callRetentionDays", label: "Call retention", description: "Days to keep call records. Older records are removed by the automation engine. 0 keeps everything.", group: "gateway", default: "365", type: "number" },
  { key: "gateway.unknownCallerAlert", label: "Alert on unknown callers", description: "Raise a notification when a number that is not a registered guard calls a gateway.", group: "gateway", default: "true", type: "boolean" },
  { key: "gateway.missedCallAlert", label: "Alert on missed calls", description: "Raise a notification when a guard's call to a gateway goes unanswered. Calls from guards on duty are always critical.", group: "gateway", default: "true", type: "boolean" },
  // GPS verification and geofencing (guard devices)
  { key: "checkin.enabled", label: "Call check-in", description: "Expect a check-in call at the start of every shift, and verify it with a fresh GPS fix from the guard's phone.", group: "checkin", default: "true", type: "boolean" },
  { key: "checkin.graceMinutes", label: "Check-in grace period", description: "Minutes after the scheduled start that still count as on time. A site or a single shift can override this.", group: "checkin", default: "5", type: "number" },
  { key: "checkin.windowBeforeMinutes", label: "Check-in window opens", description: "Minutes before the scheduled start that a check-in call already counts.", group: "checkin", default: "60", type: "number" },
  { key: "checkin.windowAfterMinutes", label: "Check-in window closes", description: "Minutes after the scheduled start that a call still counts as the check-in.", group: "checkin", default: "120", type: "number" },
  { key: "checkin.correlationMinutes", label: "Call to fix window", description: "Minutes after the check-in call within which a GPS fix still counts as evidence of that arrival.", group: "checkin", default: "10", type: "number" },
  { key: "checkin.escalationMinutes", label: "Check-in escalation", description: "Minutes after the grace period before an unverified check-in is raised to the supervisor as missed.", group: "checkin", default: "15", type: "number" },
  { key: "checkin.maxGpsAttempts", label: "GPS attempts per check-in", description: "How many times the system asks the phone for a fix before giving up and raising an exception.", group: "checkin", default: "3", type: "number" },
  { key: "checkin.numbers", label: "Authorised check-in numbers", description: "Comma-separated numbers a guard may call to check in. Blank accepts a call to any registered operations gateway phone.", group: "checkin", default: "", type: "text" },
  { key: "checkin.autoGps", label: "Automatic GPS check-in", description: "Check the guard's phone position at shift start without waiting for a call: from 10 minutes before, at the start, and at the end of the grace period.", group: "checkin", default: "true", type: "boolean" },
  { key: "checkin.autoBeforeMinutes", label: "Automatic check starts", description: "Minutes before the scheduled start that a position from the guard's phone already counts as arrival.", group: "checkin", default: "10", type: "number" },
  { key: "checkin.callRequired", label: "Check-in call required", description: "Also require the guard to ring in. When on, a guard verified on site by GPS without a call is shown as 'call outstanding', not absent.", group: "checkin", default: "false", type: "boolean" },
  { key: "checkin.maxClockSkewMinutes", label: "Accepted clock skew", description: "Minutes a guard phone's clock may differ from the server before its timestamps are replaced by the server's.", group: "checkin", default: "10", type: "number" },
  { key: "geofence.checkMinutes", label: "Location check interval", description: "Minutes between location checks during a shift when the guard is inside the site.", group: "geofence", default: "10", type: "number" },
  { key: "geofence.verifySeconds", label: "Exit verification delay", description: "Seconds to wait before a second reading confirms that a guard has left the site.", group: "geofence", default: "60", type: "number" },
  { key: "geofence.outsideCheckMinutes", label: "Check interval while outside", description: "Minutes between location updates while a guard is outside the site.", group: "geofence", default: "3", type: "number" },
  { key: "geofence.escalationMinutes", label: "Extended absence escalation", description: "Minutes outside the site before the alert is raised to critical.", group: "geofence", default: "10", type: "number" },
  { key: "geofence.accuracyMaxM", label: "Worst usable GPS accuracy", description: "Metres. Fixes less accurate than this count as location unavailable, never as outside.", group: "geofence", default: "100", type: "number" },
  { key: "geofence.overdueIntervals", label: "Overdue after", description: "Number of missed check intervals before a monitored shift is flagged as location verification overdue.", group: "geofence", default: "2", type: "number" },
  { key: "location.requestTtlSeconds", label: "Location request deadline", description: "Seconds a \"request current location\" waits for the phone before it expires. 60–600.", group: "geofence", default: "180", type: "number" },
  { key: "geofence.locationRetentionDays", label: "Location event retention", description: "Days to keep location events. 0 keeps everything.", group: "geofence", default: "180", type: "number" },
  { key: "general.smsSignature", label: "SMS signature", description: "Appended to every outbound message. Leave blank for none.", group: "general", default: "- Omega Protection Services", type: "text" },
];

export type Settings = Record<string, string>;

let cache: { at: number; values: Settings } | null = null;

export async function getSettings(): Promise<Settings> {
  if (cache && Date.now() - cache.at < 15_000) return cache.values;
  const rows = await db.setting.findMany();
  const values: Settings = {};
  for (const def of SETTING_DEFS) values[def.key] = def.default;
  for (const row of rows) values[row.key] = row.value;
  cache = { at: Date.now(), values };
  return values;
}

export async function getSettingBool(key: string): Promise<boolean> {
  const s = await getSettings();
  return (s[key] ?? SETTING_DEFS.find((d) => d.key === key)?.default ?? "false") === "true";
}

export async function getSettingNumber(key: string): Promise<number> {
  const s = await getSettings();
  const n = Number(s[key]);
  return Number.isFinite(n) ? n : Number(SETTING_DEFS.find((d) => d.key === key)?.default ?? 0);
}

export async function saveSettings(values: Record<string, string>) {
  for (const def of SETTING_DEFS) {
    if (!(def.key in values)) continue;
    await db.setting.upsert({
      where: { key: def.key },
      update: { value: values[def.key] },
      create: { key: def.key, value: values[def.key], label: def.label, description: def.description, group: def.group },
    });
  }
  cache = null;
}

export function invalidateSettingsCache() {
  cache = null;
}
