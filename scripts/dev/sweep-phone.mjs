import { chromium } from "playwright-core";
import fs from "node:fs";

/** QA_PASSWORD, which has no default: a real administrator's password used to live here. */
function requirePassword() {
  const p = process.env.QA_PASSWORD;
  if (!p) throw new Error("Set QA_PASSWORD (the seeded demo password locally; never a production one).");
  return p;
}

const out = process.argv[2]; fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
await page.goto("http://localhost:3000/login"); await page.fill('input[name=email]', (process.env.QA_EMAIL ?? "admin@omegasecurity.co.zw")); await page.fill('input[name=password]', (requirePassword()));
await Promise.all([page.waitForURL("**/dashboard", { timeout: 120000 }), page.click('button[type=submit]')]);
const get = async (p) => (await (await page.request.get("http://localhost:3000" + p)).json());
const guard = (await get("/api/guards?limit=1")).items[0]; const loc = (await get("/api/locations")).items[0];
const overflow = [];
for (const p of ["/operations", "/guards", "/shifts", "/incidents", "/sms", `/guards/${guard.id}`, `/locations/${loc.id}`, "/reports", "/settings", "/simulator", "/monitoring"]) {
  await page.goto("http://localhost:3000" + p, { waitUntil: "networkidle", timeout: 120000 });
  const sw = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
  if (sw > 392) overflow.push(`${p} scrollWidth=${sw}`);
  await page.screenshot({ path: `${out}/${p.replace(/[^a-z0-9]+/gi, "_").replace(/^_/, "")}.png`, fullPage: true });
}
console.log("OVERFLOW: " + (overflow.join("; ") || "none"));
await browser.close();
