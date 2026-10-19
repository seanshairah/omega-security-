/**
 * Remote guard-phone location requests, over real HTTP: admin creates a request (session cookie),
 * the phone fetches it as a REQUEST_LOCATION command (heartbeat and GET /api/gateways/commands),
 * acknowledges PROCESSING and answers with a LOCATION_REQUEST_RESULT event through the ordinary
 * events endpoint. Covers idempotency, replay, device binding, expiry, poor accuracy, mock flag,
 * plausibility of capturedAt, cancellation and the "use as site coordinates" handoff.
 * Tagged data: client LRQ-E2E, site "Granite Depot (E2E)", guard G-E2E09, device "E2E LRQ …". Removed at the end.
 *
 *   npx tsx scripts/dev/location-request-e2e.ts        (needs npm run dev; admin login via QA_EMAIL/QA_PASSWORD)
 */
process.env.SMS_PROVIDER = process.env.SMS_PROVIDER || "simulated";
import { config } from "dotenv"; config();
const dbUrl = process.env.DATABASE_URL ?? "";
if (!/localhost|127\.0\.0\.1/.test(dbUrl) && process.env.ALLOW_LIVE_DB !== "1") { console.error("Refusing to run against a non-local DATABASE_URL."); process.exit(2); }
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { createGateway } from "../../src/lib/gateway/service";
import { expireStaleRequests } from "../../src/lib/gateway/location-requests";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const SITE = { latitude: -17.8292, longitude: 31.0522, radius: 150 };
const GUARD_PHONE = "+263779900791";
let passed = 0, failed = 0;
const check = (name: string, ok: boolean, detail = "") => { if (ok) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name} ${detail}`); } };
type R = { status: number; json: Record<string, any> };
let cookie = "";
const call = async (method: string, path: string, body?: unknown, token?: string): Promise<R> => {
  const r = await fetch(`${BASE}${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, any> };
};
const result = (requestId: string, extra: Record<string, any>): Record<string, any> => ({ eventId: randomUUID(), eventType: "LOCATION_REQUEST_RESULT", timestamp: new Date().toISOString(), requestId, ...extra });
const fixAt = (offsetM: number, acc: number, at = new Date()) => ({ status: "COMPLETED", latitude: SITE.latitude + offsetM / 111_000, longitude: SITE.longitude, accuracyM: acc, provider: "gps", capturedAt: at.toISOString(), mock: false });

async function cleanup() {
  const guards = await db.guard.findMany({ where: { guardNo: "G-E2E09" }, select: { id: true } });
  const gIds = guards.map((g) => g.id);
  const gws = await db.gatewayDevice.findMany({ where: { deviceName: { startsWith: "E2E LRQ" } }, select: { id: true } });
  const gwIds = gws.map((g) => g.id);
  await db.$transaction([
    db.deviceLocationRequest.deleteMany({ where: { OR: [{ gatewayDeviceId: { in: gwIds } }, { guardId: { in: gIds } }] } }),
    db.locationEvent.deleteMany({ where: { gatewayDeviceId: { in: gwIds } } }), db.gatewayEvent.deleteMany({ where: { gatewayDeviceId: { in: gwIds } } }),
    db.notification.deleteMany({ where: { guardId: { in: gIds } } }), db.shift.deleteMany({ where: { guardId: { in: gIds } } }),
    db.gatewayDevice.deleteMany({ where: { id: { in: gwIds } } }), db.guard.deleteMany({ where: { id: { in: gIds } } }),
    db.location.deleteMany({ where: { code: "LRQ-E2E-01" } }), db.client.deleteMany({ where: { code: "LRQ-E2E" } }),
    db.auditLog.deleteMany({ where: { entityId: { in: [...gwIds, ...gIds] } } }),
  ]);
}

