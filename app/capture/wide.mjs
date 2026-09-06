/**
 * The world from far enough back to see its edges.
 *
 * Not a product framing — the game clamps the camera well inside this. It
 * exists to answer "what does the ground actually do out there", which is not
 * a question you can answer from inside the composition.
 *
 *   node capture/wide.mjs [height] [scenario]
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const height = Number(process.argv[2] ?? 420);
const scenario = process.argv[3] ?? "thriving";
const base = process.env.CITY_BASE ?? "http://localhost:4173";
const out = process.env.CITY_OUT ?? "/tmp/ui";

await mkdir(out, { recursive: true });

const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  reducedMotion: "reduce",
});

await page.goto(`${base}/?scenario=${scenario}&ss=1&capture=1`, { waitUntil: "load" });
await page.waitForFunction(() => Boolean(window.__city?.ready), null, { timeout: 180_000 });
await page.waitForFunction(() => (window.__city?.info().parcels ?? 0) > 0, null, { timeout: 180_000 });

for (const [name, focus, h] of [
  ["wide", [0, 0, -20], height],
  ["south", [0, 0, 80], height * 0.6],
  ["east", [110, 0, -20], height * 0.6],
]) {
  await page.evaluate(
    ([f, hh]) => window.__city.frameAt(f, hh, 6),
    [focus, h],
  );
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/edge_${name}.png`, timeout: 180_000 });
  console.log(`${out}/edge_${name}.png`);
}

await browser.close();
