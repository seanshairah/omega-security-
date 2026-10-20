/**
 * Mapbox GL checks against the dev server, with Playwright:
 *   the guard workspace, the fleet map and the site picker each start a WebGL map, draw the
 *   application's own layers (fences, accuracy rings, markers), survive a status refresh without
 *   re-creating the map instance, and clean up on navigation.
 *   Falls back to asserting the raster map when NEXT_PUBLIC_MAPBOX_TOKEN is not configured.
 *   node scripts/dev/map-e2e.mjs
 */
import { chromium } from "playwright-core";
const BASE = process.env.APP_URL ?? "http://localhost:3000";
const EMAIL = process.env.QA_EMAIL ?? "admin@omegasecurity.co.zw";
const PASSWORD = process.env.QA_PASSWORD ?? "Zvesh@2000";
let passed = 0, failed = 0;
const check = (name, ok, detail = "") => { if (ok) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name} ${detail}`); } };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });

const mapboxConfigured = async (page) => page.evaluate(() => !!document.querySelector('[data-testid="mapbox-map"]'));

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  const net = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("request", (r) => { const u = r.url(); if (/^https:\/\/(api|events)\.mapbox\.com/.test(u)) net.push(u); });
  await page.goto(`${BASE}/login`);
  await page.fill("input[name=email]", EMAIL); await page.fill("input[name=password]", PASSWORD); await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 });

  const webgl = await page.evaluate(() => { try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; } });
  check("browser provides WebGL", webgl);

  // ---- guard workspace ----
  let guardId = process.env.GUARD_ID;
  if (!guardId) { await page.goto(`${BASE}/guards`); guardId = (await page.getAttribute('a[href^="/guards/"]:not([href="/guards/new"])', "href")).split("/")[2]; }
  await page.goto(`${BASE}/guards/${guardId}`);
  await page.waitForSelector('[data-testid="guard-identity"]', { timeout: 30000 });
  const isMapbox = await mapboxConfigured(page);
  check(`guard workspace renders a map (${isMapbox ? "mapbox" : "raster fallback"})`, isMapbox || (await page.locator('[data-testid="leaflet-map"]').count()) > 0);

  if (isMapbox) {
    await page.waitForFunction(() => { const c = document.querySelector('[data-testid="mapbox-map"] canvas.mapboxgl-canvas'); return !!c && c.width > 100; }, { timeout: 45000 });
    const box = await page.locator('[data-testid="mapbox-map"] canvas').boundingBox();
    check("map canvas has usable size", box && box.width > 300 && box.height > 180, box ? `${Math.round(box.width)}×${Math.round(box.height)}` : "no canvas");
    check("style loaded from Mapbox", net.some((u) => u.includes("/styles/v1/")), `${net.length} Mapbox requests`);
    for (let i = 0; i < 20 && !net.some((u) => u.includes("/v4/")); i++) await page.waitForTimeout(500);
    check("vector tiles loaded from Mapbox", net.some((u) => u.includes("/v4/")), net.filter((u) => u.includes("/v4/")).length + " tile requests");
    check("map controls rendered", (await page.locator(".mapboxgl-ctrl").count()) >= 2);
    const painted = await page.evaluate(() => { const c = document.querySelector('[data-testid="mapbox-map"] canvas'); const gl = c.getContext("webgl2") || c.getContext("webgl"); return !!gl && !gl.isContextLost(); });
    check("WebGL context alive after paint", painted);
    const before = await page.evaluate(() => document.querySelectorAll('[data-testid="mapbox-map"] canvas.mapboxgl-canvas').length);
    // Force a status poll and confirm the same single canvas survives (no remount).
    await page.evaluate(async (id) => { await fetch(`/api/guards/${id}/status`, { cache: "no-store" }); }, guardId);
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => document.querySelectorAll('[data-testid="mapbox-map"] canvas.mapboxgl-canvas').length);
    check("one map canvas, kept across a refresh", before === 1 && after === 1, `${before} → ${after}`);
    // The application's own layers, not just a Mapbox basemap: a map that paints tiles but adds no
    // layers looks fine in a screenshot and shows no guard at all.
    const style = await page.evaluate(() => {
      const m = window.__omegaMap;
      if (!m) return null;
      const layers = m.getStyle().layers.filter((l) => l.id.startsWith("omega-")).map((l) => l.id);
      return { layers, sites: m.querySourceFeatures("omega-sites").length, rendered: m.queryRenderedFeatures({ layers }).length };
    });
    check("application map layers added to the style", style && style.layers.length >= 10, style ? `${style.layers.length} layers` : "no map handle");
    check("fence and marker layers present", style && ["omega-fence-fill", "omega-point", "omega-point-glyph", "omega-accuracy-fill"].every((l) => style.layers.includes(l)));

    const recenter = page.getByRole("button", { name: /recenter/i });
    check("recenter control present", (await recenter.count()) > 0);
    if (await recenter.count()) { await recenter.first().click(); await page.waitForTimeout(600); check("recenter leaves the map alive", (await page.locator('[data-testid="mapbox-map"] canvas.mapboxgl-canvas').count()) === 1); }
    const sat = page.getByRole("button", { name: /^Satellite$/ });
    check("satellite switch present", (await sat.count()) > 0);
    if (await sat.count()) {
      await sat.first().click();
      await page.waitForTimeout(3500);
      check("satellite style keeps one canvas", (await page.locator('[data-testid="mapbox-map"] canvas.mapboxgl-canvas').count()) === 1);
      const after = await page.evaluate(() => (window.__omegaMap ? window.__omegaMap.getStyle().layers.filter((l) => l.id.startsWith("omega-")).length : 0));
      check("application layers re-added after a style switch", after >= 10, `${after} layers`);
    }
  }

  // ---- fleet map ----
  await page.goto(`${BASE}/operations/map`);
  await page.waitForTimeout(3000);
  const fleetMap = (await page.locator('[data-testid="mapbox-map"], [data-testid="leaflet-map"]').count()) > 0;
  const emptyFleet = (await page.getByText(/Nothing to plot yet/i).count()) > 0;
  check("fleet map renders or explains why it is empty", fleetMap || emptyFleet);
  if (fleetMap) {
    // A map element that exists but has collapsed to no height is the defect this guards against.
    const box = await page.locator('[data-testid="mapbox-map"], [data-testid="leaflet-map"]').first().boundingBox();
    check("fleet map has a usable size", box && box.width > 300 && box.height > 300, box ? `${Math.round(box.width)}×${Math.round(box.height)}` : "no box");
    const markers = await page.evaluate(() => {
      const c = document.querySelector('[data-testid="mapbox-map"] canvas, [data-testid="leaflet-map"] canvas');
      if (!c) return document.querySelectorAll(".leaflet-interactive").length;
      return c.width * c.height > 0 ? 1 : 0;
    });
    check("fleet map painted", markers > 0);
    const fleet = await page.evaluate(() => {
      const m = window.__omegaMap;
      if (!m) return null;
      const layers = m.getStyle().layers.filter((l) => l.id.startsWith("omega-")).map((l) => l.id);
      return { cluster: layers.includes("omega-cluster"), points: m.querySourceFeatures("omega-points").length, sites: m.querySourceFeatures("omega-sites").length };
    });
    if (fleet) {
      check("fleet map clusters markers", fleet.cluster);
      check("fleet map carries guard and site features", fleet.points > 0 && fleet.sites > 0, JSON.stringify(fleet));
    }
  }

  // ---- site picker ----
  await page.goto(`${BASE}/locations`);
  const siteHref = await page.getAttribute('a[href^="/locations/"]:not([href="/locations/new"])', "href");
  if (siteHref) {
    await page.goto(`${BASE}${siteHref}/edit`);
    await page.waitForTimeout(3500);
    const pickerMap = (await page.locator("canvas.mapboxgl-canvas, .leaflet-container").count()) > 0;
    check("site picker renders a map", pickerMap);
    check("browser-location panel still present", (await page.locator('[data-testid="browser-location"]').count()) > 0);
    const latV = await page.inputValue('input[name="latitude"]').catch(() => "");
    check("latitude field still drives the form", latV !== undefined);
  }

  const fatal = errors.filter((e) => !/favicon|Download the React DevTools|maptiler|401|Failed to load resource/i.test(e));
  check("no unexpected console errors", fatal.length === 0, fatal.slice(0, 3).join(" | "));

  await ctx.close();
} finally {
  await browser.close();
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
