import { chromium } from "playwright-core";
const [,, path] = process.argv;
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
await page.goto("http://localhost:3000/login"); await page.fill('input[name=email]', (process.env.QA_EMAIL ?? "admin@omegasecurity.co.zw")); await page.fill('input[name=password]', (process.env.QA_PASSWORD ?? "Zvesh@2000"));
await Promise.all([page.waitForURL("**/dashboard", { timeout: 120000 }), page.click('button[type=submit]')]);
await page.goto("http://localhost:3000" + path, { waitUntil: "networkidle", timeout: 120000 });
console.log(await page.evaluate(() => [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > 391).slice(0, 8).map((e) => `${e.tagName}.${[...e.classList].slice(0, 5).join(".")} right=${Math.round(e.getBoundingClientRect().right)} text=${(e.textContent || "").trim().slice(0, 40)}`).join("\n")));
await browser.close();