async function main() {
  if ((await fetch(`${BASE}/api/health`).then((r) => r.status).catch(() => 0)) !== 200) throw new Error(`Server at ${BASE} not reachable.`);
  await cleanup();
  const admin = await db.user.findFirstOrThrow({ where: { role: "SUPER_ADMIN", active: true } });
  const actor = { userId: admin.id, name: admin.name };
  const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: process.env.QA_EMAIL ?? admin.email, password: process.env.QA_PASSWORD ?? "Zvesh@2000" }) });
  if (login.status !== 200) throw new Error(`admin login failed (${login.status}); set QA_EMAIL/QA_PASSWORD`);
  cookie = (login.headers.getSetCookie?.() ?? [login.headers.get("set-cookie") ?? ""]).map((c) => c.split(";")[0]).join("; ");

  console.log("Setup: client, site, Android guard, guard device, operations gateway");
  const client = await db.client.create({ data: { code: "LRQ-E2E", name: "Location Request Client (E2E)", contactPhone: "+263242000199" } });
  const site = await db.location.create({ data: { code: "LRQ-E2E-01", name: "Granite Depot (E2E)", clientId: client.id, address: "Granite Rd", supervisorId: admin.id, latitude: SITE.latitude, longitude: SITE.longitude, geofenceRadiusM: SITE.radius, coordinatesSource: "MAP" } });
  const guard = await db.guard.create({ data: { guardNo: "G-E2E09", firstName: "Tendai", lastName: "Chikwanha", phone: GUARD_PHONE, nationalId: "E2E-63-9", dateEmployed: new Date(), homeLocationId: site.id } });
  const guardDev = await createGateway({ deviceName: "E2E LRQ guard phone", phoneNumber: GUARD_PHONE, mode: "GUARD", guardId: guard.id, locationId: site.id, actor });
  const otherDev = await createGateway({ deviceName: "E2E LRQ other phone", phoneNumber: "+263779900792", locationId: site.id, actor });
  try {
    const a1 = await call("POST", "/api/gateways/activate", { activationCode: guardDev.activationCode, appVersion: "1.5.0", androidVersion: "13", locationPermission: "background" });
    const gt = a1.json.deviceToken as string;
    const a2 = await call("POST", "/api/gateways/activate", { activationCode: otherDev.activationCode, appVersion: "1.5.0" });
    const ot = a2.json.deviceToken as string;
    check("devices activate", a1.status === 200 && a2.status === 200);

    console.log("Create and deliver");
    const noPhone = await call("POST", `/api/guards/${randomUUID()}/location-requests`, {});
    check("unknown guard → 404", noPhone.status === 404, String(noPhone.status));
    const c1 = await call("POST", `/api/guards/${guard.id}/location-requests`, { purpose: "CHECK" });
    check("admin creates a request → 201 PENDING with deadline and accuracy limit", c1.status === 201 && c1.json.request?.status === "PENDING" && c1.json.request.maxAccuracyM > 0 && new Date(c1.json.request.expiresAt) > new Date(), JSON.stringify(c1.json));
    const req1 = c1.json.request;
    const c1b = await call("POST", `/api/guards/${guard.id}/location-requests`, { purpose: "CHECK" });
    check("asking again while open reuses the same request (idempotent, 200)", c1b.status === 200 && c1b.json.reused === true && c1b.json.request.id === req1.id);
    check("audit row LOCATION_REQUESTED", Boolean(await db.auditLog.findFirst({ where: { action: "LOCATION_REQUESTED", entityId: guard.id } })));
    const unauth = await fetch(`${BASE}/api/guards/${guard.id}/location-requests`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    check("no session → 401/403", [401, 403].includes(unauth.status), String(unauth.status));

    const cmdOther = await call("GET", "/api/gateways/commands", undefined, ot);
    check("another device sees no commands (scoped to the addressed device)", cmdOther.status === 200 && cmdOther.json.commands.length === 0);
    const hb = await call("POST", "/api/gateways/heartbeat", { appVersion: "1.5.0", batteryLevel: 80 }, gt);
    check("heartbeat carries the REQUEST_LOCATION command without any coordinate", hb.status === 200 && hb.json.commands?.length === 1 && hb.json.commands[0].type === "REQUEST_LOCATION" && hb.json.commands[0].id === req1.id && !("latitude" in hb.json.commands[0]) && typeof hb.json.commandPollSeconds === "number", JSON.stringify(hb.json.commands));
    const g1 = await call("GET", `/api/guards/${guard.id}/location-requests/${req1.id}`);
    check("request shows DELIVERED after the heartbeat", g1.json.request?.status === "DELIVERED" && g1.json.request.deliveredAt, JSON.stringify(g1.json.request?.status));
    const cmd2 = await call("GET", "/api/gateways/commands", undefined, gt);
    check("redelivery keeps the same id and state (no duplicate request)", cmd2.json.commands.length === 1 && cmd2.json.commands[0].id === req1.id && (await db.deviceLocationRequest.count({ where: { gatewayDeviceId: guardDev.id } })) === 1);
    const ackOther = await call("POST", `/api/gateways/commands/${req1.id}/ack`, { status: "PROCESSING" }, ot);
    check("another device cannot acknowledge it", ackOther.status === 404, String(ackOther.status));
    const ack = await call("POST", `/api/gateways/commands/${req1.id}/ack`, { status: "PROCESSING" }, gt);
    check("phone acknowledges → PROCESSING", ack.status === 200 && ack.json.status === "PROCESSING");
    const summary = await call("GET", `/api/guards/${guard.id}/location-requests`);
    check("panel summary: device, site, request status PROCESSING", summary.status === 200 && summary.json.device?.id === guardDev.id && summary.json.site?.id === site.id && summary.json.requests[0]?.status === "PROCESSING", JSON.stringify(summary.json.requests?.[0]?.status));

    console.log("Answer, replay, binding");
    const wrongDevice = await call("POST", "/api/gateways/events", { events: [result(req1.id, fixAt(10, 15))] }, ot);
    check("result from another device is stored but rejected for the request", wrongDevice.status === 200 && (await db.deviceLocationRequest.findUniqueOrThrow({ where: { id: req1.id } })).status === "PROCESSING");
    const res1 = result(req1.id, fixAt(12, 18));
    const ok1 = await call("POST", "/api/gateways/events", { events: [res1] }, gt);
    const r1 = await db.deviceLocationRequest.findUniqueOrThrow({ where: { id: req1.id } });
    check("phone's result completes the request with coordinates, accuracy, provider, capturedAt", ok1.json.acks?.[0]?.status === "ok" && r1.status === "COMPLETED" && r1.accuracyM === 18 && r1.provider === "gps" && r1.resultEventId === res1.eventId && Boolean(r1.capturedAt), JSON.stringify({ ack: ok1.json.acks?.[0], status: r1.status }));
    const replay = await call("POST", "/api/gateways/events", { events: [res1] }, gt);
    check("replayed result is a duplicate, nothing changes", replay.json.acks?.[0]?.status === "duplicate");
    const late = await call("POST", "/api/gateways/events", { events: [result(req1.id, fixAt(500, 10))] }, gt);
    const r1b = await db.deviceLocationRequest.findUniqueOrThrow({ where: { id: req1.id } });
    check("a second result for a completed request never overwrites it", late.status === 200 && r1b.latitude === r1.latitude && r1b.resultEventId === res1.eventId);
    const view = await call("GET", `/api/guards/${guard.id}/location-requests/${req1.id}`);
    check("portal view: distance from site, geofence INSIDE, age, status COMPLETED", view.json.request?.status === "COMPLETED" && view.json.request.site?.distanceM <= 15 && view.json.request.site.state === "INSIDE" && typeof view.json.request.ageSeconds === "number", JSON.stringify(view.json.request?.site));
    const dev1 = await db.gatewayDevice.findUniqueOrThrow({ where: { id: guardDev.id } });
    check("device's last known location updated from the requested fix", dev1.lastLatitude != null && Math.abs(dev1.lastLatitude - res1.latitude) < 1e-9 && dev1.lastLocationState === "INSIDE");

    console.log("Failure reasons, poor accuracy, mock, plausibility");
    const c2 = await call("POST", `/api/guards/${guard.id}/location-requests`, { purpose: "CHECK", maxAccuracyM: 50 });
    const req2 = c2.json.request;
    await call("POST", "/api/gateways/events", { events: [result(req2.id, fixAt(10, 140))] }, gt);
    const r2 = await db.deviceLocationRequest.findUniqueOrThrow({ where: { id: req2.id } });
    check("fix worse than the limit → FAILED POOR_ACCURACY, coordinates kept for information", r2.status === "FAILED" && r2.failureReason === "POOR_ACCURACY" && r2.latitude != null, `${r2.status} ${r2.failureReason}`);
    const retryBtn = await call("POST", `/api/guards/${guard.id}/location-requests`, {});
    const req3 = retryBtn.json.request;
    check("retry after a failure creates a new request", retryBtn.status === 201 && req3.id !== req2.id);
    const badReason = await call("POST", "/api/gateways/events", { events: [result(req3.id, { status: "FAILED", failureReason: "SOMETHING" })] }, gt);
    check("unknown failure reason is rejected by validation", badReason.json.acks?.[0]?.status === "rejected");
    const noCoords = await call("POST", "/api/gateways/events", { events: [result(req3.id, { status: "COMPLETED", accuracyM: 10, capturedAt: new Date().toISOString() })] }, gt);
    check("COMPLETED without coordinates is rejected", noCoords.json.acks?.[0]?.status === "rejected");
    await call("POST", "/api/gateways/events", { events: [result(req3.id, { status: "FAILED", failureReason: "PERMISSION_DENIED" })] }, gt);
    check("structured failure PERMISSION_DENIED recorded", (await db.deviceLocationRequest.findUniqueOrThrow({ where: { id: req3.id } })).failureReason === "PERMISSION_DENIED");
    const c4 = await call("POST", `/api/guards/${guard.id}/location-requests`, {});
    const req4 = c4.json.request;
    await call("POST", "/api/gateways/events", { events: [result(req4.id, { ...fixAt(10, 12), mock: true })] }, gt);
    const r4 = await db.deviceLocationRequest.findUniqueOrThrow({ where: { id: req4.id } });
    const dev4 = await db.gatewayDevice.findUniqueOrThrow({ where: { id: guardDev.id } });
    check("mock fix completes but is flagged, device marked, last location NOT replaced by it", r4.status === "COMPLETED" && r4.mock && dev4.mockLocationSeen && dev4.lastLocationAt?.getTime() === dev1.lastLocationAt?.getTime(), JSON.stringify({ status: r4.status, mock: r4.mock, seen: dev4.mockLocationSeen, at4: dev4.lastLocationAt, at1: dev1.lastLocationAt }));
    const c5 = await call("POST", `/api/guards/${guard.id}/location-requests`, {});
    const req5 = c5.json.request;
    await call("POST", "/api/gateways/events", { events: [result(req5.id, fixAt(10, 12, new Date(Date.now() - 3_600_000)))] }, gt);
    const r5 = await db.deviceLocationRequest.findUniqueOrThrow({ where: { id: req5.id } });
    check("a fix captured an hour before the request cannot answer it (REQUEST_EXPIRED / implausible)", r5.status === "FAILED" && r5.failureReason === "REQUEST_EXPIRED", `${r5.status} ${r5.failureReason} ${r5.failureDetail}`);

    console.log("Expiry and cancellation");
    const c6 = await call("POST", `/api/guards/${guard.id}/location-requests`, {});
    const req6 = c6.json.request;
    await db.deviceLocationRequest.update({ where: { id: req6.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const cmdExpired = await call("GET", "/api/gateways/commands", undefined, gt);
    check("an expired request is not delivered and becomes EXPIRED", cmdExpired.json.commands.every((c: any) => c.id !== req6.id) && (await db.deviceLocationRequest.findUniqueOrThrow({ where: { id: req6.id } })).status === "EXPIRED");
    const lateAnswer = await call("POST", "/api/gateways/events", { events: [result(req6.id, fixAt(10, 12))] }, gt);
    check("an answer to an expired request is ignored (status stays EXPIRED)", lateAnswer.status === 200 && (await db.deviceLocationRequest.findUniqueOrThrow({ where: { id: req6.id } })).status === "EXPIRED");
    const c7 = await call("POST", `/api/guards/${guard.id}/location-requests`, {});
    const req7 = c7.json.request;
    const cancel = await call("DELETE", `/api/guards/${guard.id}/location-requests/${req7.id}`);
    check("operations cancels an open request → CANCELLED", cancel.status === 200 && cancel.json.request.status === "CANCELLED");
    check("cancelled request is not delivered to the phone", (await call("GET", "/api/gateways/commands", undefined, gt)).json.commands.length === 0);
    check("expireStaleRequests is idempotent", (await expireStaleRequests()) === 0);

    console.log("Rate limit and eligibility");
    let limited: R | null = null;
    for (let i = 0; i < 14; i++) { const r = await call("POST", `/api/guards/${guard.id}/location-requests`, {}); if (r.status === 429) { limited = r; break; } if (r.status === 201) await call("DELETE", `/api/guards/${guard.id}/location-requests/${r.json.request.id}`); }
    check("per-device hourly limit → 429", limited?.status === 429, String(limited?.status));
    await db.gatewayDevice.update({ where: { id: guardDev.id }, data: { status: "DISABLED" } });
    const disabled = await call("POST", `/api/guards/${guard.id}/location-requests`, {});
    check("disabled device → 404 (no eligible device)", disabled.status === 404, String(disabled.status));
    await db.gatewayDevice.update({ where: { id: guardDev.id }, data: { status: "ONLINE" } });

    console.log("Workspace status and activity APIs");
    const st = await call("GET", `/api/guards/${guard.id}/status`);
    const lr = await call("GET", `/api/guards/${guard.id}/location-requests`);
    check("status and location panels name the same device (one selection rule)", st.status === 200 && st.json.device?.id === guardDev.id && lr.json.device?.id === st.json.device.id, JSON.stringify({ st: st.json.device?.id, lr: lr.json.device?.id }));
    check("status: four location concepts present and consistent with the accepted fix", st.json.presentation?.connection?.state === "ONLINE" && st.json.presentation.position?.source === "REQUESTED" && st.json.presentation.position.accuracyM === 18 && st.json.presentation.geofence?.assessment === "INSIDE", JSON.stringify(st.json.presentation));
    const act = await call("GET", `/api/guards/${guard.id}/activity?limit=10`);
    check("activity feed merges requests and device events newest first", act.status === 200 && act.json.items.length > 0 && act.json.items.some((i: any) => i.category === "request") && act.json.items.every((i: any, n: number, arr: any[]) => n === 0 || arr[n - 1].at >= i.at), JSON.stringify(act.json.items?.slice(0, 2)));
    const onlyReq = await call("GET", `/api/guards/${guard.id}/activity?cat=request&limit=5`);
    check("activity feed filters by category", onlyReq.json.items.every((i: any) => i.category === "request") && onlyReq.json.items.length > 0);
    if (act.json.nextBefore) { const page2 = await call("GET", `/api/guards/${guard.id}/activity?limit=10&before=${encodeURIComponent(act.json.nextBefore)}`); check("activity feed pages by time cursor without repeating items", page2.json.items.every((i: any) => !act.json.items.some((j: any) => j.id === i.id))); }
    const unauthStatus = await fetch(`${BASE}/api/guards/${guard.id}/status`);
    check("status API needs a session", [401, 403].includes(unauthStatus.status));

    console.log("Site handoff");
    const edit = await fetch(`${BASE}/locations/${site.id}/edit?fromRequest=${req1.id}`, { headers: { cookie } });
    const html = await edit.text();
    check("site form opened from a completed request shows the fix as a candidate awaiting confirmation", edit.status === 200 && html.includes("Measured position, not yet saved") && html.includes("Replace site centre"), String(edit.status));
    const editMock = await fetch(`${BASE}/locations/${site.id}/edit?fromRequest=${req4.id}`, { headers: { cookie } });
    check("a mock fix is never offered as a site candidate", editMock.status === 200 && !(await editMock.text()).includes("Measured position, not yet saved"));
    const before = await db.location.findUniqueOrThrow({ where: { id: site.id } });
    check("the site's coordinates were not changed by any request", before.latitude === SITE.latitude && before.coordinatesSource === "MAP" && before.configVersion === 1);
    const newShift = await fetch(`${BASE}/shifts/new?locationId=${site.id}`, { headers: { cookie } });
    check("new-shift page renders the site selector with coordinates", newShift.status === 200 && (await newShift.text()).includes("shift-site-coords"));
  } finally {
    await cleanup();
    console.log(`\n${passed} passed, ${failed} failed · test data removed`);
    if (failed) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
