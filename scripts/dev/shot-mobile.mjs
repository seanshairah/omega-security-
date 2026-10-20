import { chromium } from "playwright-core";

/** QA_PASSWORD, which has no default: a real administrator's password used to live here. */
function requirePassword() {
  const p = process.env.QA_PASSWORD;
  if (!p) throw new Error("Set QA_PASSWORD (the seeded demo password locally; never a production one).");
  return p;
}

const [,, path, out, w = "390", h = "844", openMenu = ""] = process.argv;
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1, isMobile: +w < 800, hasTouch: +w < 800 });
const page = await ctx.newPage();
await page.goto("http://localhost:3000/login");
await page.fill('input[name=email]', (process.env.QA_EMAIL ?? "admin@omegasecurity.co.zw"));
await page.fill("input[name=password]", (requirePassword()));
await Promise.all([page.waitForURL("**/dashboard"), page.click('button[type=submit]')]);
await page.goto("http://localhost:3000" + path, { waitUntil: "networkidle" });
if (openMenu) await page.click('button[aria-label="Open menu"]');
await page.waitForTimeout(300);
await page.screenshot({ path: out, fullPage: !openMenu });
await browser.close();
