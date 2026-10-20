import { chromium } from "playwright-core";

/** QA_PASSWORD, which has no default: a real administrator's password used to live here. */
function requirePassword() {
  const p = process.env.QA_PASSWORD;
  if (!p) throw new Error("Set QA_PASSWORD (the seeded demo password locally; never a production one).");
  return p;
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("CONSOLE", m.type(), m.text().slice(0, 400)); });
page.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 400)));
await page.goto("http://localhost:3000/login");
await page.fill('input[name=email]', (process.env.QA_EMAIL ?? "admin@omegasecurity.co.zw"));
await page.fill("input[name=password]", (requirePassword()));
await Promise.all([page.waitForURL("**/dashboard"), page.click('button[type=submit]')]);
await page.waitForTimeout(4000);
console.log("svg paths in chart:", await page.locator(".recharts-line").count());
await browser.close();
