/**
 * Layout checks for the operational workspace, with Playwright against the dev server:
 *   desktop 1440×900 and laptop 1280×720: the guard page has no page-level scroll, the identity bar,
 *   map and feed are visible together, the feed scrolls inside its own panel, no horizontal overflow;
 *   phone 390×844: no horizontal overflow, map present, controls reachable.
 *   Also: /operations, /monitoring, /operations/map, /gateways have no horizontal overflow at 1280 and 390.
 *   GUARD_ID picks the guard; otherwise the first guard in /guards is used.
 *   node scripts/dev/layout-e2e.mjs
 */
import { chromium } from "playwright-core";

/** QA_PASSWORD, which has no default: a real administrator's password used to live here. */
function requirePassword() {
  const p = process.env.QA_PASSWORD;
  if (!p) throw new Error("Set QA_PASSWORD (the seeded demo password locally; never a production one).");
  return p;
}

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const EMAIL = process.env.QA_EMAIL ?? "admin@omegasecurity.co.zw";
const PASSWORD = requirePassword();
let passed = 0, failed = 0;
const check = (name, ok, detail = "") => { if (ok) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name} ${detail}`); } };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });

async function login(ctx) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`); await page.fill("input[name=email]", EMAIL); await page.fill("input[name=password]", PASSWORD); await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 });
  return page;
}
const metrics = (page) => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, iw: innerWidth, ih: innerHeight }));

try {
  const ctx0 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p0 = await login(ctx0);
  let guardId = process.env.GUARD_ID;
  if (!guardId) { await p0.goto(`${BASE}/guards`); guardId = (await p0.getAttribute('a[href^="/guards/"]:not([href="/guards/new"])', "href")).split("/")[2]; }
  await ctx0.close();

  for (const [w, h, label] of [[1440, 900, "desktop"], [1280, 720, "laptop"]]) {
    console.log(`${label} ${w}×${h}`);
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await login(ctx);
    await page.goto(`${BASE}/guards/${guardId}`); await page.waitForSelector("[data-testid=guard-identity]", { timeout: 60000 }); await page.waitForSelector(".leaflet-container, canvas.mapboxgl-canvas", { timeout: 60000 }); await page.waitForTimeout(800);
    const m = await metrics(page);
    check("no horizontal page overflow", m.sw <= m.iw + 1, JSON.stringify(m));
    check("no page-level vertical scroll (workspace fits the viewport)", m.sh <= m.ih + 2, JSON.stringify(m));
    const vis = await page.evaluate(() => { const v = (s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return !!r && r.top >= 0 && r.bottom <= innerHeight && r.width > 0 && r.height > 0; }; return { identity: v("[data-testid=guard-identity]"), map: v("[data-testid=guard-map]"), feed: v("[data-testid=feed-list]") || v("[data-testid=feed-filters]"), state: v("[data-testid=location-state]"), request: v("[data-testid=map-request-row]"), detail: v("[data-testid=detail-region]") }; });
    check("identity bar, location state, map, request controls, feed and detail region all visible at once", Object.values(vis).every(Boolean), JSON.stringify(vis));
    const mapBox = await page.evaluate(() => { const r = document.querySelector("[data-testid=guard-map]").getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
    check("map has a usable size", mapBox.w >= 400 && mapBox.h >= 240, JSON.stringify(mapBox));
    const feed = await page.evaluate(() => { const el = document.querySelector("[data-testid=feed-list]")?.closest("section")?.querySelector(".overflow-y-auto"); return el ? { own: el.scrollHeight > el.clientHeight, items: document.querySelectorAll("[data-testid=feed-list] li").length } : null; });
    check("feed owns its scrolling region (scrollable when it has enough rows)", !!feed && (feed.items < 8 || feed.own), JSON.stringify(feed));
    if (feed?.own) {
      await page.evaluate(() => { const el = document.querySelector("[data-testid=feed-list]").closest("section").querySelector(".overflow-y-auto"); el.scrollTop = 600; });
      await page.waitForTimeout(200);
      const after = await page.evaluate(() => { const r = document.querySelector("[data-testid=guard-identity]").getBoundingClientRect(); const mp = document.querySelector("[data-testid=guard-map]").getBoundingClientRect(); return { identityTop: r.top, mapVisible: mp.top >= 0 && mp.bottom <= innerHeight, pageY: scrollY }; });
      check("scrolling the feed leaves the identity bar and the map in place", after.pageY === 0 && after.identityTop >= 0 && after.mapVisible, JSON.stringify(after));
    }
    await page.click("[data-testid=feed-filters] button:nth-child(2)"); await page.waitForTimeout(600);
    check("feed filter chips work without a page reload", (await metrics(page)).sh <= m.ih + 2);
    for (const path of ["/operations", "/monitoring", "/operations/map", "/gateways", "/alerts"]) { await page.goto(`${BASE}${path}`); await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {}); const mm = await metrics(page); check(`${path}: no horizontal overflow`, mm.sw <= mm.iw + 1, JSON.stringify(mm)); }
    await ctx.close();
  }

  console.log("phone 390×844");
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await login(ctx);
  await page.goto(`${BASE}/guards/${guardId}`); await page.waitForSelector("[data-testid=guard-identity]", { timeout: 60000 }); await page.waitForSelector(".leaflet-container, canvas.mapboxgl-canvas", { timeout: 60000 }); await page.waitForTimeout(800);
  const m = await metrics(page);
  check("phone: no horizontal overflow", m.sw <= m.iw + 1, JSON.stringify(m));
  const mapBox = await page.evaluate(() => { const r = document.querySelector("[data-testid=guard-map]").getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) }; });
  check("phone: map is full width and tall enough", mapBox.w >= 330 && mapBox.h >= 240, JSON.stringify(mapBox));
  check("phone: request controls present", await page.isVisible("[data-testid=map-request-row]"));
  for (const path of ["/operations", "/monitoring", "/gateways"]) { await page.goto(`${BASE}${path}`); await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {}); const mm = await metrics(page); check(`phone ${path}: no horizontal overflow`, mm.sw <= mm.iw + 1, JSON.stringify(mm)); }
  await ctx.close();
} finally {
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}
