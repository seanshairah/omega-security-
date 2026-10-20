import { chromium } from "playwright-core";

/** QA_PASSWORD, which has no default: a real administrator's password used to live here. */
function requirePassword() {
  const p = process.env.QA_PASSWORD;
  if (!p) throw new Error("Set QA_PASSWORD (the seeded demo password locally; never a production one).");
  return p;
}

const base = "http://localhost:3000";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 1500)));
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE", m.text().slice(0, 1500)); });
await page.goto(base + "/login"); await page.fill('input[name=email]', (process.env.QA_EMAIL ?? "admin@omegasecurity.co.zw")); await page.fill('input[name=password]', (requirePassword()));
await Promise.all([page.waitForURL("**/dashboard", { timeout: 120000 }), page.click('button[type=submit]')]);
const inc = (await (await page.request.get(base + "/api/incidents?limit=1")).json()).items[0];
for (const p of [`/incidents/${inc.id}`, "/users/new", "/incidents/new"]) { console.log("==", p); await page.goto(base + p, { waitUntil: "networkidle", timeout: 120000 }); await page.waitForTimeout(1500); }
await browser.close();
