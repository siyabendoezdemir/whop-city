import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { DEV_URL, artifactPath, launchOptions } from "./env.mjs";

/** One frame. `node capture/preview.mjs <framing> [out] [t] [zoom]` */
const framing = process.argv[2] ?? "city";
const out = resolve(process.argv[3] ?? artifactPath(`preview-${framing}.png`));
const t = Number(process.argv[4] ?? 7.5);
const zoom = Number(process.argv[5] ?? 1);

mkdirSync(dirname(out), { recursive: true });

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("console", (m) => m.type() === "error" && console.log("CONSOLE:", m.text().slice(0, 300)));
page.on("pageerror", (e) => console.log("PAGE ERROR:", String(e).slice(0, 400)));

await page.goto(`${DEV_URL}/?bare=1&capture=1`, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready === true, { timeout: 90000 });
await page.waitForTimeout(900);

await page.evaluate(([f, tt, z]) => window.__frame(f, tt, z), [framing, t, zoom]);
await page.waitForTimeout(220);

const canvas = page.locator("canvas");
await canvas.screenshot({ path: out });
console.log(JSON.stringify(await page.evaluate(() => window.__info())));
console.log("wrote", out);

await browser.close();
