/* DEMO data for Omega Protection Services: fictional clients, sites, guards and a week of history.
 * Run: npm run db:seed:demo   (wipes everything first; never run against a live database) */
process.env.TZ = process.env.TIMEZONE || "Africa/Harare";
import { config as loadEnv } from "dotenv";
loadEnv();
import { type ShiftStatus, type AttendanceStatus, type CheckInType, type SmsType, type IncidentCategory, type Severity } from "@prisma/client";
import bcrypt from "bcryptjs";
import { addDays, addMinutes, setHours, setMinutes, startOfDay, startOfHour, subDays } from "date-fns";
import { TEMPLATE_DEFS, renderTemplate } from "../src/lib/sms/templates";
import { SETTING_DEFS } from "../src/lib/settings";

import { db } from "../src/lib/db";
const now = new Date();
const base = startOfHour(now);
const fmt = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const t = (key: string) => TEMPLATE_DEFS.find((x) => x.key === key)!.body;

async function main() {
  console.log("Resetting database…");
  await db.$transaction([
    db.notification.deleteMany(), db.shiftCheckIn.deleteMany(), db.welfareCheck.deleteMany(), db.incident.deleteMany(),
    db.smsMessage.deleteMany(), db.attendance.deleteMany(), db.shift.deleteMany(), db.shiftRecurrence.deleteMany(),
    db.guard.deleteMany(), db.location.deleteMany(), db.client.deleteMany(), db.auditLog.deleteMany(), db.user.deleteMany(),
    db.messageTemplate.deleteMany(), db.setting.deleteMany(),
  ]);

  // ── settings & templates
  for (const s of SETTING_DEFS) await db.setting.create({ data: { key: s.key, value: s.default, label: s.label, description: s.description, group: s.group } });
  for (const tp of TEMPLATE_DEFS) await db.messageTemplate.create({ data: { key: tp.key, name: tp.name, description: tp.description, body: tp.body, variables: tp.variables } });

  // ── users
  const pw = await bcrypt.hash(process.env.ADMIN_PASSWORD || "Demo12345!", 10);
  const zveshure = await db.user.create({ data: { name: "Mr Kudzu Felix Zveshure", email: "admin@omegasecurity.co.zw", passwordHash: pw, role: "SUPER_ADMIN", title: "Managing Director", phone: "+263772100100", avatarUrl: "/avatars/admin.svg" } });
  const ops = await db.user.create({ data: { name: "Rutendo Makoni", email: "ops@omegasecurity.co.zw", passwordHash: pw, role: "ADMIN", title: "Operations Manager", phone: "+263772100101", avatarUrl: "/avatars/user-1.svg" } });
  const supN = await db.user.create({ data: { name: "Blessing Chikwava", email: "blessing@omegasecurity.co.zw", passwordHash: pw, role: "SUPERVISOR", title: "Supervisor, Northern sites", phone: "+263772100102", avatarUrl: "/avatars/user-2.svg" } });
  const supS = await db.user.create({ data: { name: "Tawanda Mhlanga", email: "tawanda@omegasecurity.co.zw", passwordHash: pw, role: "SUPERVISOR", title: "Supervisor, Industrial sites", phone: "+263772100103", avatarUrl: "/avatars/user-3.svg" } });

  // ── clients & locations
  const mk = async (code: string, name: string, industry: string, contactName: string, contactPhone: string, address: string) =>
    db.client.create({ data: { code, name, industry, contactName, contactPhone, address, contactEmail: `security@${code.toLowerCase()}.co.zw` } });
  const cWestgate = await mk("WGM", "Westgate Shopping Mall", "Retail", "Linda Chirwa", "+263242300100", "Westgate, Harare");
  const cMakro = await mk("ABC", "ABC Logistics", "Warehousing", "Peter Dube", "+263242300200", "Graniteside, Harare");
  const cMine = await mk("ZMC", "Zimplats Mining Co.", "Mining", "Farai Gwenzi", "+263242300300", "Ngezi, Mashonaland West");
  const cSchool = await mk("HIS", "Harare International School", "Education", "Mrs A. Patel", "+263242300400", "Mount Pleasant, Harare");
  const cOffice = await mk("EOP", "Eastgate Office Park", "Commercial property", "Munyaradzi Shoko", "+263242300500", "Eastgate, Harare CBD");

  const mkLoc = async (code: string, name: string, clientId: string, siteType: string, address: string, requiredGuards: number, pattern: "DAY_12" | "NIGHT_12" | "DAY_8" | "NIGHT_8", supervisorId: string, instructions: string) =>
    db.location.create({ data: { code, name, clientId, siteType, address, requiredGuards, shiftPattern: pattern, supervisorId, specialInstructions: instructions, contactName: "Site manager", contactPhone: "+263242300999", clientUpdates: code.startsWith("WGM") || code.startsWith("ABC") } });
  const lMall = await mkLoc("WGM-01", "Westgate Mall — Main Entrance", cWestgate.id, "Shopping mall", "Westgate, Harare", 2, "NIGHT_12", supN.id, "Check loading bay doors at 22:00 and 02:00. Mall control room ext. 204.");
  const lMallCar = await mkLoc("WGM-02", "Westgate Mall — Car Park", cWestgate.id, "Shopping mall", "Westgate, Harare", 1, "NIGHT_12", supN.id, "Patrol all three levels hourly.");
  const lWarehouse = await mkLoc("ABC-01", "ABC Warehouse", cMakro.id, "Warehouse", "12 Plymouth Rd, Graniteside", 2, "NIGHT_12", supS.id, "No deliveries after 20:00. Log every vehicle at the boom gate.");
  const lMine1 = await mkLoc("ZMC-01", "Ngezi Mine — Gate 1", cMine.id, "Mine", "Ngezi Mine, Mashonaland West", 2, "NIGHT_12", supS.id, "Radio check with the control room every two hours.");
  const lMine2 = await mkLoc("ZMC-02", "Ngezi Mine — Gate 2", cMine.id, "Mine", "Ngezi Mine, Mashonaland West", 1, "NIGHT_12", supS.id, "Explosives store perimeter. No unaccompanied visitors.");
  const lSchool = await mkLoc("HIS-01", "Harare International School", cSchool.id, "School", "66 Pendennis Rd, Mount Pleasant", 1, "NIGHT_12", supN.id, "Boarding house wing is occupied. Keep noise down after 21:00.");
  const lOffice = await mkLoc("EOP-01", "Eastgate Office Park — Reception", cOffice.id, "Office building", "Eastgate, Robert Mugabe Rd", 1, "DAY_12", supN.id, "Sign in all visitors. Lift maintenance on Tuesdays.");
  const lOfficeNight = await mkLoc("EOP-02", "Eastgate Office Park — Night Patrol", cOffice.id, "Office building", "Eastgate, Robert Mugabe Rd", 1, "NIGHT_12", supN.id, "Patrol floors 1–8 every hour.");
  // Temporary TEST coordinates used during device testing: flagged so nobody treats them as verified.
  await db.location.update({ where: { id: lOfficeNight.id }, data: { latitude: -17.8318, longitude: 31.0525, geofenceRadiusM: 150, coordinatesSource: "TEST", coordinatesUpdatedAt: new Date() } });

  // ── guards
  const guardSeed: [string, string, string, "MALE" | "FEMALE", string, string, string][] = [
    ["John", "Moyo", "+263772345001", "MALE", "63-123456A63", lWarehouse.id, supS.id],
    ["Peter", "Ncube", "+263772345002", "MALE", "63-223456B63", lMall.id, supN.id],
    ["David", "Banda", "+263772345003", "MALE", "63-323456C63", lMine2.id, supS.id],
    ["Tendai", "Mutasa", "+263772345004", "MALE", "63-423456D63", lMine1.id, supS.id],
    ["Chipo", "Dziva", "+263772345005", "FEMALE", "63-523456E63", lOffice.id, supN.id],
    ["Simba", "Chikore", "+263772345006", "MALE", "63-623456F63", lMall.id, supN.id],
    ["Farai", "Nyoni", "+263772345007", "MALE", "63-723456G63", lWarehouse.id, supS.id],
    ["Tatenda", "Sibanda", "+263772345008", "MALE", "63-823456H63", lSchool.id, supN.id],
    ["Kudzai", "Mapfumo", "+263772345009", "MALE", "63-923456J63", lMine1.id, supS.id],
    ["Munashe", "Gumbo", "+263772345010", "MALE", "63-103456K63", lMallCar.id, supN.id],
    ["Rudo", "Chirwa", "+263772345011", "FEMALE", "63-113456L63", lOfficeNight.id, supN.id],
    ["Blessed", "Marufu", "+263772345012", "MALE", "63-123456M63", lMine2.id, supS.id],
    ["Tinashe", "Hove", "+263772345013", "MALE", "63-133456N63", lWarehouse.id, supS.id],
    ["Nyasha", "Zhou", "+263772345014", "FEMALE", "63-143456P63", lMall.id, supN.id],
    ["Takudzwa", "Mhere", "+263772345015", "MALE", "63-153456Q63", lMine1.id, supS.id],
    ["Lovemore", "Phiri", "+263772345016", "MALE", "63-163456R63", lSchool.id, supN.id],
  ];
  const guards = [] as Awaited<ReturnType<typeof db.guard.create>>[];
  let i = 0;
  for (const [firstName, lastName, phone, gender, nationalId, homeLocationId, supervisorId] of guardSeed) {
    i++;
    const g = await db.guard.create({
      data: {
        guardNo: `G-${String(i).padStart(4, "0")}`, firstName, lastName, phone, gender, nationalId, homeLocationId, supervisorId,
        dateOfBirth: new Date(1980 + (i % 15), i % 12, 1 + i), dateEmployed: subDays(now, 120 + i * 40),
        address: ["Mbare", "Highfield", "Chitungwiza", "Glen View", "Budiriro", "Kuwadzana", "Warren Park", "Mabvuku"][i % 8] + ", Harare",
        emergencyContactName: ["Mary", "Grace", "Tapiwa", "Joseph"][i % 4] + " " + lastName, emergencyContactPhone: `+26377299${String(1000 + i).slice(1)}`,
        employmentStatus: i === 15 ? "ON_LEAVE" : i === 16 ? "SUSPENDED" : "ACTIVE",
        photoUrl: `/avatars/guard-${i}.svg`,
        notes: i === 1 ? "Senior guard. Trained in first aid (2025)." : i === 16 ? "Suspended pending disciplinary hearing, 9 Oct 2026." : null,
      },
    });
    guards.push(g);
  }
  const G = (n: number) => guards[n - 1];

  // ── helpers to build a shift with a complete, consistent trail
  type Scenario = "scheduled" | "awaiting" | "on_duty" | "on_duty_welfare_ok" | "late" | "not_confirmed" | "assistance" | "incident" | "completed" | "completed_late" | "completed_missed_check" | "completed_unconfirmed" | "missed" | "emergency_resolved";
  let incidentSeq = 0;

  async function shift(guardId: string, locationId: string, startAt: Date, hours: number, scenario: Scenario, opts: { welfareOffsetHours?: number; lateMin?: number; incidentText?: string; category?: IncidentCategory; severity?: Severity } = {}) {
    const endAt = addMinutes(startAt, hours * 60);
    const loc = await db.location.findUniqueOrThrow({ where: { id: locationId }, include: { supervisor: true } });
    const guard = await db.guard.findUniqueOrThrow({ where: { id: guardId } });
    const name = `${guard.firstName} ${guard.lastName}`;
    const vars = { guard_name: name, location: loc.name, start_time: fmt(startAt), end_time: fmt(endAt), supervisor_name: loc.supervisor?.name ?? "your supervisor", company: "Omega Protection Services" };
    const sig = " - Omega Protection Services";
    const mid = addMinutes(startAt, hours * 30);
    const ev: { type: CheckInType; at: Date; note?: string; source?: "SMS" | "SYSTEM"; sms?: { dir: "OUTBOUND" | "INBOUND"; body: string; type: SmsType; interpretedAs?: string } }[] = [];
    let status: ShiftStatus = "SCHEDULED";
    let att: AttendanceStatus = "PENDING";
    let arrivalConfirmedAt: Date | null = null;
    let completionConfirmedAt: Date | null = null;
    let lateMinutes = 0;
    let missedChecks = 0;
    const m: Record<string, Date | null> = { arrivalSmsSentAt: null, arrivalReminderSentAt: null, arrivalEscalatedAt: null, welfareSmsSentAt: null, welfareMissedAt: null, completionSmsSentAt: null, completionTimedOutAt: null, emergencyAt: null };
    let pending: "NONE" | "ARRIVAL" | "WELFARE" | "COMPLETION" = "NONE";
    let welfare: { sentAt: Date; respondedAt: Date | null; response: "PENDING" | "WELL" | "ASSISTANCE" | "INCIDENT" | "NO_RESPONSE" } | null = null;
    const incidents: { at: Date; category: IncidentCategory; severity: Severity; description: string; status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED"; resolution?: string }[] = [];

    const arrivalSent = () => { m.arrivalSmsSentAt = startAt; ev.push({ type: "SHIFT_STARTED", at: startAt, note: `Shift at ${loc.name} scheduled ${fmt(startAt)}–${fmt(endAt)}.` }); ev.push({ type: "ARRIVAL_SMS_SENT", at: startAt, note: "Arrival check sent.", sms: { dir: "OUTBOUND", body: renderTemplate(t("ARRIVAL"), vars) + sig, type: "ARRIVAL" } }); };
    const arrived = (min: number) => { const at = addMinutes(startAt, min); arrivalConfirmedAt = at; lateMinutes = min; att = min > 15 ? "LATE" : "PRESENT"; ev.push({ type: "ARRIVAL_CONFIRMED", at, source: "SMS", note: min > 15 ? `Guard confirmed arrival, ${min} min late.` : "Guard confirmed arrival.", sms: { dir: "INBOUND", body: "YES", type: "ARRIVAL", interpretedAs: "YES" } }); ev.push({ type: "ADMIN_NOTE", at: addMinutes(at, 0), note: "", sms: { dir: "OUTBOUND", body: renderTemplate(t("ARRIVAL_CONFIRMED"), vars) + sig, type: "ARRIVAL" } }); };
    const reminder = () => { const at = addMinutes(startAt, 15); m.arrivalReminderSentAt = at; ev.push({ type: "ARRIVAL_REMINDER_SENT", at, note: "No reply after 15 min. Reminder sent.", sms: { dir: "OUTBOUND", body: renderTemplate(t("ARRIVAL_REMINDER"), vars) + sig, type: "ARRIVAL_REMINDER" } }); };
    const escalated = () => { const at = addMinutes(startAt, 30); m.arrivalEscalatedAt = at; att = "NOT_REPORTED"; ev.push({ type: "ARRIVAL_ESCALATED", at, note: `No reply after reminder. Attendance not confirmed. ${loc.supervisor?.name ?? "Supervisor"} notified.` }); };
    const welfareSent = (at: Date) => { m.welfareSmsSentAt = at; welfare = { sentAt: at, respondedAt: null, response: "PENDING" }; ev.push({ type: "WELFARE_SMS_SENT", at, note: "Mid-shift welfare check sent.", sms: { dir: "OUTBOUND", body: renderTemplate(t("WELFARE"), vars) + sig, type: "WELFARE" } }); };
    const welfareOk = (at: Date) => { welfare = { sentAt: welfare!.sentAt, respondedAt: at, response: "WELL" }; ev.push({ type: "WELFARE_OK", at, source: "SMS", note: "Guard replied: shift going well.", sms: { dir: "INBOUND", body: "1", type: "WELFARE", interpretedAs: "WELL" } }); ev.push({ type: "ADMIN_NOTE", at, note: "", sms: { dir: "OUTBOUND", body: renderTemplate(t("WELFARE_OK"), vars) + sig, type: "WELFARE" } }); };
    const completionSent = () => { m.completionSmsSentAt = endAt; ev.push({ type: "COMPLETION_SMS_SENT", at: endAt, note: "End-of-shift check sent.", sms: { dir: "OUTBOUND", body: renderTemplate(t("COMPLETION"), vars) + sig, type: "COMPLETION" } }); };
    const completed = (min: number) => { const at = addMinutes(endAt, min); completionConfirmedAt = at; att = "COMPLETED"; status = "COMPLETED"; ev.push({ type: "COMPLETION_CONFIRMED", at, source: "SMS", note: "Guard confirmed handover.", sms: { dir: "INBOUND", body: "YES", type: "COMPLETION", interpretedAs: "YES" } }); ev.push({ type: "SHIFT_COMPLETED", at, note: "Shift completed.", sms: { dir: "OUTBOUND", body: renderTemplate(t("COMPLETION_CONFIRMED"), vars) + sig, type: "COMPLETION" } }); };

    switch (scenario) {
      case "scheduled": break;
      case "awaiting": arrivalSent(); status = "AWAITING_ARRIVAL"; pending = "ARRIVAL"; break;
      case "late": arrivalSent(); reminder(); status = "LATE"; pending = "ARRIVAL"; break;
      case "not_confirmed": arrivalSent(); reminder(); escalated(); status = "NOT_CONFIRMED"; pending = "ARRIVAL"; break;
      case "on_duty": arrivalSent(); arrived(opts.lateMin ?? 3); status = "ON_DUTY"; break;
      case "on_duty_welfare_ok": arrivalSent(); arrived(opts.lateMin ?? 4); welfareSent(mid); welfareOk(addMinutes(mid, 3)); status = "ON_DUTY"; break;
      case "assistance": {
        arrivalSent(); arrived(2); welfareSent(mid); const at = addMinutes(mid, 2);
        welfare = { sentAt: mid, respondedAt: at, response: "ASSISTANCE" }; status = "ASSISTANCE";
        ev.push({ type: "WELFARE_ASSISTANCE", at, source: "SMS", note: "Guard needs assistance.", sms: { dir: "INBOUND", body: "2", type: "WELFARE", interpretedAs: "ASSISTANCE" } });
        ev.push({ type: "ADMIN_NOTE", at, note: "", sms: { dir: "OUTBOUND", body: renderTemplate(t("ASSISTANCE_ACK"), vars) + sig, type: "ASSISTANCE" } });
        incidents.push({ at, category: "ASSISTANCE_REQUEST", severity: "HIGH", description: `${name} requested assistance by SMS at ${fmt(at)}.`, status: "OPEN" });
        break;
      }
      case "incident": {
        arrivalSent(); arrived(5); welfareSent(mid); const at = addMinutes(mid, 4); const at2 = addMinutes(mid, 9);
        welfare = { sentAt: mid, respondedAt: at, response: "INCIDENT" }; status = "INCIDENT"; att = "INCIDENT";
        ev.push({ type: "WELFARE_INCIDENT", at, source: "SMS", note: "Guard reported an incident. Awaiting description.", sms: { dir: "INBOUND", body: "3", type: "WELFARE", interpretedAs: "INCIDENT" } });
        ev.push({ type: "ADMIN_NOTE", at, note: "", sms: { dir: "OUTBOUND", body: renderTemplate(t("INCIDENT_PROMPT"), vars) + sig, type: "INCIDENT" } });
        const text = opts.incidentText ?? "Two people attempted to enter the warehouse without authorization. They left when challenged.";
        ev.push({ type: "INCIDENT_REPORTED", at: at2, source: "SMS", note: text, sms: { dir: "INBOUND", body: text, type: "INCIDENT", interpretedAs: "INCIDENT_DESCRIPTION" } });
        ev.push({ type: "ADMIN_NOTE", at: at2, note: "", sms: { dir: "OUTBOUND", body: renderTemplate(t("INCIDENT_ACK"), vars) + sig, type: "INCIDENT" } });
        incidents.push({ at: at2, category: opts.category ?? "UNAUTHORIZED_ACCESS", severity: opts.severity ?? "HIGH", description: text, status: "OPEN" });
        break;
      }
      case "completed": arrivalSent(); arrived(opts.lateMin ?? 2 + Math.floor(Math.random() * 10)); welfareSent(mid); welfareOk(addMinutes(mid, 1 + Math.floor(Math.random() * 6))); completionSent(); completed(1 + Math.floor(Math.random() * 8)); break;
      case "completed_late": arrivalSent(); reminder(); arrived(opts.lateMin ?? 25); welfareSent(mid); welfareOk(addMinutes(mid, 3)); completionSent(); completed(4); break;
      case "completed_missed_check": arrivalSent(); arrived(3); welfareSent(mid); m.welfareMissedAt = addMinutes(mid, 20); welfare = { sentAt: mid, respondedAt: null, response: "NO_RESPONSE" }; missedChecks = 1; ev.push({ type: "WELFARE_MISSED", at: addMinutes(mid, 20), note: "No reply to the welfare check within 20 min." }); completionSent(); completed(6); break;
      case "completed_unconfirmed": arrivalSent(); arrived(6); welfareSent(mid); welfareOk(addMinutes(mid, 2)); completionSent(); m.completionTimedOutAt = addMinutes(endAt, 30); status = "COMPLETED"; att = "COMPLETED"; ev.push({ type: "COMPLETION_TIMEOUT", at: addMinutes(endAt, 30), note: "No reply to the end-of-shift check within 30 min. Closed as completed, unconfirmed." }); ev.push({ type: "SHIFT_COMPLETED", at: addMinutes(endAt, 30), note: "Shift closed by the system." }); break;
      case "missed": arrivalSent(); reminder(); escalated(); status = "MISSED"; ev.push({ type: "SHIFT_MISSED", at: endAt, note: "Shift ended with no arrival confirmation." }); break;
      case "emergency_resolved": {
        arrivalSent(); arrived(4); const at = addMinutes(startAt, 280); m.emergencyAt = at; att = "INCIDENT";
        ev.push({ type: "EMERGENCY", at, source: "SMS", note: "EMERGENCY received. Incident created.", sms: { dir: "INBOUND", body: "EMERGENCY", type: "EMERGENCY", interpretedAs: "EMERGENCY" } });
        ev.push({ type: "ADMIN_NOTE", at, note: "", sms: { dir: "OUTBOUND", body: renderTemplate(t("EMERGENCY_ACK"), vars) + sig, type: "EMERGENCY" } });
        const text = "Armed men at the boom gate demanding entry. Three of them, one vehicle, white Toyota Hilux.";
        ev.push({ type: "INCIDENT_REPORTED", at: addMinutes(at, 3), source: "SMS", note: text, sms: { dir: "INBOUND", body: text, type: "INCIDENT", interpretedAs: "INCIDENT_DESCRIPTION" } });
        incidents.push({ at, category: "EMERGENCY", severity: "CRITICAL", description: `EMERGENCY keyword sent by ${name} at ${fmt(at)}. ${text}`, status: "RESOLVED", resolution: "Reaction team and ZRP Graniteside attended within 12 minutes. Suspects fled before arrival. Site secured, guard unharmed. Client informed." });
        welfareSent(mid); welfareOk(addMinutes(mid, 2)); completionSent(); completed(3); status = "COMPLETED";
        break;
      }
    }

    const s = await db.shift.create({
      data: {
        guardId, locationId, supervisorId: loc.supervisorId, startAt, endAt, durationMinutes: hours * 60, status, pendingPrompt: pending,
        instructions: loc.specialInstructions,
        arrivalSmsSentAt: m.arrivalSmsSentAt, arrivalReminderSentAt: m.arrivalReminderSentAt, arrivalEscalatedAt: m.arrivalEscalatedAt,
        welfareSmsSentAt: m.welfareSmsSentAt, welfareMissedAt: m.welfareMissedAt, completionSmsSentAt: m.completionSmsSentAt, completionTimedOutAt: m.completionTimedOutAt, emergencyAt: m.emergencyAt,
        attendance: { create: { status: att, arrivalConfirmedAt, lateMinutes: Math.max(0, lateMinutes - 0), completionConfirmedAt, missedChecks } },
      },
    });
    for (const e of ev.sort((a, b) => a.at.getTime() - b.at.getTime())) {
      let smsId: string | undefined;
      if (e.sms) {
        const msg = await db.smsMessage.create({ data: { direction: e.sms.dir, fromNumber: e.sms.dir === "OUTBOUND" ? "SENTINEL" : guard.phone, toNumber: e.sms.dir === "OUTBOUND" ? guard.phone : "SENTINEL", body: e.sms.body, type: e.sms.type, status: e.sms.dir === "OUTBOUND" ? "DELIVERED" : "RECEIVED", provider: "simulated", providerMessageId: `sim_${Math.random().toString(36).slice(2, 10)}`, interpretedAs: e.sms.interpretedAs, guardId, shiftId: s.id, locationId, createdAt: e.at } });
        smsId = msg.id;
      }
      if (e.type === "ADMIN_NOTE" && !e.note) continue; // outbound ack only, no timeline line
      await db.shiftCheckIn.create({ data: { shiftId: s.id, guardId, type: e.type, note: e.note, at: e.at, source: e.source ?? "SYSTEM", smsMessageId: smsId } });
    }
    if (welfare) await db.welfareCheck.create({ data: { shiftId: s.id, sentAt: welfare.sentAt, respondedAt: welfare.respondedAt, response: welfare.response } });
    for (const inc of incidents) {
      incidentSeq++;
      await db.incident.create({ data: { incidentNo: `INC-${now.getFullYear()}-${String(incidentSeq).padStart(4, "0")}`, guardId, locationId, shiftId: s.id, occurredAt: inc.at, category: inc.category, severity: inc.severity, status: inc.status, description: inc.description, source: inc.category === "EMERGENCY" ? "EMERGENCY" : "SMS", supervisorId: loc.supervisorId, acknowledgedAt: inc.status !== "OPEN" ? addMinutes(inc.at, 4) : null, resolutionNotes: inc.resolution, resolvedAt: inc.status === "RESOLVED" ? addMinutes(inc.at, 45) : null, createdAt: inc.at } });
    }
    return s;
  }

  const at18 = (d: Date) => setMinutes(setHours(startOfDay(d), 18), 0);
  const at06 = (d: Date) => setMinutes(setHours(startOfDay(d), 6), 0);

  // ── last 7 nights of history
  const nightRoster: [number, string][] = [[1, lWarehouse.id], [7, lWarehouse.id], [2, lMall.id], [6, lMall.id], [3, lMine2.id], [4, lMine1.id], [9, lMine1.id], [8, lSchool.id], [10, lMallCar.id], [11, lOfficeNight.id], [12, lMine2.id], [13, lWarehouse.id]];
  const dayRoster: [number, string][] = [[5, lOffice.id], [14, lMall.id]];
  for (let d = 8; d >= 1; d--) {
    const day = subDays(now, d);
    for (const [gi, loc] of nightRoster) {
      let sc: Scenario = "completed";
      if (d === 3 && gi === 3) sc = "missed";
      else if (d === 6 && gi === 10) sc = "missed";
      else if ((d + gi) % 7 === 0) sc = "completed_late";
      else if ((d + gi) % 9 === 0) sc = "completed_missed_check";
      else if ((d + gi) % 11 === 0) sc = "completed_unconfirmed";
      if (d === 2 && gi === 1) sc = "emergency_resolved";
      await shift(G(gi).id, loc, at18(day), 12, sc);
    }
    for (const [gi, loc] of dayRoster) await shift(G(gi).id, loc, at06(day), 12, (d + gi) % 5 === 0 ? "completed_late" : "completed");
  }
  // an admin-logged incident from 4 days ago
  incidentSeq++;
  await db.incident.create({ data: { incidentNo: `INC-${now.getFullYear()}-${String(incidentSeq).padStart(4, "0")}`, guardId: G(5).id, locationId: lOffice.id, occurredAt: setHours(subDays(now, 4), 14), category: "EQUIPMENT_PROBLEM", severity: "LOW", status: "RESOLVED", description: "Reception CCTV monitor 2 not displaying. Reported by the guard at the desk.", source: "ADMIN", supervisorId: supN.id, acknowledgedAt: setHours(subDays(now, 4), 15), resolutionNotes: "Client IT replaced the HDMI cable. Working.", resolvedAt: setHours(subDays(now, 3), 9) } });

  // ── today: day shifts finished this morning/afternoon (if now is after 18:00 they are done), live night shifts relative to now
  // Live board — times relative to the current hour so the demo is always alive.
  await shift(G(1).id, lWarehouse.id, addMinutes(base, -180), 12, "on_duty", { lateMin: 3 });            // John Moyo — on duty, welfare pending later
  await shift(G(7).id, lWarehouse.id, addMinutes(base, -180), 12, "on_duty", { lateMin: 6 });            // Farai Nyoni
  await shift(G(2).id, lMall.id, addMinutes(base, -30), 12, "late");                                     // Peter Ncube — late, reminder sent
  await shift(G(6).id, lMall.id, addMinutes(base, -30), 12, "on_duty", { lateMin: 7 });                  // Simba Chikore
  await shift(G(3).id, lMine2.id, addMinutes(base, -60), 12, "not_confirmed");                           // David Banda — missing
  await shift(G(4).id, lMine1.id, addMinutes(base, -420), 12, "assistance");                             // Tendai Mutasa — assistance
  await shift(G(9).id, lMine1.id, addMinutes(base, -420), 12, "on_duty_welfare_ok", { lateMin: 2 });     // Kudzai Mapfumo
  await shift(G(8).id, lSchool.id, addMinutes(base, -420), 12, "incident", { incidentText: "Three youths climbing the boundary wall near the sports field. Chased them off, wall damaged.", category: "SUSPICIOUS_ACTIVITY", severity: "MEDIUM" }); // Tatenda Sibanda
  await shift(G(10).id, lMallCar.id, addMinutes(base, -300), 8, "on_duty_welfare_ok", { lateMin: 1 });   // Munashe Gumbo — 8 h shift
  await shift(G(11).id, lOfficeNight.id, addMinutes(base, -120), 12, "on_duty", { lateMin: 0 });         // Rudo Chirwa
  await shift(G(12).id, lMine2.id, addMinutes(base, 5), 12, "awaiting");                                 // Blessed Marufu — arrival check just sent
  await shift(G(13).id, lWarehouse.id, addMinutes(base, 120), 12, "scheduled");                          // Tinashe Hove — upcoming (relief)
  await shift(G(14).id, lMall.id, addMinutes(base, 180), 12, "scheduled");                               // Nyasha Zhou — upcoming
  await shift(G(5).id, lOffice.id, addMinutes(base, -600), 12, "completed", { lateMin: 2 });             // Chipo Dziva — day shift completed today
  // tomorrow
  const tmr = addDays(now, 1);
  for (const [gi, loc] of nightRoster.slice(0, 8)) await shift(G(gi).id, loc, at18(tmr), 12, "scheduled");

  // recurring pattern for John Moyo (materialised by the engine from the day after tomorrow)
  await db.shiftRecurrence.create({ data: { guardId: G(1).id, locationId: lWarehouse.id, supervisorId: supS.id, daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: "18:00", endTime: "06:00", startsOn: addDays(now, 2), instructions: lWarehouse.specialInstructions } });

  // ── notifications reflecting the live board
  const n = (type: string, severity: "INFO" | "WARNING" | "CRITICAL", title: string, body: string, minutesAgo: number, readAt: Date | null = null) =>
    db.notification.create({ data: { type, severity, title, body, createdAt: addMinutes(now, -minutesAgo), readAt } });
  await n("GUARD_NOT_REPORTED", "CRITICAL", "David Banda failed to report at Ngezi Mine — Gate 2", "No reply to the arrival check or reminder. Call +263 77 234 5003.", 30);
  await n("ASSISTANCE_REQUESTED", "WARNING", "Tendai Mutasa needs assistance at Ngezi Mine — Gate 1", "Requested at the welfare check. Call +263 77 234 5004.", 58);
  await n("INCIDENT_REPORTED", "CRITICAL", "Incident reported by Tatenda Sibanda at Harare International School", "Three youths climbing the boundary wall near the sports field.", 51);
  await n("GUARD_LATE", "WARNING", "Peter Ncube has not confirmed arrival", "Westgate Mall — Main Entrance. Reminder sent.", 15);
  await n("SHIFT_COMPLETED", "INFO", "Chipo Dziva completed the shift at Eastgate Office Park — Reception", "Confirmed by SMS.", 118, addMinutes(now, -100));
  await n("GUARD_LATE", "WARNING", "Simba Chikore arrived late at Westgate Mall — Main Entrance", "Confirmed 7 min after the start.", 23, addMinutes(now, -10));

  // ── audit trail samples
  await db.auditLog.createMany({ data: [
    { userId: zveshure.id, actor: zveshure.name, action: "USER_LOGIN", entity: "User", entityId: zveshure.id, ip: "41.57.63.12", userAgent: "Chrome 130 / Windows", createdAt: addMinutes(now, -200) },
    { userId: ops.id, actor: ops.name, action: "USER_LOGIN", entity: "User", entityId: ops.id, ip: "41.57.63.40", userAgent: "Chrome 130 / macOS", createdAt: addMinutes(now, -190) },
    { userId: ops.id, actor: ops.name, action: "SHIFT_CREATED", entity: "Shift", details: { guard: "Tinashe Hove", location: lWarehouse.name }, createdAt: addMinutes(now, -185) },
    { userId: ops.id, actor: ops.name, action: "GUARD_UPDATED", entity: "Guard", entityId: G(16).id, details: { employmentStatus: "SUSPENDED" }, createdAt: addDays(now, -4) },
    { userId: zveshure.id, actor: zveshure.name, action: "SETTINGS_UPDATED", entity: "Setting", details: { "arrival.graceMinutes": "15" }, createdAt: addDays(now, -6) },
  ] });

  console.log(`Seeded: ${guards.length} guards, 5 clients, 8 locations, ${await db.shift.count()} shifts, ${await db.smsMessage.count()} SMS, ${await db.incident.count()} incidents.`);
  console.log("Sign in: admin@omegasecurity.co.zw / Sentinel123!");
}

main().finally(() => db.$disconnect());
