/**
 * Ad-hoc screenshot: `node capture/shot.mjs <name> [scenario] [waitMs]`.
 *
 * Points a headless browser at the dev server, waits for the renderer to say
 * it is up, and writes a PNG. Used while iterating on the interface; the
 * scripted captures under `capture/` are the reproducible ones.
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const [name = "shot", scenario = "balanced", waitMs = "3500"] = process.argv.slice(2);
const base = process.env.CITY_BASE ?? "http://localhost:3000";
const out = process.env.CITY_OUT ?? "artifacts";

await mkdir(out, { recursive: true });

const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

const problems = [];
page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") problems.push(`console: ${message.text()}`);
});

const extra = process.env.CITY_QUERY ?? "ss=1";
await page.goto(`${base}/?scenario=${scenario}&${extra}`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => Boolean(window.__city?.ready), null, { timeout: 120_000 }).catch(() => {});
await page.waitForTimeout(Number(waitMs));

await page.screenshot({ path: `${out}/${name}.png`, timeout: 120_000 });
if (problems.length > 0) console.error(problems.join("\n"));
console.log(`${out}/${name}.png`);

await browser.close();
