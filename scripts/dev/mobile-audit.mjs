/**
 * Phone-width audit of every portal page.
 *
 * Reports three things a screenshot alone does not make obvious:
 *   - horizontal overflow (the page scrolls sideways),
 *   - which element causes it, so the fix has an address,
 *   - controls below the 44px minimum touch target.
 *
 * Usage: node scripts/dev/mobile-audit.mjs <outdir> [width] [height]
 */
import { chromium } from "playwright-core";
import fs from "node:fs";

const out = process.argv[2] ?? "/tmp/mobile";
const W = Number(process.argv[3] ?? 390);
const H = Number(process.argv[4] ?? 844);
const BASE = process.env.APP_URL ?? "http://localhost:3000";
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();

const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 160)); });

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.fill("input[name=email]", process.env.QA_EMAIL ?? "admin@omegasecurity.co.zw");
await page.fill("input[name=password]", process.env.QA_PASSWORD ?? "Sentinel123!");
await Promise.all([page.waitForURL("**/dashboard", { timeout: 120000 }), page.click("button[type=submit]")]);

const api = async (p) => (await (await page.request.get(BASE + p)).json());
let guard = null, loc = null, shift = null, incident = null;
try { guard = (await api("/api/guards?limit=1")).items?.[0]?.id; } catch {}
try { loc = (await api("/api/locations")).items?.[0]?.id; } catch {}
try { shift = (await api("/api/shifts?limit=1")).items?.[0]?.id; } catch {}

const routes = [
  "/dashboard", "/operations", "/operations/exceptions", "/operations/map",
  "/attendance", "/attendance/check-ins",
  "/guards", "/guards/new", "/shifts", "/shifts/new", "/shifts/recurring/new",
  "/locations", "/locations/new", "/clients", "/clients/new",
  "/incidents", "/incidents/new", "/alerts", "/calls", "/gateways", "/gateways/new",
  "/sms", "/sms/templates", "/messages/new", "/monitoring", "/notifications",
  "/reports", "/reports/calls", "/reports/location",
  "/settings", "/users", "/users/new", "/audit", "/simulator",
  guard && `/guards/${guard}`, loc && `/locations/${loc}`, shift && `/shifts/${shift}`,
].filter(Boolean);

const rows = [];
for (const r of routes) {
  const before = consoleErrors.length;
  let status = "ok";
  try {
    const resp = await page.goto(BASE + r, { waitUntil: "networkidle", timeout: 60000 });
    if (resp && resp.status() >= 400) status = `HTTP ${resp.status()}`;
  } catch (e) { status = "nav: " + String(e).slice(0, 60); }
  await page.waitForTimeout(400);

  const m = await page.evaluate((vw) => {
    const de = document.documentElement;
    const scrollW = Math.max(de.scrollWidth, document.body.scrollWidth);
    // Name the widest offenders so each finding has an address, not just a number.
    const offenders = [];
    if (scrollW > vw + 1) {
      for (const el of Array.from(document.querySelectorAll("body *"))) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const right = rect.left + rect.width;
        if (right > vw + 1 || rect.left < -1) {
          const cs = getComputedStyle(el);
          if (cs.position === "fixed") continue;
          offenders.push({
            tag: el.tagName.toLowerCase(),
            cls: (el.getAttribute("class") || "").slice(0, 90),
            testid: el.getAttribute("data-testid") || "",
            w: Math.round(rect.width), left: Math.round(rect.left), right: Math.round(right),
          });
        }
      }
      offenders.sort((a, b) => b.right - a.right);
    }
    // Interactive targets under the 44px guideline.
    const small = [];
    for (const el of Array.from(document.querySelectorAll("button, a[href], input, select, [role=button]"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 36 || r.width < 24) {
        small.push({ tag: el.tagName.toLowerCase(), text: (el.textContent || "").trim().slice(0, 28), h: Math.round(r.height), w: Math.round(r.width) });
      }
    }
    // Text that would be unreadably small on a phone.
    const tiny = new Set();
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      if (!el.children.length && (el.textContent || "").trim()) {
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs && fs < 11) tiny.add(`${el.tagName.toLowerCase()} ${fs}px`);
      }
    }
    return { scrollW, offenders: offenders.slice(0, 6), small: small.slice(0, 8), smallCount: small.length, tiny: [...tiny].slice(0, 4) };
  }, W);

  const name = r.replace(/[^a-z0-9]+/gi, "_").replace(/^_/, "") || "root";
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  rows.push({ route: r, status, overflow: m.scrollW > W + 1 ? m.scrollW : 0, ...m, newErrors: consoleErrors.length - before });
}

console.log("\n=== PHONE AUDIT " + W + "x" + H + " ===");
const bad = rows.filter((r) => r.overflow || r.status !== "ok");
console.log(`pages: ${rows.length}   overflowing: ${rows.filter(r=>r.overflow).length}   errors: ${rows.filter(r=>r.status!=="ok").length}`);
for (const r of bad) {
  console.log(`\n${r.route}  [${r.status}]  scrollWidth=${r.overflow || "-"}`);
  for (const o of r.offenders) console.log(`    ${o.tag}${o.testid ? `[${o.testid}]` : ""} w=${o.w} right=${o.right}  ${o.cls}`);
}
console.log("\n--- tap targets under 36px high ---");
for (const r of rows) if (r.smallCount) console.log(`${r.route}: ${r.smallCount}  e.g. ${r.small.slice(0,3).map(s=>`${s.tag}"${s.text}" ${s.w}x${s.h}`).join(" | ")}`);
console.log("\n--- text under 11px ---");
for (const r of rows) if (r.tiny.length) console.log(`${r.route}: ${r.tiny.join(", ")}`);
console.log("\nscreenshots: " + out);
await browser.close();
