import { db } from "@/lib/db";

export type SettingDef = {
  key: string;
  label: string;
  description: string;
  group: "arrival" | "welfare" | "completion" | "handover" | "recurrence" | "general";
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
  { key: "general.companyName", label: "Company name", description: "Shown in the portal and in message signatures.", group: "general", default: "Omega Security", type: "text" },
  { key: "general.smsSignature", label: "SMS signature", description: "Appended to every outbound message. Leave blank for none.", group: "general", default: "- Omega Security", type: "text" },
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
