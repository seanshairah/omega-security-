/**
 * Basic-phone attendance end to end, against a real database. Every call goes through
 * processGatewayEvents exactly as the operations gateway phone uploads it, so this covers the
 * matching, the shift selection, the policy and what the shift ends up saying.
 *
 * No GPS, no mobile data on the guard's phone, no carrier service is used anywhere here: that is the
 * point. A confirmed call is recorded as a call, never as location.
 *
 *   npx tsx scripts/dev/basic-phone-attendance-e2e.ts
 */
process.env.SMS_PROVIDER = "simulated";
import { config } from "dotenv"; config();
const dbUrl = process.env.DATABASE_URL ?? "";
if (!/localhost|127\.0\.0\.1/.test(dbUrl) && process.env.ALLOW_LIVE_DB !== "1") {
  console.error("Refusing to run against a non-local DATABASE_URL.");
  process.exit(2);
}
import { randomUUID } from "node:crypto";
import { addMinutes } from "date-fns";
import { db } from "../../src/lib/db";
import { createGateway, activateGateway } from "../../src/lib/gateway/service";
import { processGatewayEvents } from "../../src/lib/gateway/events";
import { decideEvidence } from "../../src/lib/attendance/call-attendance";
import { IS_LOCATION_EVIDENCE, evidenceLabel } from "../../src/lib/attendance/evidence";

