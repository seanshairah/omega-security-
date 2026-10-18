/**
 * Screenshots of the duty-site picker (Leaflet fallback when no Google Maps key) and the shift override.
 * Usage: QA_EMAIL=… QA_PASSWORD=… node scripts/dev/shot-picker.mjs <outDir> [shiftId] [locationId]
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
const [, , outDir = "/tmp/shots", shiftId, locationId] = process.argv;
fs.mkdirSync(outDir, { recursive: true });
const exe = fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : fs.readdirSync("/opt/pw-browsers").filter((d) => d.startsWith("chromium")).map((d) => `/opt/pw-browsers/${d}/chrome-linux/chrome`).find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
await page.goto("http://localhost:3000/login");
await page.fill("input[name=email]", process.env.QA_EMAIL ?? "admin@omegasecurity.co.zw");
await page.fill("input[name=password]", process.env.QA_PASSWORD ?? "Sentinel123!");
await Promise.all([page.waitForURL("**/dashboard"), page.click("button[type=submit]")]);

// 1. New site: click the map to place a pin, change the radius, see the preview.
await page.goto("http://localhost:3000/locations/new", { waitUntil: "networkidle" });
await page.waitForSelector(".leaflet-container", { timeout: 20000 });
await page.waitForTimeout(1500);
const map = await page.$(".leaflet-container");
const box = await map.boundingBox();
await page.mouse.click(box.x + box.width / 2 + 40, box.y + box.height / 2 - 20);
await page.waitForTimeout(500);
await page.fill("input[name=geofenceRadiusM]", "250");
await page.selectOption("select[name=coordinatesSource]", "TEST");
await page.waitForTimeout(800);
const lat = await page.inputValue("input[name=latitude]");
const lng = await page.inputValue("input[name=longitude]");
console.log("picker wrote", { lat, lng, source: await page.inputValue("select[name=coordinatesSource]") });
await map.screenshot({ path: `${outDir}/picker-map.png` });
await page.screenshot({ path: `${outDir}/locations-new-picker.png`, fullPage: true });

// 2. Site page with TEST coordinates (EOP-02 in the demo seed).
if (locationId) { await page.goto(`http://localhost:3000/locations/${locationId}`, { waitUntil: "networkidle" }); await page.screenshot({ path: `${outDir}/location-test-badge.png`, fullPage: true }); }

// 3. New shift: override section open with the picker.
await page.goto("http://localhost:3000/shifts/new", { waitUntil: "networkidle" });
await page.check("input[name=overrideGeofence]");
await page.waitForSelector(".leaflet-container", { timeout: 20000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${outDir}/shift-new-override.png`, fullPage: true });

// 4. Existing shift page (geofence card).
if (shiftId) { await page.goto(`http://localhost:3000/shifts/${shiftId}`, { waitUntil: "networkidle" }); await page.screenshot({ path: `${outDir}/shift-geofence-card.png`, fullPage: true }); }

console.log(errors.length ? `browser errors:\n${errors.join("\n")}` : "no browser errors");
await browser.close();
