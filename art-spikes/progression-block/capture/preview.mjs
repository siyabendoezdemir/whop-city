import { resolve } from "node:path";
import { chromium } from "@playwright/test";

import { DEV_URL, artOut, launchOptions } from "./env.mjs";

const state = process.argv[2] ?? "healthy";
const out = process.argv[3] ? resolve(process.argv[3]) : `${artOut()}/preview-${state}.png`;
const frame = process.argv[4] ? Number(process.argv[4]) : null;

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: 1500, height: 960 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.log("PAGE ERROR:", String(e).slice(0, 400)));
page.on("console", (m) => {
  if (m.type() === "error") console.log("CONSOLE ERROR:", m.text().slice(0, 400));
});

await page.goto(`${DEV_URL}/?bare=1&state=${state}`, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready === true, { timeout: 60000 });
await page.waitForTimeout(1400);
await page.evaluate((s) => window.__setState(s), state);
await page.waitForTimeout(900);

if (frame !== null) await page.evaluate((f) => window.__renderFrame(f), frame);
else await page.evaluate(() => window.__renderStill());

console.log("info:", JSON.stringify(await page.evaluate(() => window.__info())));
await page.locator("canvas").screenshot({ path: out });
console.log("saved", out);

await browser.close();