let passed = 0, failed = 0;
const check = (name: string, ok: boolean, detail = "") => { if (ok) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name} ${detail}`); } };
const TAG = "BASICPHONE-E2E";
const PHONES = { john: "+263778860001", mary: "+263778860002", peter: "+263778860003", ann: "+263778860004", shared: "+263778860009" };

async function clean() {
  const gIds = (await db.guard.findMany({ where: { nationalId: { startsWith: TAG } }, select: { id: true } })).map((g) => g.id);
  const dIds = (await db.gatewayDevice.findMany({ where: { deviceName: { startsWith: TAG } }, select: { id: true } })).map((d) => d.id);
  const sIds = (await db.shift.findMany({ where: { guardId: { in: gIds } }, select: { id: true } })).map((x) => x.id);
  await db.attendanceEvidence.deleteMany({ where: { guardId: { in: gIds } } });
  await db.clientNotification.deleteMany({ where: { guardId: { in: gIds } } });
  await db.welfareCheck.deleteMany({ where: { shiftId: { in: sIds } } });
  await db.shiftCheckIn.deleteMany({ where: { shiftId: { in: sIds } } });
  await db.attendanceCheckIn.deleteMany({ where: { shiftId: { in: sIds } } });
  await db.attendance.deleteMany({ where: { shiftId: { in: sIds } } });
  await db.notification.deleteMany({ where: { OR: [{ guardId: { in: gIds } }, { shiftId: { in: sIds } }] } });
  await db.smsMessage.deleteMany({ where: { OR: [{ guardId: { in: gIds } }, { toNumber: { in: Object.values(PHONES) } }] } });
  await db.gatewayEvent.deleteMany({ where: { gatewayDeviceId: { in: dIds } } });
  await db.callLog.deleteMany({ where: { gatewayDeviceId: { in: dIds } } });
  await db.auditLog.deleteMany({ where: { entityId: { in: [...gIds, ...dIds] } } });
  await db.guard.updateMany({ where: { id: { in: gIds } }, data: { assignedGatewayId: null } });
  await db.location.updateMany({ where: { code: { startsWith: TAG } }, data: { defaultGatewayId: null } });
  await db.shift.deleteMany({ where: { id: { in: sIds } } });
  await db.gatewayDevice.deleteMany({ where: { id: { in: dIds } } });
  await db.guard.deleteMany({ where: { id: { in: gIds } } });
  await db.location.deleteMany({ where: { code: { startsWith: TAG } } });
  await db.client.deleteMany({ where: { code: { startsWith: TAG } } });
}

async function gateway(name: string) {
  const admin = await db.user.findFirstOrThrow({ where: { role: "SUPER_ADMIN" } });
  const g = await createGateway({ deviceName: `${TAG} ${name}`, phoneNumber: `+26377887${String(Math.floor(Math.random() * 90000) + 10000)}`, mode: "OPERATIONS_GATEWAY", actor: { userId: admin.id, name: admin.name } });
  await activateGateway(g.activationCode!, { appVersion: "1.8.0", androidVersion: "14", deviceModel: "Test", batteryLevel: 90, networkType: "wifi" }, "41.0.0.12");
  return db.gatewayDevice.update({ where: { id: g.id }, data: { lastSeenAt: new Date(), status: "ONLINE" } });
}

/** One call, uploaded the way the gateway uploads it. Returns the call id the phone used. */
async function call(deviceId: string, number: string, at: Date, kind: "answered" | "missed" | "short" = "answered", callId = `${TAG}-${randomUUID()}`) {
  const device = await db.gatewayDevice.findUniqueOrThrow({ where: { id: deviceId } });
  const t = (ms: number) => new Date(at.getTime() + ms).toISOString();
  const evs = kind === "missed"
    ? [{ eventId: `${callId}-s`, eventType: "CALL_STARTED", callId, phoneNumber: number, direction: "INCOMING", timestamp: t(0) }, { eventId: `${callId}-e`, eventType: "CALL_ENDED", callId, timestamp: t(20_000), durationSeconds: 0, answered: false }]
    : [{ eventId: `${callId}-s`, eventType: "CALL_STARTED", callId, phoneNumber: number, direction: "INCOMING", timestamp: t(0) }, { eventId: `${callId}-a`, eventType: "CALL_ANSWERED", callId, timestamp: t(5_000) }, { eventId: `${callId}-e`, eventType: "CALL_ENDED", callId, timestamp: t(kind === "short" ? 7_000 : 50_000), durationSeconds: kind === "short" ? 2 : 45, answered: true }];
  await processGatewayEvents(device, evs, { clockOffsetMs: 0 });
  return callId;
}

const evidenceFor = (shiftId: string) => db.attendanceEvidence.findMany({ where: { shiftId }, orderBy: { occurredAt: "asc" } });
const shiftOf = (id: string) => db.shift.findUniqueOrThrow({ where: { id }, include: { attendance: true } });

async function main() {
  await clean();
  const admin = await db.user.findFirstOrThrow({ where: { role: "SUPER_ADMIN" } });
  const client = await db.client.create({ data: { code: `${TAG}-C`, name: "Basic Phone Client" } });
  // Deliberately no coordinates: call attendance must not need them.
  const site = await db.location.create({ data: { code: `${TAG}-S`, name: "ABC Warehouse", clientId: client.id, address: "12 Plymouth Road", supervisorId: admin.id } });
  const ops1 = await gateway("Operations Phone 01");
  const ops2 = await gateway("Operations Phone 02");
  const mk = async (n: string, phone: string, extra: Record<string, unknown> = {}) => db.guard.create({ data: { guardNo: `${TAG}-${n}`, firstName: n, lastName: "Moyo", phone, nationalId: `${TAG}-${n}`, dateEmployed: new Date(), homeLocationId: site.id, phoneType: "BASIC", mobileOperator: "ECONET", preferredAttendance: "CALL", assignedGatewayId: ops1.id, ...extra } });
  const shiftFor = (guardId: string, startOffsetMin: number, hours = 12, status: "SCHEDULED" | "ON_DUTY" | "MISSED" = "SCHEDULED") => {
    const now = new Date();
    return db.shift.create({ data: { guardId, locationId: site.id, supervisorId: admin.id, startAt: addMinutes(now, startOffsetMin), endAt: addMinutes(now, startOffsetMin + hours * 60), durationMinutes: hours * 60, status, attendance: { create: {} } } });
  };
  const now = new Date();

  console.log("clock-in by call");
  const john = await mk("John", PHONES.john);
  const s1 = await shiftFor(john.id, 2); // starts in 2 minutes
  await call(ops1.id, PHONES.john, now);
  let sh = await shiftOf(s1.id);
  let ev = await evidenceFor(s1.id);
  check("1. the registered guard is identified from the number", (await db.callLog.findFirst({ where: { gatewayDeviceId: ops1.id, normalizedPhoneNumber: PHONES.john } }))?.guardId === john.id);
  check("2. the call is linked to his shift", ev.length === 1 && ev[0].shiftId === s1.id);
  check("3. it clocks him in, confirmed, at the time of the call", ev[0]?.kind === "CHECK_IN" && ev[0].status === "CONFIRMED" && sh.status === "ON_DUTY" && Math.abs((sh.attendance?.arrivalConfirmedAt?.getTime() ?? 0) - now.getTime()) < 2000, `${ev[0]?.status} ${sh.status}`);
  check("   labelled as a call, never as location", ev[0]?.source === "CALL" && !IS_LOCATION_EVIDENCE[ev[0].source] && evidenceLabel(ev[0]).label === "Call confirmed");
  check("   with no GPS, no site coordinates and no carrier service", site.latitude === null && (await db.locationEvent.count({ where: { guardId: john.id } })) === 0);
  check("   and the timeline says so", (await db.shiftCheckIn.count({ where: { shiftId: s1.id, type: "ARRIVAL_CONFIRMED", note: { contains: "not location evidence" } } })) === 1);

  console.log("duplicates and restarts");
  const dupId = `${TAG}-dup`;
  const s1b = await shiftFor((await mk("Dup", "+263778860005")).id, 1);
  await call(ops1.id, "+263778860005", now, "answered", dupId);
  await call(ops1.id, "+263778860005", now, "answered", dupId); // the same events again (a retry)
  check("9. a re-sent call creates one record", (await evidenceFor(s1b.id)).length === 1);
  const device = await db.gatewayDevice.findUniqueOrThrow({ where: { id: ops1.id } });
  await processGatewayEvents(device, [{ eventId: `${dupId}-e-again`, eventType: "CALL_ENDED", callId: dupId, timestamp: new Date(now.getTime() + 50_000).toISOString(), durationSeconds: 45, answered: true }], { clockOffsetMs: 0 });
  check("17. a gateway restart re-reporting the call changes nothing", (await evidenceFor(s1b.id)).length === 1);

  console.log("welfare and clock-out");
  const mary = await mk("Mary", PHONES.mary);
  const s2 = await shiftFor(mary.id, -300, 6, "ON_DUTY"); // started 5 h ago, ends in 1 h
  await db.attendance.update({ where: { shiftId: s2.id }, data: { arrivalConfirmedAt: addMinutes(now, -300), status: "PRESENT" } });
  await db.welfareCheck.create({ data: { shiftId: s2.id, sentAt: addMinutes(now, -200), response: "PENDING" } });
  await db.shift.update({ where: { id: s2.id }, data: { pendingPrompt: "WELFARE" } });
  await call(ops1.id, PHONES.mary, addMinutes(now, -190));
  ev = await evidenceFor(s2.id);
  check("5. a call during the shift is a welfare call and settles the pending welfare check", ev[0]?.kind === "WELFARE" && ev[0].status === "CONFIRMED" && (await db.welfareCheck.findFirst({ where: { shiftId: s2.id } }))?.response === "WELL");
  await call(ops1.id, PHONES.mary, addMinutes(now, 55));
  sh = await shiftOf(s2.id);
  ev = await evidenceFor(s2.id);
  check("4. a call near the end clocks her out and completes the shift", ev.at(-1)?.kind === "CHECK_OUT" && ev.at(-1)?.status === "CONFIRMED" && sh.status === "COMPLETED" && Boolean(sh.attendance?.completionConfirmedAt));
  await call(ops1.id, PHONES.mary, addMinutes(now, 70));
  check("   a further call after clocking out does nothing", (await evidenceFor(s2.id)).length === 2);

  console.log("windows, unknown and withheld callers");
  const peter = await mk("Peter", PHONES.peter);
  const s3 = await shiftFor(peter.id, 600);
  await call(ops1.id, PHONES.peter, now); // 10 h before the shift
  check("6. a call outside every window is not attendance", (await evidenceFor(s3.id)).length === 0);
  await call(ops1.id, "+263778869999", now);
  const unknown = await db.callLog.findFirst({ where: { gatewayDeviceId: ops1.id, normalizedPhoneNumber: "+263778869999" } });
  check("7. an unknown caller is assigned to nobody", unknown?.unknownCaller === true && unknown.guardId === null);
  await call(ops1.id, "", now);
  const withheld = await db.callLog.findFirst({ where: { gatewayDeviceId: ops1.id, normalizedPhoneNumber: "unknown" } });
  check("8. a withheld number is assigned to nobody", withheld?.guardId === null);

  console.log("ambiguity");
  await mk("Shared1", "+263778860006", { alternatePhones: [PHONES.shared] });
  await mk("Shared2", "+263778860007", { alternatePhones: [PHONES.shared] });
  await call(ops1.id, PHONES.shared, now);
  check("10. a number on two guards identifies neither", (await db.callLog.findFirst({ where: { gatewayDeviceId: ops1.id, normalizedPhoneNumber: PHONES.shared } }))?.guardId === null);
  const ann = await mk("Ann", PHONES.ann);
  const a1 = await shiftFor(ann.id, 3);
  const a2 = await shiftFor(ann.id, 4);
  await call(ops1.id, PHONES.ann, now);
  const amb = await db.attendanceEvidence.findMany({ where: { guardId: ann.id } });
  check("11. two overlapping shifts: held on both for a person, nothing applied", amb.length === 2 && amb.every((e) => e.status === "PENDING" && e.flags.includes("AMBIGUOUS")) && (await shiftOf(a1.id)).status === "SCHEDULED" && (await shiftOf(a2.id)).status === "SCHEDULED");

  console.log("gateways");
  const g2 = await mk("Wrong", "+263778860008");
  const s4 = await shiftFor(g2.id, 1);
  await call(ops2.id, "+263778860008", now);
  ev = await evidenceFor(s4.id);
  check("12. a call to another gateway is applied and flagged (default policy)", ev[0]?.status === "CONFIRMED" && ev[0].flags.includes("WRONG_GATEWAY"));
  const g3 = await mk("Andro", "+263778860010", { deviceKind: "ANDROID_GUARD", phoneType: "ANDROID" });
  const s5 = await shiftFor(g3.id, 1);
  await call(ops1.id, "+263778860010", now);
  // Marked as a guard-app guard but with no registered phone to ask for a fix: decided like a basic phone.
  check("19. a guard-app guard with no phone that can be asked is decided like a basic phone", (await evidenceFor(s5.id))[0]?.status === "CONFIRMED" && !(await evidenceFor(s5.id))[0]?.flags.includes("GPS_REQUESTED"));

  console.log("missed and short calls");
  const g4 = await mk("Missed", "+263778860011");
  const s6 = await shiftFor(g4.id, 1);
  await call(ops1.id, "+263778860011", now, "missed");
  ev = await evidenceFor(s6.id);
  check("14. a missed call is held as pending, never verified", ev[0]?.source === "MISSED_CALL" && ev[0].status === "PENDING" && (await shiftOf(s6.id)).status === "SCHEDULED");
  check("   and a supervisor is asked to confirm it", (await db.notification.count({ where: { type: "CALL_ATTENDANCE_PENDING", shiftId: s6.id } })) === 1);
  await decideEvidence(ev[0].id, true, { id: admin.id, name: admin.name }, "Called him back, he is at the gate");
  sh = await shiftOf(s6.id);
  check("18. a supervisor confirms it: applied at the call's time, audited", sh.status === "ON_DUTY" && Boolean(sh.attendance?.arrivalConfirmedAt) && (await db.auditLog.count({ where: { action: "ATTENDANCE_EVIDENCE_CONFIRMED", entityId: ev[0].id } })) === 1);
  const g5 = await mk("Short", "+263778860012");
  const s7 = await shiftFor(g5.id, 1);
  await call(ops1.id, "+263778860012", now, "short");
  ev = await evidenceFor(s7.id);
  check("20. a two-second call is held, flagged short", ev[0]?.status === "PENDING" && ev[0].flags.includes("SHORT_CALL"));
  await decideEvidence(ev[0].id, false, { id: admin.id, name: admin.name }, "Pocket dial");
  check("    a supervisor rejects it: nothing applied", (await shiftOf(s7.id)).status === "SCHEDULED" && (await db.attendanceEvidence.findUnique({ where: { id: ev[0].id } }))?.status === "REJECTED");

  console.log("offline gateway");
  const g6 = await mk("Late", "+263778860013");
  const s8 = await shiftFor(g6.id, -240, 12, "ON_DUTY");
  await call(ops1.id, "+263778860013", addMinutes(now, -238)); // happened 4 h ago, synced now
  ev = await evidenceFor(s8.id);
  sh = await shiftOf(s8.id);
  check("15/16. a call saved offline and synced hours later: the right shift, its real time, flagged late", ev[0]?.kind === "CHECK_IN" && ev[0].flags.includes("LATE_SYNC") && Math.abs((sh.attendance?.arrivalConfirmedAt?.getTime() ?? 0) - addMinutes(now, -238).getTime()) < 2000);
  const g7 = await mk("Closed", "+263778860014");
  const s9 = await shiftFor(g7.id, -900, 12, "MISSED"); // ended 3 h ago, closed by the engine
  await call(ops1.id, "+263778860014", addMinutes(now, -898));
  ev = await evidenceFor(s9.id);
  check("    a call synced after the shift was closed is held, and never reopens it", ev[0]?.status === "PENDING" && ev[0].flags.includes("SHIFT_CLOSED") && (await shiftOf(s9.id)).status === "MISSED");

  await clean();
  console.log(`\n${passed} passed, ${failed} failed`);
  await db.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await clean().catch(() => undefined); await db.$disconnect(); process.exit(1); });
