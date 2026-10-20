/**
 * Browser-geolocation behaviour of the site picker, driven by Playwright with a mocked Geolocation API:
 *   1. permission granted, good fix          → candidate shown, confirm fills lat/lng, source BROWSER
 *   2. permission granted, ±400 m fix        → "too loose" verdict, confirm blocked until acknowledged
 *   3. permission denied                      → explicit denied state, nothing filled
 *   4. insecure LAN origin                    → button disabled with the HTTPS/localhost guidance
 * Needs the dev server (npm run dev) and a demo admin login (QA_EMAIL / QA_PASSWORD).
 *   node scripts/dev/geolocation-e2e.mjs
 */
import { chromium } from "playwright-core";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const EMAIL = process.env.QA_EMAIL ?? "admin@omegasecurity.co.zw";
const PASSWORD = process.env.QA_PASSWORD ?? "Zvesh@2000";
let passed = 0, failed = 0;
const check = (name, ok, detail = "") => { if (ok) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name} ${detail}`); } };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
async function session(opts) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, ...opts });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("input[name=email]", EMAIL); await page.fill("input[name=password]", PASSWORD);
  await page.click("button[type=submit]"); await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  await page.goto(`${BASE}/locations/new`); await page.waitForSelector("[data-testid=browser-location]", { timeout: 60000 }); await page.waitForSelector(".leaflet-container, canvas.mapboxgl-canvas", { timeout: 60000 }); // Leaflet mounts only after hydration, so handlers are live
  return { ctx, page };
}

try {
  console.log("1. granted, good fix");
  {
    const { ctx, page } = await session({ geolocation: { latitude: -17.8201, longitude: 31.0501, accuracy: 9 }, permissions: ["geolocation"] });
    await page.getByRole("button", { name: "Use my current location" }).click();
    await page.waitForSelector("[data-testid=candidate]", { timeout: 30000 });
    const text = await page.textContent("[data-testid=candidate]");
    check("candidate shows source, lat/lng, ±9 m good, fresh", /This device's browser/.test(text) && /-17\.820100/.test(text) && /31\.050100/.test(text) && /±9 m · good/.test(text) && /fresh/.test(text), text.slice(0, 200));
    check("inputs still empty before confirmation", (await page.inputValue("input[name=latitude]")) === "");
    await page.click("[data-testid=confirm-candidate]");
    check("confirm fills latitude/longitude and source BROWSER", (await page.inputValue("input[name=latitude]")) === "-17.820100" && (await page.inputValue("input[name=longitude]")) === "31.050100" && (await page.inputValue("select[name=coordinatesSource]")) === "BROWSER");
    check("candidate panel gone after confirmation", (await page.$("[data-testid=candidate]")) === null);
    const st = await page.textContent("[data-testid=browser-location]");
    check("status line says the position came from this device, not a guard", /not of any guard/.test(st));
    await ctx.close();
  }
  console.log("2. granted, poor accuracy");
  {
    const { ctx, page } = await session({ geolocation: { latitude: -17.8201, longitude: 31.0501, accuracy: 400 }, permissions: ["geolocation"] });
    await page.getByRole("button", { name: "Use my current location" }).click();
    await page.waitForSelector("[data-testid=candidate]", { timeout: 45000 });
    const cand = await page.textContent("[data-testid=candidate]");
    check("candidate is labelled too loose while the watch keeps improving", /too loose/.test(cand) && /Do not centre the fence on this/.test(cand), cand.slice(0, 200));
    await page.waitForFunction(() => /accuracy too loose/i.test(document.querySelector("[data-testid=browser-location]")?.textContent ?? ""), null, { timeout: 45000 });
    const msg = await page.textContent("[data-testid=browser-location]");
    check("after the watch budget the state is 'Acquired, accuracy too loose' with explanation", /accuracy too loose/i.test(msg) && /Do not centre the fence on this/.test(msg), msg.slice(0, 200));
    check("confirm is blocked until the uncertainty is acknowledged", await page.isDisabled("[data-testid=confirm-candidate]"));
    check("'Retry for better accuracy' offered", (await page.$$("text=Retry for better accuracy")).length >= 1);
    await page.check("[data-testid=candidate] input[type=checkbox]");
    check("after acknowledgement confirm is allowed", !(await page.isDisabled("[data-testid=confirm-candidate]")));
    await ctx.close();
  }
  console.log("3. permission denied");
  {
    const { ctx, page } = await session({ permissions: [] });
    await page.getByRole("button", { name: "Use my current location" }).click();
    await page.waitForFunction(() => /Permission denied/.test(document.querySelector("[data-testid=browser-location]")?.textContent ?? ""), null, { timeout: 30000 });
    const msg = await page.textContent("[data-testid=browser-location-message]");
    check("denied state with instructions to allow it or place the pin by hand", /denied/i.test(msg) && /place the pin by hand/.test(msg), msg);
    check("nothing filled", (await page.inputValue("input[name=latitude]")) === "" && (await page.$("[data-testid=candidate]")) === null);
    await ctx.close();
  }
  console.log("4. insecure LAN origin");
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    await ctx.addInitScript(() => { Object.defineProperty(window, "isSecureContext", { get: () => false }); });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`); await page.fill("input[name=email]", EMAIL); await page.fill("input[name=password]", PASSWORD); await page.click("button[type=submit]"); await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
    await page.goto(`${BASE}/locations/new`); await page.waitForSelector("[data-testid=browser-location]", { timeout: 60000 }); await page.waitForSelector(".leaflet-container, canvas.mapboxgl-canvas", { timeout: 60000 }); // Leaflet mounts only after hydration, so handlers are live
    await page.waitForFunction(() => /Blocked: not a secure page/.test(document.querySelector("[data-testid=browser-location]")?.textContent ?? ""), null, { timeout: 15000 });
    const msg = await page.textContent("[data-testid=browser-location-message]");
    check("insecure-context guidance names https and localhost and the LAN example", /https/.test(msg) && /localhost:3000/.test(msg) && /172\.20\.10\.3:3000/.test(msg), msg);
    check("'Use my current location' is disabled", await page.getByRole("button", { name: "Use my current location" }).isDisabled());
    await ctx.close();
  }
} finally {
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}
