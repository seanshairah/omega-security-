/**
 * Edit and delete a shift against a real database: the policy rules, the overlap guard, the
 * config-version bump that guard phones watch, and the refusal to destroy operational history.
 *   npx tsx scripts/dev/shift-edit-e2e.ts
 */
process.env.SMS_PROVIDER = "simulated";
import { config } from "dotenv"; config();
const dbUrl = process.env.DATABASE_URL ?? "";
if (!/localhost|127\.0\.0\.1/.test(dbUrl) && process.env.ALLOW_LIVE_DB !== "1") {
  console.error("Refusing to run against a non-local DATABASE_URL.");
  process.exit(2);
}
import { addHours, addDays } from "date-fns";
import { db } from "../../src/lib/db";
import { createShift, updateShift, deleteShift, shiftTraceCounts } from "../../src/lib/services/shifts";

let passed = 0, failed = 0;
const check = (name: string, ok: boolean, detail = "") => { if (ok) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name} ${detail}`); } };
async function refuses(name: string, fn: () => Promise<unknown>, pattern: RegExp) {
  try { await fn(); check(name, false, "no error thrown"); }
  catch (e) { const m = (e as Error).message; check(name, pattern.test(m), `got: ${m}`); }
}

const TAG = "SHIFTEDIT";
async function clean() {
  const shifts = await db.shift.findMany({ where: { notes: { startsWith: TAG } }, select: { id: true } });
  const ids = shifts.map((x) => x.id);
  if (ids.length) {
    await db.locationEvent.deleteMany({ where: { shiftId: { in: ids } } });
    await db.smsMessage.deleteMany({ where: { shiftId: { in: ids } } });
    await db.shiftCheckIn.deleteMany({ where: { shiftId: { in: ids } } });
    await db.welfareCheck.deleteMany({ where: { shiftId: { in: ids } } });
    await db.attendance.deleteMany({ where: { shiftId: { in: ids } } });
    await db.shift.deleteMany({ where: { id: { in: ids } } });
  }
  await db.guard.deleteMany({ where: { guardNo: { in: [`${TAG}-1`, `${TAG}-2`] } } });
}

async function main() {
  await clean();
  const admin = await db.user.findFirstOrThrow({ where: { role: "SUPER_ADMIN" } });
  const actor = { userId: admin.id, name: admin.name };
  const sites = await db.location.findMany({ take: 2, orderBy: { name: "asc" } });
  if (sites.length < 2) throw new Error("need two sites");
  const g1 = await db.guard.create({ data: { guardNo: `${TAG}-1`, firstName: "Edit", lastName: "Tester", phone: "+263779900101", nationalId: `${TAG}-1`, dateEmployed: new Date(), homeLocationId: sites[0].id } });
  const g2 = await db.guard.create({ data: { guardNo: `${TAG}-2`, firstName: "Other", lastName: "Tester", phone: "+263779900102", nationalId: `${TAG}-2`, dateEmployed: new Date(), homeLocationId: sites[0].id } });

  const base = addDays(new Date(), 3);
  const shift = await createShift({ guardId: g1.id, locationId: sites[0].id, startAt: base, endAt: addHours(base, 8), notes: `${TAG} main`, actorUserId: admin.id, actorName: admin.name });
  check("a shift starts at config version 1", shift.configVersion === 1, String(shift.configVersion));

  // ---- editing the paperwork only ----
  const paperwork = await updateShift(shift.id, { guardId: g1.id, locationId: sites[0].id, startAt: shift.startAt, endAt: shift.endAt, instructions: "Check the back gate", notes: `${TAG} main` }, actor);
  check("instructions can be corrected", paperwork.instructions === "Check the back gate");
  check("paperwork alone does not bump the config version", paperwork.configVersion === 1, String(paperwork.configVersion));

  // ---- moving the schedule ----
  const moved = await updateShift(shift.id, { guardId: g1.id, locationId: sites[1].id, startAt: addHours(base, 2), endAt: addHours(base, 10), notes: `${TAG} main` }, actor);
  check("the site can be changed while the shift has not started", moved.locationId === sites[1].id);
  check("the times can be changed", moved.startAt.getTime() === addHours(base, 2).getTime());
  check("duration is recomputed", moved.durationMinutes === 480, String(moved.durationMinutes));
  check("moving the schedule bumps the config version for the phones", moved.configVersion === 2, String(moved.configVersion));

  const audited = await db.auditLog.findFirst({ where: { entity: "Shift", entityId: shift.id, action: "SHIFT_UPDATED" }, orderBy: { createdAt: "desc" } });
  check("the edit is written to the audit log", !!audited);
  const timeline = await db.shiftCheckIn.findFirst({ where: { shiftId: shift.id, type: "ADMIN_NOTE" }, orderBy: { at: "desc" } });
  check("the edit appears on the shift timeline", !!timeline && /edited by/i.test(timeline.note ?? ""), timeline?.note ?? "no ADMIN_NOTE row");

  // ---- the overlap guard still applies on edit ----
  const clash = await createShift({ guardId: g2.id, locationId: sites[0].id, startAt: addHours(base, 3), endAt: addHours(base, 9), notes: `${TAG} clash`, actorUserId: admin.id });
  await refuses("an edit cannot move a guard onto an overlapping shift", () =>
    updateShift(clash.id, { guardId: g1.id, locationId: sites[0].id, startAt: addHours(base, 3), endAt: addHours(base, 9), notes: `${TAG} clash` }, actor), /overlap/i);
  await refuses("an edit cannot make the end precede the start", () =>
    updateShift(clash.id, { guardId: g2.id, locationId: sites[0].id, startAt: addHours(base, 9), endAt: addHours(base, 3), notes: `${TAG} clash` }, actor), /after the start/i);

  // ---- the schedule locks once the guard has been checked ----
  await db.shift.update({ where: { id: shift.id }, data: { arrivalSmsSentAt: new Date(), status: "AWAITING_ARRIVAL" } });
  await refuses("the schedule locks once the arrival check has been sent", () =>
    updateShift(shift.id, { guardId: g1.id, locationId: sites[0].id, startAt: base, endAt: addHours(base, 8), notes: `${TAG} main` }, actor), /already been sent|fixed/i);
  const stillEditable = await updateShift(shift.id, { guardId: g1.id, locationId: sites[1].id, startAt: addHours(base, 2), endAt: addHours(base, 10), instructions: "Updated after the check", notes: `${TAG} main` }, actor);
  check("the paperwork is still editable after the check went out", stillEditable.instructions === "Updated after the check");

  // ---- deleting ----
  const disposable = await createShift({ guardId: g2.id, locationId: sites[0].id, startAt: addDays(base, 2), endAt: addHours(addDays(base, 2), 6), notes: `${TAG} disposable`, actorUserId: admin.id });
  const counts = await shiftTraceCounts(disposable.id);
  check("a fresh shift has no operational trace", Object.values(counts).every((n) => n === 0), JSON.stringify(counts));
  await deleteShift(disposable.id, actor);
  check("a shift nothing has touched is deleted", (await db.shift.findUnique({ where: { id: disposable.id } })) === null);
  check("its attendance row goes with it", (await db.attendance.findFirst({ where: { shiftId: disposable.id } })) === null);
  check("the deletion is written to the audit log", !!(await db.auditLog.findFirst({ where: { entity: "Shift", entityId: disposable.id, action: "SHIFT_DELETED" } })));

  // ---- deletion refuses to destroy history ----
  const withHistory = await createShift({ guardId: g2.id, locationId: sites[0].id, startAt: addDays(base, 4), endAt: addHours(addDays(base, 4), 6), notes: `${TAG} history`, actorUserId: admin.id });
  await db.smsMessage.create({ data: { guardId: g2.id, shiftId: withHistory.id, direction: "OUTBOUND", channel: "SMS", type: "ARRIVAL", fromNumber: "OMEGA", toNumber: g2.phone, provider: "simulated", body: "Arrival check", status: "SENT" } });
  await refuses("a shift with a sent message cannot be deleted", () => deleteShift(withHistory.id, actor), /1 message|Cancel it instead/i);
  check("the shift with history is still there", (await db.shift.findUnique({ where: { id: withHistory.id } })) !== null);

  const arrived = await createShift({ guardId: g2.id, locationId: sites[0].id, startAt: addDays(base, 6), endAt: addHours(addDays(base, 6), 6), notes: `${TAG} arrived`, actorUserId: admin.id });
  await db.attendance.update({ where: { shiftId: arrived.id }, data: { arrivalConfirmedAt: new Date(), status: "PRESENT" } });
  await refuses("a shift with an attendance record cannot be deleted", () => deleteShift(arrived.id, actor), /attendance/i);

  await db.shift.update({ where: { id: arrived.id }, data: { status: "COMPLETED" } });
  await refuses("a completed shift cannot be edited", () =>
    updateShift(arrived.id, { guardId: g2.id, locationId: sites[0].id, startAt: addDays(base, 6), endAt: addHours(addDays(base, 6), 7), notes: `${TAG} arrived` }, actor), /closed shift|cannot be edited/i);

  await clean();
  check("test data removed", (await db.shift.count({ where: { notes: { startsWith: TAG } } })) === 0);
}

main()
  .then(() => { console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0); })
  .catch(async (e) => { console.error(e); await clean().catch(() => {}); process.exit(1); })
  .finally(() => db.$disconnect());
