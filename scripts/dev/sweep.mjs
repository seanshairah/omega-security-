// Screenshot every screen at several widths and report console/page errors.
import { chromium } from "playwright-core";
import fs from "node:fs";
const out = process.argv[2] || "/tmp/sweep";
fs.mkdirSync(out, { recursive: true });
const widths = { phone: [390, 844], tablet: [820, 1180], desktop: [1440, 900] };
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`PAGEERROR ${page.url()} ${e.message.slice(0, 200)}`));
page.on("console", (m) => { if (m.type() === "error" && !/favicon|404/.test(m.text())) errors.push(`CONSOLE ${page.url()} ${m.text().slice(0, 200)}`); });
await page.goto("http://localhost:3000/login");
await page.fill('input[name=email]', "admin@omegasecurity.co.zw");
await page.fill('input[name=password]', "Zvesh@2000");
await Promise.all([page.waitForURL("**/dashboard", { timeout: 120000 }), page.click('button[type=submit]')]);
const get = async (p) => (await (await page.request.get("http://localhost:3000" + p)).json());
const shift = (await get("/api/shifts/active")).items[0];
const guard = (await get("/api/guards?limit=1")).items[0];
const inc = (await get("/api/incidents?limit=1")).items[0];
const loc = (await get("/api/locations")).items[0];
const client = (await get("/api/clients")).items[0];
const users = (await get("/api/users")).items[0];
const paths = ["/dashboard", "/operations", "/monitoring", "/shifts", "/shifts?view=recurring", "/shifts/new", "/shifts/recurring/new", `/shifts/${shift.id}`, "/attendance", "/incidents", "/incidents/new", `/incidents/${inc.id}`, "/guards", "/guards/new", `/guards/${guard.id}`, `/guards/${guard.id}/edit`, "/clients", "/clients/new", `/clients/${client.id}/edit`, "/locations", "/locations/new", `/locations/${loc.id}`, `/locations/${loc.id}/edit`, "/messages/new", "/sms", "/sms/templates", "/reports", "/users", "/users/new", `/users/${users.id}/edit`, "/settings", "/audit", "/notifications", "/simulator"];
const overflow = [];
for (const [name, [w, h]] of Object.entries(widths)) {
  await page.setViewportSize({ width: w, height: h });
  for (const p of paths) {
    await page.goto("http://localhost:3000" + p, { waitUntil: "networkidle", timeout: 120000 });
    await page.waitForTimeout(250);
    const sw = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
    if (sw > w + 2) overflow.push(`${name} ${p} scrollWidth=${sw} > ${w}`);
    const file = `${out}/${name}-${p.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "root"}.png`;
    await page.screenshot({ path: file, fullPage: true });
  }
}
console.log("OVERFLOW:\n" + (overflow.join("\n") || "none"));
console.log("ERRORS:\n" + ([...new Set(errors)].join("\n") || "none"));
await browser.close();
