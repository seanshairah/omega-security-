import { chromium } from "playwright-core";
import fs from "node:fs";

/** QA_PASSWORD, which has no default: a real administrator's password used to live here. */
function requirePassword() {
  const p = process.env.QA_PASSWORD;
  if (!p) throw new Error("Set QA_PASSWORD (the seeded demo password locally; never a production one).");
  return p;
}

const [,, path, out, w = "1440", h = "960"] = process.argv;
const exe = fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : fs.readdirSync("/opt/pw-browsers").filter(d=>d.startsWith("chromium")).map(d=>`/opt/pw-browsers/${d}/chrome-linux/chrome`).find(p=>fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto("http://localhost:3000/login");
await page.fill('input[name=email]', (process.env.QA_EMAIL ?? "admin@omegasecurity.co.zw"));
await page.fill("input[name=password]", (requirePassword()));
await Promise.all([page.waitForURL("**/dashboard"), page.click('button[type=submit]')]);
await page.goto("http://localhost:3000" + path, { waitUntil: "networkidle" });
await page.screenshot({ path: out, fullPage: true });
await browser.close();
