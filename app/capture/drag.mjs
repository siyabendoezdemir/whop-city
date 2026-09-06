/**
 * Which way does the world go when you pull it?
 *
 * Two stills and a printed measurement, so the answer is not a matter of
 * opinion: a named plot's position on screen before and after a drag of a
 * known distance. "Grab" means the plot moves the same way the hand did, by
 * roughly the same number of pixels.
 *
 *   node capture/drag.mjs [outDir]
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const out = process.argv[2] ?? "/opt/cursor/artifacts";
const base = process.env.CITY_BASE ?? "http://localhost:4173";
const DRAG = { x: 120, y: 200 };

await mkdir(out, { recursive: true });

const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  reducedMotion: "reduce",
});

await page.goto(`${base}/?scenario=thriving&ss=1`, { waitUntil: "load" });
await page.waitForFunction(() => Boolean(window.__city?.ready), null, { timeout: 180_000 });
await page.waitForFunction(() => (window.__city?.info().parcels ?? 0) > 0, null, { timeout: 180_000 });
await page.waitForTimeout(2500);

const where = () => page.evaluate(() => window.__city.plotGround("core-landmark"));

const before = await where();
await page.screenshot({ path: `${out}/camera_1_before_drag.png` });

await page.mouse.move(720, 380);
await page.mouse.down();
await page.mouse.move(720 + DRAG.x, 380 + DRAG.y, { steps: 24 });
await page.mouse.up();
await page.waitForTimeout(1400);

const after = await where();
await page.screenshot({ path: `${out}/camera_2_after_drag_down_right.png` });

console.log(
  JSON.stringify(
    {
      hand: DRAG,
      plotMovedBy: { x: Math.round(after.x - before.x), y: Math.round(after.y - before.y) },
      before: { x: Math.round(before.x), y: Math.round(before.y) },
      after: { x: Math.round(after.x), y: Math.round(after.y) },
      verdict:
        after.y - before.y > 0 && after.x - before.x > 0
          ? "the world followed the hand"
          : "the world went the other way",
    },
    null,
    2,
  ),
);

await browser.close();
