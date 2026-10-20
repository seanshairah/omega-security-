/**
 * End-to-end checks for the APK distribution channel.
 *
 * The important assertions are the refusals. This is the only way an APK reaches a guard's phone,
 * so "serves the file" is less interesting than "refuses to serve the wrong file to the wrong
 * person": an unauthenticated download, or a build signed with the public Android debug key.
 *
 *   node scripts/dev/app-release-e2e.mjs
 */
import { chromium } from "playwright-core";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const EMAIL = process.env.QA_EMAIL ?? "admin@omegasecurity.co.zw";
const PASSWORD = process.env.QA_PASSWORD ?? "Demo12345!";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` ${detail}` : ""}`); }
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const ctx = await browser.newContext();
const page = await ctx.newPage();

// --- Unauthenticated ---------------------------------------------------------
for (const path of ["/api/app/download", "/api/app/version"]) {
  const r = await ctx.request.get(BASE + path);
  check(`${path} refuses an unauthenticated caller`, r.status() === 401, `got ${r.status()}`);
}

// --- Signed in ---------------------------------------------------------------
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.fill("input[name=email]", EMAIL);
await page.fill("input[name=password]", PASSWORD);
await Promise.all([page.waitForURL("**/dashboard", { timeout: 120000 }), page.click("button[type=submit]")]);
check("signed in", page.url().includes("/dashboard"));

const vr = await ctx.request.get(`${BASE}/api/app/version`);
check("/api/app/version answers a signed-in admin", vr.ok(), `got ${vr.status()}`);
const v = await vr.json().catch(() => ({}));

// The APK committed to this repo is debug-signed, so the channel must be closed.
check("the version endpoint reports the build as not distributable", v.available === false, JSON.stringify(v).slice(0, 120));
check("it names the debug key as the reason", /debug key/i.test(v.reason ?? ""), v.reason ?? "(no reason)");
check("it offers no download URL while refusing", v.downloadUrl === null || v.downloadUrl === undefined);
check("it still reports the version it is refusing", typeof v.versionName === "string" && v.versionName.length > 0);

const dr = await ctx.request.get(`${BASE}/api/app/download`);
check("the download is refused with 409, not served", dr.status() === 409, `got ${dr.status()}`);
const body = await dr.json().catch(() => ({}));
check("the refusal explains what to do", /keystore/i.test(body.detail ?? ""), body.detail ?? "(no detail)");
const ct = dr.headers()["content-type"] ?? "";
check("no APK bytes leak on the refusal path", !ct.includes("android.package-archive"), ct);

// --- The portal says so, rather than looking empty ---------------------------
await page.goto(`${BASE}/gateways`, { waitUntil: "networkidle" });
const text = await page.evaluate(() => document.body.innerText);
check("the devices page states the build cannot be handed out", /debug key/i.test(text));
check("the devices page does not offer a download while refusing", !/Download APK/i.test(text));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
