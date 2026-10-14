import { db } from "@/lib/db";

export type TemplateDef = { key: string; name: string; description: string; body: string; variables: string[] };

const V = ["guard_name", "location", "start_time", "end_time", "supervisor_name", "date", "company"];
/** Variables for messages to clients. */
const CV = ["company", "client_name", "site", "guard_name", "start_time", "end_time", "time", "date", "control_phone"];

export const TEMPLATE_DEFS: TemplateDef[] = [
  { key: "ARRIVAL", name: "Arrival check", description: "Sent at shift start.", variables: V,
    body: "SECURITY ALERT: {{guard_name}}, you are scheduled for duty at {{location}} today from {{start_time}} to {{end_time}}. Have you arrived and taken over your post? Reply YES to confirm or NO if you have not arrived." },
  { key: "ARRIVAL_REMINDER", name: "Arrival reminder", description: "Sent after the grace period with no reply.", variables: V,
    body: "REMINDER: You have not yet confirmed arrival for your scheduled shift at {{location}} ({{start_time}}-{{end_time}}). Please reply YES if you are on site or NO if you have not arrived." },
  { key: "ARRIVAL_CONFIRMED", name: "Arrival confirmed", description: "Acknowledgement after YES.", variables: V,
    body: "Thank you {{guard_name}}. Your arrival at {{location}} is recorded. Stay alert. Reply EMERGENCY at any time if you need urgent help." },
  { key: "ARRIVAL_DENIED", name: "Arrival not confirmed", description: "Acknowledgement after NO.", variables: V,
    body: "Noted. {{supervisor_name}} has been informed that you have not arrived at {{location}}. Reply YES as soon as you are on site." },
  { key: "WELFARE", name: "Mid-shift welfare check", description: "Sent at the shift midpoint.", variables: V,
    body: "SECURITY CHECK: This is your mid-shift welfare check for {{location}}. Reply: 1 - SHIFT GOING WELL, 2 - NEED ASSISTANCE, 3 - INCIDENT/ALERT" },
  { key: "WELFARE_OK", name: "Welfare acknowledged", description: "After reply 1.", variables: V,
    body: "Thank you. Status recorded: shift going well at {{location}}." },
  { key: "ASSISTANCE_ACK", name: "Assistance acknowledged", description: "After reply 2.", variables: V,
    body: "ASSISTANCE REQUEST RECEIVED. {{supervisor_name}} has been notified. If this is an emergency, reply EMERGENCY." },
  { key: "INCIDENT_PROMPT", name: "Incident description prompt", description: "After reply 3 or INCIDENT.", variables: V,
    body: "INCIDENT ALERT RECEIVED. Please reply with a brief description of the incident." },
  { key: "INCIDENT_ACK", name: "Incident recorded", description: "After the description arrives.", variables: V,
    body: "Incident recorded at {{location}}. {{supervisor_name}} has been notified. Reply EMERGENCY if you need urgent help." },
  { key: "EMERGENCY_ACK", name: "Emergency acknowledged", description: "After EMERGENCY.", variables: V,
    body: "EMERGENCY ALERT RECEIVED from {{location}}. {{supervisor_name}} and the control room have been alerted and will contact you now. Stay safe." },
  { key: "COMPLETION", name: "End-of-shift check", description: "Sent at shift end.", variables: V,
    body: "SHIFT COMPLETE CHECK: Your scheduled shift at {{location}} has ended. Have you completed your shift and handed over to the next guard? Reply: YES - Shift completed, NO - Still on duty, INCIDENT - Report an incident" },
  { key: "COMPLETION_CONFIRMED", name: "Shift completed", description: "After YES at shift end.", variables: V,
    body: "Thank you {{guard_name}}. Your shift at {{location}} is recorded as completed. {{company}}" },
  { key: "COMPLETION_DENIED", name: "Still on duty", description: "After NO at shift end.", variables: V,
    body: "Noted, you are still on duty at {{location}}. {{supervisor_name}} has been informed. Reply YES once you have handed over." },
  { key: "HANDOVER_INCOMING", name: "Handover notice to incoming guard", description: "Sent before a relieving shift.", variables: [...V, "other_guard"],
    body: "HANDOVER: You are due to take over from {{other_guard}} at {{location}} at {{start_time}}. Please arrive in time for a proper handover." },
  { key: "HANDOVER_OUTGOING", name: "Handover notice to outgoing guard", description: "Sent before a relieving shift.", variables: [...V, "other_guard"],
    body: "HANDOVER: Your replacement, {{other_guard}}, is scheduled to take over at {{location}} at {{end_time}}." },
  { key: "CLARIFY_ARRIVAL", name: "Clarify arrival reply", description: "Reply not understood during arrival check.", variables: V,
    body: "Sorry, reply not understood. Reply YES if you have arrived at {{location}} or NO if you have not." },
  { key: "CLARIFY_WELFARE", name: "Clarify welfare reply", description: "Reply not understood during welfare check.", variables: V,
    body: "Sorry, reply not understood. Reply 1 - SHIFT GOING WELL, 2 - NEED ASSISTANCE, 3 - INCIDENT/ALERT." },
  { key: "CLARIFY_COMPLETION", name: "Clarify completion reply", description: "Reply not understood at shift end.", variables: V,
    body: "Sorry, reply not understood. Reply YES - shift completed, NO - still on duty, or INCIDENT." },
  { key: "NO_ACTIVE_SHIFT", name: "No active shift", description: "A known guard writes outside any shift window.", variables: V,
    body: "Message received, {{guard_name}}. You have no active shift right now. Your supervisor will see your message. Reply EMERGENCY only in an emergency." },
  // ── client site-status updates (sent to the client's contact, not the guard)
  { key: "CLIENT_ARRIVAL", name: "Client: guard on site", description: "To the client when the guard confirms arrival.", variables: CV,
    body: "{{company}} update for {{site}}: {{guard_name}} is on site and has taken over the post at {{time}}. Shift {{start_time}}-{{end_time}}." },
  { key: "CLIENT_WELFARE_OK", name: "Client: all well", description: "To the client when the mid-shift welfare check comes back fine.", variables: CV,
    body: "{{company}} update for {{site}}: welfare check at {{time}}, everything is in order and the guard is on post." },
  { key: "CLIENT_SHIFT_ENDED", name: "Client: shift ended", description: "To the client when the shift is completed.", variables: CV,
    body: "{{company}} update for {{site}}: the shift ({{start_time}}-{{end_time}}) has ended and {{guard_name}} has completed duty at {{time}}." },
  { key: "CLIENT_EMERGENCY", name: "Client: emergency notice", description: "Sent by the super admin from an emergency incident. Editable before sending.", variables: [...CV, "incident_no"],
    body: "URGENT from {{company}}: an emergency has been reported at {{site}} at {{time}} ({{incident_no}}). Our control room and supervisor are responding. We will update you shortly. Contact us on {{control_phone}}." },
  { key: "UNKNOWN_NUMBER", name: "Unknown number", description: "Sender is not a registered guard.", variables: ["company"],
    body: "This number is not registered with {{company}}. Please contact your supervisor." },
];

export type TemplateVars = Record<string, string | undefined>;

export function renderTemplate(body: string, vars: TemplateVars): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? "").replace(/\s{2,}/g, " ").trim();
}

let cache: { at: number; map: Map<string, string> } | null = null;

export async function getTemplateBody(key: string): Promise<string> {
  if (!cache || Date.now() - cache.at > 15_000) {
    const rows = await db.messageTemplate.findMany({ where: { active: true } });
    cache = { at: Date.now(), map: new Map(rows.map((r) => [r.key, r.body])) };
  }
  return cache.map.get(key) ?? TEMPLATE_DEFS.find((t) => t.key === key)?.body ?? "";
}

export function invalidateTemplateCache() {
  cache = null;
}
