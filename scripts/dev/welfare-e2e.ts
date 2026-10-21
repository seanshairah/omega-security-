/**
 * Scheduled welfare checks end to end, against a real local database: SMS, automated voice calls
 * (simulated provider only), operations-phone calls, retries, SMS fallback, escalation, key presses
 * 1/2/3, duplicate and delayed webhooks, and the signed webhook route over HTTP.
 *
 * The voice provider here is the simulated one. Nothing in this script proves a real IVR call works;
 * that needs a contracted provider and a real phone.
 *
 *   npx tsx scripts/dev/welfare-e2e.ts     (the HTTP checks need the dev server on BASE_URL, started
 *                                           with VOICE_PROVIDER=simulated VOICE_WEBHOOK_SECRET=…)
 */
process.env.SMS_PROVIDER = "simulated";
process.env.VOICE_PROVIDER = "simulated";
import { config } from "dotenv"; config();
const dbUrl = process.env.DATABASE_URL ?? "";
if (!/localhost|127\.0\.0\.1/.test(dbUrl) && process.env.ALLOW_LIVE_DB !== "1") {
  console.error("Refusing to run against a non-local DATABASE_URL.");
  process.exit(2);
}
import { addMinutes } from "date-fns";
import { db } from "../../src/lib/db";
import { createGateway, activateGateway } from "../../src/lib/gateway/service";
import { decideEvidence } from "../../src/lib/attendance/call-attendance";
import { IS_LOCATION_EVIDENCE, evidenceLabel } from "../../src/lib/attendance/evidence";
import { processIncomingMessage } from "../../src/lib/sms/pipeline";
import { runWelfareSchedule, applyVoiceReport } from "../../src/lib/welfare/scheduled";
import { signVoiceWebhook } from "../../src/lib/voice/provider";
import { zonedWallClockToInstant } from "../../src/lib/time";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SECRET = process.env.E2E_VOICE_SECRET ?? "e2e-voice-secret";
let passed = 0, failed = 0;
const check = (name: string, ok: boolean, detail = "") => { if (ok) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name} ${detail}`); } };
const TAG = "WELFARE-E2E";
let seq = 0;
const ev = () => `${TAG}-ev-${Date.now()}-${++seq}`;

async function clean() {
  const gIds = (await db.guard.findMany({ where: { nationalId: { startsWith: TAG } }, select: { id: true } })).map((g) => g.id);
  const dIds = (await db.gatewayDevice.findMany({ where: { deviceName: { startsWith: TAG } }, select: { id: true } })).map((d) => d.id);
  const sIds = (await db.shift.findMany({ where: { guardId: { in: gIds } }, select: { id: true } })).map((x) => x.id);
  await db.voiceWebhookEvent.deleteMany({ where: { eventId: { startsWith: TAG } } });
  await db.attendanceEvidence.deleteMany({ where: { guardId: { in: gIds } } });
  await db.clientNotification.deleteMany({ where: { guardId: { in: gIds } } });
  await db.welfareCheck.deleteMany({ where: { shiftId: { in: sIds } } });
  await db.callRequest.deleteMany({ where: { guardId: { in: gIds } } });
  await db.incident.deleteMany({ where: { guardId: { in: gIds } } });
  await db.shiftCheckIn.deleteMany({ where: { shiftId: { in: sIds } } });
  await db.attendance.deleteMany({ where: { shiftId: { in: sIds } } });
  await db.notification.deleteMany({ where: { OR: [{ guardId: { in: gIds } }, { shiftId: { in: sIds } }] } });
  await db.smsMessage.deleteMany({ where: { guardId: { in: gIds } } });
  await db.gatewayEvent.deleteMany({ where: { gatewayDeviceId: { in: dIds } } });
  await db.callLog.deleteMany({ where: { gatewayDeviceId: { in: dIds } } });
  await db.auditLog.deleteMany({ where: { entityId: { in: [...gIds, ...dIds] } } });
  await db.shift.deleteMany({ where: { id: { in: sIds } } });
  await db.location.updateMany({ where: { code: { startsWith: TAG } }, data: { defaultGatewayId: null } });
  await db.gatewayDevice.deleteMany({ where: { id: { in: dIds } } });
  await db.guard.deleteMany({ where: { id: { in: gIds } } });
  await db.location.deleteMany({ where: { code: { startsWith: TAG } } });
  await db.client.deleteMany({ where: { code: { startsWith: TAG } } });
}

const checksOf = (shiftId: string) => db.welfareCheck.findMany({ where: { shiftId }, orderBy: { sentAt: "asc" } });
const welfareTexts = (guardId: string) => db.smsMessage.count({ where: { guardId, direction: "OUTBOUND", type: "WELFARE" } });
const report = (callId: string, status: string, digits: string | null, at: Date, reference?: string) => ({ eventId: ev(), providerCallId: callId, status, digits, at, reference: reference ?? null });

async function post(body: object, opts: { ts?: number; sig?: string } = {}) {
  const raw = JSON.stringify(body);
  const ts = String(opts.ts ?? Date.now());
  const sig = opts.sig ?? signVoiceWebhook(SECRET, ts, raw);
  const r = await fetch(`${BASE}/api/voice/webhook/simulated`, { method: "POST", headers: { "content-type": "application/json", "x-voice-signature": sig, "x-voice-timestamp": ts }, body: raw });
  return { status: r.status, json: await r.json().catch(() => ({})) as Record<string, unknown> };
}

async function main() {
  await clean();
  const admin = await db.user.findFirstOrThrow({ where: { role: "SUPER_ADMIN" } });
  const client = await db.client.create({ data: { code: `${TAG}-C`, name: "Welfare Client" } });
  const mkSite = (code: string, data: Record<string, unknown>) => db.location.create({ data: { code: `${TAG}-${code}`, name: `Welfare ${code}`, clientId: client.id, address: "1 Test Road", supervisorId: admin.id, ...data } });
  let n = 0;
  const mkGuard = (name: string, siteId: string, extra: Record<string, unknown> = {}) => db.guard.create({ data: { guardNo: `${TAG}-${name}`, firstName: name, lastName: "Welfare", phone: `+2637788700${String(++n).padStart(2, "0")}`, nationalId: `${TAG}-${name}`, dateEmployed: new Date(), homeLocationId: siteId, phoneType: "BASIC", ...extra } });
  const mkShift = (guardId: string, locationId: string, startAt: Date, endAt: Date) => db.shift.create({ data: { guardId, locationId, supervisorId: admin.id, startAt, endAt, durationMinutes: Math.round((endAt.getTime() - startAt.getTime()) / 60_000), status: "ON_DUTY", attendance: { create: { status: "PRESENT", arrivalConfirmedAt: startAt } } } });

  const T0 = new Date();
  // Interval 60 from a start 125 minutes ago: points at −65 (too old, skipped), −5 (due), +55, …
  const start = addMinutes(T0, -125), end = addMinutes(T0, 600);

  console.log("SMS channel");
  const smsSite = await mkSite("SMS", { welfareIntervalMinutes: 60, welfareChannel: "SMS", welfareMaxAttempts: 2 });
  const alice = await mkGuard("Alice", smsSite.id);
  const aliceShift = await mkShift(alice.id, smsSite.id, start, end);
  let r = await runWelfareSchedule(T0);
  let cs = await checksOf(aliceShift.id);
  check("a due point creates one check; a point older than 30 min is skipped, not sent late", cs.length === 1 && cs[0].dueAt!.getTime() === addMinutes(start, 120).getTime(), JSON.stringify(cs.map((c) => c.dueAt)));
  check("the check is sent by SMS and the shift waits for the reply", (await welfareTexts(alice.id)) === 1 && (await db.shift.findUniqueOrThrow({ where: { id: aliceShift.id } })).pendingPrompt === "WELFARE");
  r = await runWelfareSchedule(addMinutes(T0, 1));
  check("running again creates nothing twice", (await checksOf(aliceShift.id)).length === 1 && r.created === 0);
  await runWelfareSchedule(addMinutes(T0, 20));
  cs = await checksOf(aliceShift.id);
  check("no reply within the response window: texted again", cs[0].attempts === 2 && (await welfareTexts(alice.id)) === 2);
  await runWelfareSchedule(addMinutes(T0, 40));
  cs = await checksOf(aliceShift.id);
  const aliceAtt = await db.attendance.findUniqueOrThrow({ where: { shiftId: aliceShift.id } });
  check("no reply after the last text: escalated, one missed check, supervisor told", cs[0].response === "NO_RESPONSE" && cs[0].escalatedAt != null && aliceAtt.missedChecks === 1 && (await db.notification.count({ where: { shiftId: aliceShift.id, type: "WELFARE_MISSED" } })) === 1);
  await runWelfareSchedule(addMinutes(T0, 41));
  check("an escalated check is escalated once", (await db.notification.count({ where: { shiftId: aliceShift.id, type: "WELFARE_MISSED" } })) === 1);
  await runWelfareSchedule(addMinutes(T0, 56));
  cs = await checksOf(aliceShift.id);
  check("the next point creates the next check", cs.length === 2);
  await processIncomingMessage({ from: alice.phone, body: "1", provider: "simulated", providerMessageId: `${TAG}-sms-1`, receivedAt: addMinutes(T0, 58) });
  cs = await checksOf(aliceShift.id);
  check("the guard's SMS reply settles the scheduled check", cs[1].response === "WELL");
  const smsEv = await db.attendanceEvidence.findMany({ where: { shiftId: aliceShift.id, kind: "WELFARE" } });
  check("…recorded as SMS evidence, not location", smsEv.length === 1 && smsEv[0].source === "SMS" && !IS_LOCATION_EVIDENCE[smsEv[0].source]);

  console.log("Automated voice call (simulated provider)");
  const voiceSite = await mkSite("VOICE", { welfareIntervalMinutes: 60, welfareChannel: "VOICE", welfareMaxAttempts: 2, welfareRetryMinutes: 10 });
  const bob = await mkGuard("Bob", voiceSite.id);
  const bobShift = await mkShift(bob.id, voiceSite.id, start, end);
  await runWelfareSchedule(T0);
  let [bc] = await checksOf(bobShift.id);
  check("a voice check places a call and keeps its call id", bc.callStatus === "CALL_INITIATED" && bc.provider === "simulated" && Boolean(bc.providerCallId));
  check("no SMS is sent for a voice check", (await welfareTexts(bob.id)) === 0);
  let res = await applyVoiceReport("simulated", true, report(bc.providerCallId!, "answered", null, addMinutes(T0, 1)));
  [bc] = await checksOf(bobShift.id);
  check("answered without a key press is only 'answered', not a response", res.outcome === "status" && bc.callStatus === "CALL_ANSWERED" && bc.response === "PENDING");
  const pressed = report(bc.providerCallId!, "completed", "1", addMinutes(T0, 1));
  res = await applyVoiceReport("simulated", true, pressed);
  [bc] = await checksOf(bobShift.id);
  check("pressing 1 confirms the guard is well", res.outcome === "response" && bc.response === "WELL" && bc.callStatus === "RESPONSE_CONFIRMED" && bc.digits === "1");
  res = await applyVoiceReport("simulated", true, pressed);
  check("the same webhook event twice is applied once", res.outcome === "duplicate");
  const ivr = await db.attendanceEvidence.findFirstOrThrow({ where: { shiftId: bobShift.id, source: "IVR" } });
  check("IVR evidence from the simulated provider is flagged and labelled simulated", ivr.flags.includes("SIMULATED") && evidenceLabel(ivr).label.startsWith("Simulated") && !IS_LOCATION_EVIDENCE.IVR, evidenceLabel(ivr).label);
  res = await applyVoiceReport("simulated", true, report(bc.providerCallId!, "no-answer", null, addMinutes(T0, 2)));
  check("a later status never moves a settled check back", res.outcome === "ignored" && (await checksOf(bobShift.id))[0].response === "WELL");

  console.log("Unanswered calls: retry, busy, SMS fallback, escalation");
  const carol = await mkGuard("Carol", voiceSite.id);
  const carolShift = await mkShift(carol.id, voiceSite.id, start, end);
  await runWelfareSchedule(T0);
  let [cc] = await checksOf(carolShift.id);
  const firstCall = cc.providerCallId!;
  await applyVoiceReport("simulated", true, report(firstCall, "no-answer", null, addMinutes(T0, 1)));
  await runWelfareSchedule(addMinutes(T0, 5));
  [cc] = await checksOf(carolShift.id);
  check("no answer: waits the retry interval", cc.callStatus === "NO_ANSWER" && cc.attempts === 1);
  await runWelfareSchedule(addMinutes(T0, 11));
  [cc] = await checksOf(carolShift.id);
  check("after the interval: called again with a new call", cc.attempts === 2 && cc.providerCallId !== firstCall && cc.callStatus === "CALL_INITIATED");
  res = await applyVoiceReport("simulated", true, report(firstCall, "failed", null, addMinutes(T0, 12), cc.id));
  check("a late status about the first call is ignored", res.outcome === "ignored" && (await checksOf(carolShift.id))[0].callStatus === "CALL_INITIATED");
  await applyVoiceReport("simulated", true, report(cc.providerCallId!, "busy", null, addMinutes(T0, 12)));
  check("a busy line is recorded as busy", (await checksOf(carolShift.id))[0].callStatus === "BUSY");
  await runWelfareSchedule(addMinutes(T0, 22));
  [cc] = await checksOf(carolShift.id);
  check("out of call attempts: the guard is texted instead", cc.smsFallbackAt != null && (await welfareTexts(carol.id)) === 1);
  await runWelfareSchedule(addMinutes(T0, 22 + 21));
  [cc] = await checksOf(carolShift.id);
  check("no reply to the text either: escalated", cc.response === "NO_RESPONSE" && cc.callStatus === "ESCALATED" && (await db.notification.count({ where: { shiftId: carolShift.id, type: "WELFARE_MISSED" } })) === 1);
  res = await applyVoiceReport("simulated", true, report(firstCall, "completed", "1", addMinutes(T0, 45), cc.id));
  [cc] = await checksOf(carolShift.id);
  check("a delayed key press from an earlier call still counts, and the supervisor hears it came late", res.outcome === "response" && res.late && cc.response === "WELL" && (await db.notification.count({ where: { shiftId: carolShift.id, type: "WELFARE_MISSED", severity: "INFO" } })) === 1);

  console.log("Key presses 2 and 3");
  const dan = await mkGuard("Dan", voiceSite.id);
  const danShift = await mkShift(dan.id, voiceSite.id, start, end);
  const eve = await mkGuard("Eve", voiceSite.id);
  const eveShift = await mkShift(eve.id, voiceSite.id, start, end);
  await runWelfareSchedule(T0);
  const [dc] = await checksOf(danShift.id);
  const [ec] = await checksOf(eveShift.id);
  await applyVoiceReport("simulated", true, report(dc.providerCallId!, "completed", "2", addMinutes(T0, 1)));
  const danS = await db.shift.findUniqueOrThrow({ where: { id: danShift.id } });
  const danInc = await db.incident.findFirst({ where: { shiftId: danShift.id } });
  check("2 is a request for assistance: incident, shift needs assistance, supervisor told", danS.status === "ASSISTANCE" && danInc?.category === "ASSISTANCE_REQUEST" && danInc.source === "VOICE" && (await db.notification.count({ where: { shiftId: danShift.id, type: "ASSISTANCE_REQUESTED" } })) === 1);
  await applyVoiceReport("simulated", true, report(ec.providerCallId!, "completed", "3", addMinutes(T0, 1)));
  const eveS = await db.shift.findUniqueOrThrow({ where: { id: eveShift.id } });
  const eveInc = await db.incident.findFirst({ where: { shiftId: eveShift.id } });
  check("3 is an emergency: critical incident, shift critical, emergency alert", eveS.status === "CRITICAL" && eveS.pendingPrompt === "INCIDENT_DESCRIPTION" && eveInc?.category === "EMERGENCY" && eveInc.severity === "CRITICAL" && (await db.notification.count({ where: { shiftId: eveShift.id, type: "EMERGENCY", severity: "CRITICAL" } })) === 1);
  check("simulated responses are labelled as simulated on the incident", Boolean(eveInc?.description.includes("simulated")));

  console.log("No voice provider configured");
  delete process.env.VOICE_PROVIDER;
  const fay = await mkGuard("Fay", voiceSite.id);
  const fayShift = await mkShift(fay.id, voiceSite.id, start, end);
  await runWelfareSchedule(T0);
  const [fc] = await checksOf(fayShift.id);
  check("a voice check with no provider goes straight to SMS, never pretends a call was made", fc.callStatus === "FAILED" && fc.smsFallbackAt != null && fc.providerCallId == null && (await welfareTexts(fay.id)) === 1);
  const gus = await mkGuard("Gus", voiceSite.id, { smsAttendanceEnabled: false });
  const gusShift = await mkShift(gus.id, voiceSite.id, start, end);
  await runWelfareSchedule(T0);
  const [gc] = await checksOf(gusShift.id);
  check("…and with SMS turned off for the guard, escalates at once", gc.response === "NO_RESPONSE" && gc.escalatedAt != null);
  process.env.VOICE_PROVIDER = "simulated";

  console.log("Operations-phone welfare calls");
  const ops = await createGateway({ deviceName: `${TAG} Ops`, phoneNumber: "+263778879999", mode: "OPERATIONS_GATEWAY", actor: { userId: admin.id, name: admin.name } });
  await activateGateway(ops.activationCode!, { appVersion: "1.8.0", androidVersion: "14", deviceModel: "Test", batteryLevel: 90, networkType: "wifi" }, "41.0.0.12");
  await db.gatewayDevice.update({ where: { id: ops.id }, data: { lastSeenAt: new Date(), status: "ONLINE" } });
  const gwSite = await mkSite("GW", { welfareIntervalMinutes: 60, welfareChannel: "GATEWAY_CALL", welfareMaxAttempts: 2, welfareRetryMinutes: 10, defaultGatewayId: ops.id });
  const hal = await mkGuard("Hal", gwSite.id);
  const halShift = await mkShift(hal.id, gwSite.id, start, end);
  await runWelfareSchedule(T0);
  let [hc] = await checksOf(halShift.id);
  const req1 = hc.callRequestId ? await db.callRequest.findUnique({ where: { id: hc.callRequestId } }) : null;
  check("a gateway check queues a call on the operations phone", hc.callStatus === "CALL_INITIATED" && req1?.status === "QUEUED" && req1.reason === "Welfare check", hc.note ?? "");
  await db.callRequest.update({ where: { id: req1!.id }, data: { status: "NO_ANSWER", endedAt: addMinutes(T0, 2) } });
  await db.gatewayDevice.update({ where: { id: ops.id }, data: { lastSeenAt: addMinutes(T0, 11) } }); // the phone keeps heartbeating
  await runWelfareSchedule(addMinutes(T0, 11));
  [hc] = await checksOf(halShift.id);
  check("not answered: the phone is asked to call again", hc.attempts === 2 && hc.callRequestId !== req1!.id, JSON.stringify({ attempts: hc.attempts, status: hc.callStatus, note: hc.note, same: hc.callRequestId === req1!.id }));
  await db.callRequest.update({ where: { id: hc.callRequestId! }, data: { status: "COMPLETED", connectedAt: addMinutes(T0, 12), endedAt: addMinutes(T0, 13) } });
  await runWelfareSchedule(addMinutes(T0, 14));
  [hc] = await checksOf(halShift.id);
  const pend = await db.attendanceEvidence.findFirst({ where: { shiftId: halShift.id, kind: "WELFARE" } });
  check("answered: waits for the operator's word, recorded as a pending call", hc.callStatus === "CALL_ANSWERED" && hc.response === "PENDING" && pend?.status === "PENDING" && pend.source === "CALL");
  await runWelfareSchedule(addMinutes(T0, 50));
  check("an answered operations call is never escalated as unanswered", (await checksOf(halShift.id))[0].escalatedAt == null);
  await decideEvidence(pend!.id, true, { id: admin.id, name: admin.name }, "Spoke to Hal, all fine.");
  check("the operator confirms: the check is settled as well", (await checksOf(halShift.id))[0].response === "WELL");

  console.log("Overnight fixed times, exemptions, unscheduled sites, closed shifts");
  const nightSite = await mkSite("NIGHT", { welfareTimes: "00:00, 03:00", welfareChannel: "SMS" });
  const ida = await mkGuard("Ida", nightSite.id);
  const d = new Date(Date.now() + 3 * 86_400_000);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Harare", year: "numeric", month: "2-digit", day: "2-digit" }).format(d).split("-").map(Number);
  const nStart = zonedWallClockToInstant(parts[0], parts[1], parts[2], 18, 0);
  const nEnd = new Date(nStart.getTime() + 12 * 3600_000);
  const idaShift = await mkShift(ida.id, nightSite.id, nStart, nEnd);
  await runWelfareSchedule(new Date(nStart.getTime() + 6 * 3600_000 + 5 * 60_000)); // 00:05 local
  await runWelfareSchedule(new Date(nStart.getTime() + 9 * 3600_000 + 2 * 60_000)); // 03:02 local
  const ic = await checksOf(idaShift.id);
  check("an 18:00–06:00 shift gets the 00:00 and 03:00 checks, across midnight", ic.length === 2 && ic[0].dueAt!.getTime() === nStart.getTime() + 6 * 3600_000 && ic[1].dueAt!.getTime() === nStart.getTime() + 9 * 3600_000);

  const jon = await mkGuard("Jon", smsSite.id, { welfareExempt: true });
  const jonShift = await mkShift(jon.id, smsSite.id, start, end);
  const plain = await mkSite("PLAIN", {});
  const kim = await mkGuard("Kim", plain.id);
  const kimShift = await mkShift(kim.id, plain.id, start, end);
  await runWelfareSchedule(T0);
  check("an exempt guard gets no scheduled checks", (await checksOf(jonShift.id)).length === 0);
  check("a site without a schedule is left to the single mid-shift check", (await checksOf(kimShift.id)).length === 0);

  const lia = await mkGuard("Lia", smsSite.id);
  const liaShift = await mkShift(lia.id, smsSite.id, start, end);
  await runWelfareSchedule(T0);
  await db.shift.update({ where: { id: liaShift.id }, data: { status: "COMPLETED" } });
  await runWelfareSchedule(addMinutes(T0, 3));
  const [lc] = await checksOf(liaShift.id);
  check("a shift that closes with a check open stops asking and does not escalate", lc.response === "NO_RESPONSE" && lc.escalatedAt == null && (await db.notification.count({ where: { shiftId: liaShift.id, type: "WELFARE_MISSED" } })) === 0);

  console.log("Signed webhook route (HTTP)");
  const up = await fetch(`${BASE}/api/health`).then((x) => x.ok).catch(() => false);
  if (!up) {
    console.log(`  - skipped: no dev server at ${BASE}`);
  } else {
    const mia = await mkGuard("Mia", voiceSite.id);
    const miaShift = await mkShift(mia.id, voiceSite.id, start, end);
    await runWelfareSchedule(T0);
    const [mc] = await checksOf(miaShift.id);
    const body = { eventId: ev(), callId: mc.providerCallId, status: "completed", digits: "1", at: new Date().toISOString(), reference: mc.id };
    let h = await post(body, { sig: "00".repeat(32) });
    check("an unsigned or wrongly signed webhook is refused", h.status === 401 || h.status === 404, String(h.status));
    if (h.status === 404) console.log("    (dev server has no VOICE_PROVIDER=simulated: route refuses every provider)");
    h = await post(body, { ts: Date.now() - 10 * 60_000 });
    check("a webhook older than five minutes is refused (replay)", h.status === 401 || h.status === 404, String(h.status));
    h = await post(body);
    check("a correctly signed webhook is applied", h.status === 200 && h.json.outcome === "response", JSON.stringify(h));
    h = await post(body);
    check("the same signed event resent is a duplicate", h.status === 200 && h.json.outcome === "duplicate", JSON.stringify(h));
    check("the check is settled once", (await checksOf(miaShift.id))[0].response === "WELL");
  }

  await clean();
  console.log(`\n${passed} passed, ${failed} failed`);
  await db.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
