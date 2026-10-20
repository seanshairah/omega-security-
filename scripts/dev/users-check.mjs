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
page.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 300)));
await page.goto(base + "/login"); await page.fill('input[name=email]', (process.env.QA_EMAIL ?? "admin@omegasecurity.co.zw")); await page.fill('input[name=password]', (requirePassword()));
await Promise.all([page.waitForURL("**/dashboard", { timeout: 120000 }), page.click('button[type=submit]')]);
await page.goto(base + "/users", { waitUntil: "networkidle" });
const rows = await page.$$eval("tbody tr", (trs) => trs.map((t) => t.innerText.replace(/\n/g, " | ").slice(0, 120)));
console.log(rows.join("\n"));
const row = page.locator("tr", { hasText: "QA User" }).first();
console.log("buttons in row:", await row.locator("button, a").allInnerTexts());
await row.locator("button:has-text('Deactivate')").click({ timeout: 10000 });
await page.waitForTimeout(500);
console.log("dialog buttons:", await page.locator("div.fixed button").allInnerTexts());
await page.locator("div.fixed button:has-text('Deactivate')").click();
await page.waitForTimeout(2500);
console.log("dialog still open:", await page.locator("div.fixed.inset-0").count(), (await page.locator("div.fixed.inset-0").allInnerTexts()).join(" / ").slice(0, 300));
console.log("after:", await page.locator("tr", { hasText: "QA User" }).first().innerText().then((t) => t.replace(/\n/g, " | ")));
await browser.close();
