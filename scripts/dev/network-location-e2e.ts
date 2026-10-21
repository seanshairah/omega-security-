/**
 * Hybrid location verification end to end, against a real local database: the router, the
 * simulation adapter, the unconfigured operator adapters, consent, the shift window, cooldown and
 * caps, call-triggered checks, the Android fallback and the engine's scheduled triggers.
 *
 * Every network answer here is simulated. Nothing in this script shows that any Zimbabwean operator
 * offers network location: none publicly does today.
 *
 *   npx tsx scripts/dev/network-location-e2e.ts
 */
process.env.SMS_PROVIDER = "simulated";
delete process.env.NETWORK_LOCATION_PROVIDER;
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
import type { Setting } from "@prisma/client";
import { invalidateSettingsCache, saveSettings } from "../../src/lib/settings";
import { evidenceLabel, IS_LOCATION_EVIDENCE } from "../../src/lib/attendance/evidence";
import { requestNetworkVerification, runNetworkLocationSchedule, networkCheckForCall } from "../../src/lib/network-location/service";
import { setSimulatedNetworkAnswer } from "../../src/lib/network-location/provider";
import { DEFAULT_NETWORK_POLICY } from "../../src/lib/network-location/router-rules";

let passed = 0, failed = 0;
const check = (name: string, ok: boolean, detail = "") => { if (ok) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name} ${detail}`); } };
const TAG = "NETLOC-E2E";
const KEYS = ["networkLocation.enabled", "networkLocation.onIncomingCall", "networkLocation.onShiftStart"];
let savedSettings: Setting[] = [];

async function setSettings(v: Record<string, string>) {
  await saveSettings(v);
  invalidateSettingsCache();
}

async function clean() {
  const gIds = (await db.guard.findMany({ where: { nationalId: { startsWith: TAG } }, select: { id: true } })).map((g) => g.id);
  const dIds = (await db.gatewayDevice.findMany({ where: { deviceName: { startsWith: TAG } }, select: { id: true } })).map((d) => d.id);
  const sIds = (await db.shift.findMany({ where: { guardId: { in: gIds } }, select: { id: true } })).map((x) => x.id);
  await db.networkLocationCheck.deleteMany({ where: { guardId: { in: gIds } } });
  await db.attendanceEvidence.deleteMany({ where: { guardId: { in: gIds } } });
  await db.clientNotification.deleteMany({ where: { guardId: { in: gIds } } });
  await db.locationEvent.deleteMany({ where: { gatewayDeviceId: { in: dIds } } });
  await db.welfareCheck.deleteMany({ where: { shiftId: { in: sIds } } });
  await db.shiftCheckIn.deleteMany({ where: { shiftId: { in: sIds } } });
  await db.attendanceCheckIn.deleteMany({ where: { shiftId: { in: sIds } } });
  await db.attendance.deleteMany({ where: { shiftId: { in: sIds } } });
  await db.notification.deleteMany({ where: { OR: [{ guardId: { in: gIds } }, { shiftId: { in: sIds } }] } });
  await db.smsMessage.deleteMany({ where: { guardId: { in: gIds } } });
  await db.gatewayEvent.deleteMany({ where: { gatewayDeviceId: { in: dIds } } });
  await db.callLog.deleteMany({ where: { gatewayDeviceId: { in: dIds } } });
  await db.auditLog.deleteMany({ where: { entityId: { in: [...gIds, ...dIds] } } });
  await db.shift.deleteMany({ where: { id: { in: sIds } } });
  await db.gatewayDevice.updateMany({ where: { id: { in: dIds } }, data: { guardId: null } });
  await db.gatewayDevice.deleteMany({ where: { id: { in: dIds } } });
  await db.guard.deleteMany({ where: { id: { in: gIds } } });
  await db.location.deleteMany({ where: { code: { startsWith: TAG } } });
  await db.client.deleteMany({ where: { code: { startsWith: TAG } } });
}

async function call(deviceId: string, number: string, at: Date) {
  const device = await db.gatewayDevice.findUniqueOrThrow({ where: { id: deviceId } });
  const callId = `${TAG}-${randomUUID()}`;
  const t = (ms: number) => new Date(at.getTime() + ms).toISOString();
  await processGatewayEvents(device, [
    { eventId: `${callId}-s`, eventType: "CALL_STARTED", callId, phoneNumber: number, direction: "INCOMING", timestamp: t(0) },
    { eventId: `${callId}-a`, eventType: "CALL_ANSWERED", callId, timestamp: t(5_000) },
    { eventId: `${callId}-e`, eventType: "CALL_ENDED", callId, timestamp: t(50_000), durationSeconds: 45, answered: true },
  ], { clockOffsetMs: 0 });
  return db.callLog.findFirstOrThrow({ where: { callId, gatewayDeviceId: deviceId } });
}

const rowsFor = (guardId: string) => db.networkLocationCheck.findMany({ where: { guardId }, orderBy: { requestedAt: "asc" } });

async function main() {
  savedSettings = await db.setting.findMany({ where: { key: { in: KEYS } } });
  await clean();
  const admin = await db.user.findFirstOrThrow({ where: { role: "SUPER_ADMIN" } });
  const actor = { userId: admin.id, name: admin.name };
  const client = await db.client.create({ data: { code: `${TAG}-C`, name: "Network Client" } });
  const site = await db.location.create({ data: { code: `${TAG}-S`, name: "Net Warehouse", clientId: client.id, address: "1 Net Road", supervisorId: admin.id, latitude: -17.8292, longitude: 31.0522, geofenceRadiusM: 150, coordinatesSource: "TEST", networkVerifyEnabled: true, networkRadiusM: 1000 } });
  const bare = await db.location.create({ data: { code: `${TAG}-B`, name: "No Area Site", clientId: client.id, address: "2 Net Road", supervisorId: admin.id, latitude: -17.83, longitude: 31.05, coordinatesSource: "TEST" } });
  const ops = await createGateway({ deviceName: `${TAG} Ops`, phoneNumber: "+263778869999", mode: "OPERATIONS_GATEWAY", actor });
  await activateGateway(ops.activationCode!, { appVersion: "1.8.0", androidVersion: "14", deviceModel: "Test", batteryLevel: 90, networkType: "wifi" }, "41.0.0.12");
  await db.gatewayDevice.update({ where: { id: ops.id }, data: { lastSeenAt: new Date(), status: "ONLINE" } });
  let n = 0;
  const mkGuard = (name: string, extra: Record<string, unknown> = {}) => db.guard.create({ data: { guardNo: `${TAG}-${name}`, firstName: name, lastName: "Net", phone: `+2637788600${String(++n).padStart(2, "0")}`, nationalId: `${TAG}-${name}`, dateEmployed: new Date(), homeLocationId: site.id, phoneType: "BASIC", mobileOperator: "ECONET", preferredAttendance: "CALL", networkLocationEligible: true, networkLocationConsentAt: new Date(), ...extra } });
  const now = new Date();
  const mkShift = (guardId: string, locationId = site.id, startOffset = -2, status: "SCHEDULED" | "ON_DUTY" = "ON_DUTY") => db.shift.create({ data: { guardId, locationId, supervisorId: admin.id, startAt: addMinutes(now, startOffset), endAt: addMinutes(now, startOffset + 720), durationMinutes: 720, status, attendance: { create: {} } } });
  const policy = { ...DEFAULT_NETWORK_POLICY, enabled: true };

  console.log("Feature off: attendance by call works, nothing is asked of the network");
  const nia = await mkGuard("Nia");
  const niaShift = await mkShift(nia.id, site.id, 2, "SCHEDULED");
  const c1 = await call(ops.id, nia.phone, addMinutes(now, 0));
  const att = await db.attendance.findUniqueOrThrow({ where: { shiftId: niaShift.id } });
  check("the guard clocks in by calling, with network checks off", att.arrivalConfirmedAt != null);
  check("no network request and no network record", (await rowsFor(nia.id)).length === 0);

  console.log("Feature on, no provider (today's real situation)");
  await setSettings({ "networkLocation.enabled": "true", "networkLocation.onIncomingCall": "true" });
  await networkCheckForCall(nia.id, niaShift.id, c1.id, addMinutes(now, 3));
  let rows = await rowsFor(nia.id);
  check("the call is recorded and the network check is recorded as unavailable, not sent", rows.length === 1 && rows[0].result === "NETWORK_PROVIDER_UNAVAILABLE" && !rows[0].requestSent && rows[0].provider === "router", JSON.stringify(rows.map((r) => [r.result, r.reason])));
  check("no network evidence is invented", (await db.attendanceEvidence.count({ where: { shiftId: niaShift.id, source: "NETWORK" } })) === 0);
  await networkCheckForCall(nia.id, niaShift.id, c1.id, addMinutes(now, 3));
  check("the same call never triggers a second check", (await rowsFor(nia.id)).length === 1);

  console.log("Simulation adapter");
  process.env.NETWORK_LOCATION_PROVIDER = "simulation";
  const c2 = await call(ops.id, nia.phone, addMinutes(now, 60));
  rows = await rowsFor(nia.id);
  const sent = rows.find((r) => r.requestSent);
  check("a guard's call triggers one network check", rows.length === 2 && sent?.trigger === "INCOMING_CALL" && sent.dedupeKey === `call:${c2.id}`, JSON.stringify(rows.map((r) => r.result)));
  check("inside, flagged simulated, with the requested area and no guard coordinates", sent?.result === "NETWORK_VERIFIED_INSIDE" && sent.simulated && sent.areaRadiusM === 1000 && sent.areaLatitude === -17.8292 && sent.authorisationRef === "simulation");
  const netEv = await db.attendanceEvidence.findFirst({ where: { shiftId: niaShift.id, source: "NETWORK" } });
  check("presence evidence from the network, labelled simulated, not GPS", netEv?.kind === "PRESENCE" && netEv.flags.includes("SIMULATED") && evidenceLabel(netEv).label.startsWith("Simulated") && IS_LOCATION_EVIDENCE.NETWORK && !evidenceLabel(netEv).label.includes("GPS"), netEv ? evidenceLabel(netEv).label : "none");
  check("GPS history is untouched", (await db.locationEvent.count({ where: { guardId: nia.id } })) === 0);
  const tl = await db.shiftCheckIn.findFirst({ where: { shiftId: niaShift.id, type: "NETWORK_LOCATION" } });
  check("the timeline says network, never GPS", Boolean(tl?.note?.includes("Not GPS")) && Boolean(tl?.note?.includes("simulated")), tl?.note ?? "");

  // The call-triggered check above was made when the call was processed, at about `now`.
  let r = await requestNetworkVerification({ guardId: nia.id, shiftId: niaShift.id, trigger: "MANUAL", actor }, addMinutes(now, 10), policy);
  check("within the cooldown a further check is skipped and nothing is stored", r.method === "SKIP" && (await rowsFor(nia.id)).length === 2, `${r.method} ${r.reason ?? ""}`);
  setSimulatedNetworkAnswer(nia.phone, { verificationResult: "FALSE" });
  r = await requestNetworkVerification({ guardId: nia.id, shiftId: niaShift.id, trigger: "MANUAL", actor }, addMinutes(now, 40), policy);
  check("outside: recorded as outside, a location exception for a person, no evidence", r.check?.result === "NETWORK_VERIFIED_OUTSIDE" && (await db.notification.count({ where: { shiftId: niaShift.id, type: "LOCATION_EXCEPTION" } })) === 1 && (await db.attendanceEvidence.count({ where: { shiftId: niaShift.id, source: "NETWORK" } })) === 1, `${r.method} ${r.check?.result ?? r.reason}`);
  check("…and the guard's clock-in by call stands", (await db.attendance.findUniqueOrThrow({ where: { shiftId: niaShift.id } })).arrivalConfirmedAt != null);
  check("a manual request is audited", (await db.auditLog.count({ where: { entityId: nia.id, action: "NETWORK_LOCATION_REQUESTED" } })) >= 2);
  setSimulatedNetworkAnswer(nia.phone, { verificationResult: "TRUE", lastLocationTime: new Date(Date.now() - 15 * 60_000).toISOString() });
  r = await requestNetworkVerification({ guardId: nia.id, shiftId: niaShift.id, trigger: "MANUAL", actor }, addMinutes(now, 75), policy);
  check("a position older than the allowed age is stale, not inside", r.check?.result === "NETWORK_LOCATION_STALE", `${r.method} ${r.check?.result ?? r.reason}`);
  setSimulatedNetworkAnswer(nia.phone, { verificationResult: "PARTIAL", matchRate: 62 });
  r = await requestNetworkVerification({ guardId: nia.id, shiftId: niaShift.id, trigger: "MANUAL", actor }, addMinutes(now, 110), policy);
  check("a partial answer keeps its match rate and is not evidence", r.check?.result === "NETWORK_PARTIAL_MATCH" && r.check.matchRate === 62 && (await db.attendanceEvidence.count({ where: { shiftId: niaShift.id, source: "NETWORK" } })) === 1, `${r.method} ${r.check?.result ?? r.reason}`);
  r = await requestNetworkVerification({ guardId: nia.id, shiftId: niaShift.id, trigger: "MANUAL", actor }, addMinutes(now, 150), policy);
  check("the per-shift limit (4) stops further requests", r.method === "SKIP" && Boolean(r.reason?.includes("this shift")), r.reason ?? "");
  setSimulatedNetworkAnswer(nia.phone, "ERROR");
  r = await requestNetworkVerification({ guardId: nia.id, shiftId: niaShift.id, trigger: "MANUAL", actor }, addMinutes(now, 150), { ...policy, maxPerShift: 10 });
  check("a provider error is recorded as an error", r.check?.result === "NETWORK_ERROR" && r.check.requestSent);
  setSimulatedNetworkAnswer(nia.phone, "TIMEOUT");
  r = await requestNetworkVerification({ guardId: nia.id, shiftId: niaShift.id, trigger: "MANUAL", actor }, addMinutes(now, 185), { ...policy, maxPerShift: 10 });
  check("a provider timeout is recorded as an error, and nothing else breaks", r.check?.result === "NETWORK_ERROR" && Boolean(r.check.reason?.includes("timeout")));
  setSimulatedNetworkAnswer(nia.phone, null);
  r = await requestNetworkVerification({ guardId: nia.id, shiftId: niaShift.id, trigger: "MANUAL", actor }, addMinutes(now, 230), { ...policy, maxPerShift: 10, monthlyCap: 1 });
  check("the monthly cap stops requests", r.method === "SKIP" && Boolean(r.reason?.includes("monthly")));

  console.log("Eligibility");
  const oto = await mkGuard("Oto", { networkLocationConsentAt: null });
  const otoShift = await mkShift(oto.id);
  r = await requestNetworkVerification({ guardId: oto.id, shiftId: otoShift.id, trigger: "MANUAL", actor }, now, policy);
  check("no consent: not authorised, nothing sent", r.check?.result === "NETWORK_NOT_AUTHORISED" && !r.check.requestSent);
  const pia = await mkGuard("Pia", { phoneType: "UNKNOWN" });
  const piaShift = await mkShift(pia.id);
  r = await requestNetworkVerification({ guardId: pia.id, shiftId: piaShift.id, trigger: "MANUAL", actor }, now, policy);
  check("unknown phone type never qualifies", r.check?.result === "NETWORK_UNSUPPORTED" && !r.check.requestSent);
  const quin = await mkGuard("Quin", { mobileOperator: "UNKNOWN" });
  const quinShift = await mkShift(quin.id);
  r = await requestNetworkVerification({ guardId: quin.id, shiftId: quinShift.id, trigger: "MANUAL", actor }, now, policy);
  check("unknown network: unsupported", r.check?.result === "NETWORK_UNSUPPORTED");
  const rae = await mkGuard("Rae");
  const raeShift = await mkShift(rae.id, bare.id);
  r = await requestNetworkVerification({ guardId: rae.id, shiftId: raeShift.id, trigger: "MANUAL", actor }, now, policy);
  check("a site with no network area: unsupported, the GPS radius is never borrowed", r.check?.result === "NETWORK_UNSUPPORTED" && r.check.areaRadiusM == null);
  const sam = await mkGuard("Sam");
  const samShift = await mkShift(sam.id, site.id, 300, "SCHEDULED");
  r = await requestNetworkVerification({ guardId: sam.id, shiftId: samShift.id, trigger: "MANUAL", actor }, now, policy);
  check("outside the shift window: not authorised", r.check?.result === "NETWORK_NOT_AUTHORISED" && Boolean(r.check.reason?.includes("shift")));
  delete process.env.NETWORK_LOCATION_PROVIDER;
  const tia = await mkGuard("Tia", { mobileOperator: "NETONE" });
  const tiaShift = await mkShift(tia.id);
  r = await requestNetworkVerification({ guardId: tia.id, shiftId: tiaShift.id, trigger: "MANUAL", actor }, now, policy);
  check("NetOne without an authorised integration: provider unavailable, nothing sent", r.check?.result === "NETWORK_PROVIDER_UNAVAILABLE" && !r.check.requestSent);
  process.env.NETWORK_LOCATION_PROVIDER = "simulation";

  console.log("Android guards: GPS first");
  const uma = await mkGuard("Uma", { phoneType: "ANDROID", deviceKind: "ANDROID_GUARD" });
  const umaShift = await mkShift(uma.id, site.id, -60);
  const phone = await createGateway({ deviceName: `${TAG} Uma phone`, phoneNumber: "+263778869998", mode: "GUARD", guardId: uma.id, actor });
  await db.locationEvent.create({ data: { eventId: `${TAG}-${randomUUID()}`, gatewayDeviceId: phone.id, guardId: uma.id, shiftId: umaShift.id, locationId: site.id, eventType: "LOCATION_CHECK", locationState: "INSIDE", latitude: -17.8292, longitude: 31.0522, accuracyM: 12, occurredAt: addMinutes(now, -5) } });
  const gpsBefore = await db.locationEvent.count({ where: { guardId: uma.id } });
  r = await requestNetworkVerification({ guardId: uma.id, shiftId: umaShift.id, trigger: "ANDROID_FALLBACK" }, now, { ...policy, androidFallback: true });
  check("fresh GPS: no network request, nothing stored", r.method === "GPS" && (await rowsFor(uma.id)).length === 0);
  r = await requestNetworkVerification({ guardId: uma.id, shiftId: umaShift.id, trigger: "ANDROID_FALLBACK" }, addMinutes(now, 40), policy);
  check("GPS quiet but the fallback is off: keep waiting for the app", r.method === "GPS");
  r = await requestNetworkVerification({ guardId: uma.id, shiftId: umaShift.id, trigger: "ANDROID_FALLBACK" }, addMinutes(now, 40), { ...policy, androidFallback: true });
  check("GPS quiet and the fallback on: one network check", r.method === "NETWORK" && r.check?.trigger === "ANDROID_FALLBACK");
  check("the GPS history is never overwritten", (await db.locationEvent.count({ where: { guardId: uma.id } })) === gpsBefore);

  console.log("Scheduled triggers");
  await setSettings({ "networkLocation.onShiftStart": "true" });
  const vic = await mkGuard("Vic");
  const vicShift = await mkShift(vic.id, site.id, -5);
  await runNetworkLocationSchedule(now);
  await runNetworkLocationSchedule(addMinutes(now, 1));
  rows = await rowsFor(vic.id);
  check("shift start: one check, however many times the engine runs", rows.length === 1 && rows[0].trigger === "SHIFT_START" && rows[0].dedupeKey === `SHIFT_START:${vicShift.id}`);
  const wyn = await mkGuard("Wyn", { networkLocationEligible: false });
  await mkShift(wyn.id, site.id, -5);
  await runNetworkLocationSchedule(now);
  check("guards not set up for network checks are not even considered by the schedule", (await rowsFor(wyn.id)).length === 0);
}

main()
  .then(async () => {
    await clean();
    await db.setting.deleteMany({ where: { key: { in: KEYS } } });
    for (const s of savedSettings) await db.setting.create({ data: s });
    console.log(`\n${passed} passed, ${failed} failed · test data removed, settings restored`);
    await db.$disconnect();
    process.exit(failed ? 1 : 0);
  })
  .catch(async (e) => {
    console.error(e);
    await db.setting.deleteMany({ where: { key: { in: KEYS } } }).catch(() => undefined);
    for (const s of savedSettings) await db.setting.create({ data: s }).catch(() => undefined);
    await db.$disconnect();
    process.exit(1);
  });
