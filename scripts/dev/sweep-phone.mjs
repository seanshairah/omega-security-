import { chromium } from "playwright-core";
import fs from "node:fs";
const out = process.argv[2]; fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
await page.goto("http://localhost:3000/login"); await page.fill('input[name=email]', "admin@omegasecurity.co.zw"); await page.fill('input[name=password]', "Zvesh@2000");
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
