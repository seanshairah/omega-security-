import { chromium } from "playwright-core";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
await p.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
await p.screenshot({ path: process.argv[2] });
await b.close();
