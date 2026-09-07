import { resolve } from "node:path";
import { chromium } from "@playwright/test";

import { artOut, launchOptions, openCity } from "./env.mjs";

/**
 * Close looks, several per browser.
 *
 * `plots.mjs` is the survey; this is the follow-up. Booting Chromium with
 * SwiftShader costs twenty seconds, so asking for one frame at a time makes an
 * iteration loop that is mostly waiting for a browser.
 *
 *   node capture/eye.mjs forge-hero:5 forge-north:2 core-north:1
 *   node capture/eye.mjs forge-hero:5:70:14      # explicit frustum and lift
 */

const AT = {
  "core-landmark": [20, -62],
  "core-north": [-12, -64],
  "core-east": [20, -34],
  "core-southeast": [-14, -34],
  "forge-hero": [-46, -8],
  "forge-north": [-46, -42],
  "forge-south": [-46, 22],
  "creator-park": [-14, 8],
  "creator-terrace": [18, 8],
  "creator-venue": [48, 8],
  "creator-struggling": [72, 8],
};
const IDS = Object.keys(AT);

const specs = process.argv.slice(2).map((arg) => {
  const [id, level = "5", height, lift] = arg.split(":");
  if (!AT[id]) throw new Error(`unknown plot ${id}`);
  return {
    id,
    level: Number(level),
    height: Number(height ?? 34 + Number(level) * 5),
    lift: Number(lift ?? Number(level) * 1.6),
  };
});
if (specs.length === 0) throw new Error("usage: eye.mjs <plot>:<level>[:height[:lift]] ...");

const browser = await chromium.launch(launchOptions());
const page = await openCity(browser, { scenario: "thriving", ss: 1, view: { width: 1200, height: 860 } });
page.on("pageerror", (error) => console.log("PAGE ERROR:", String(error).slice(0, 300)));
await page.addStyleTag({
  content:
    ".crest,.res,.corner,.rail,.feed,.pops,.camera,.nudge,.toast,.ready,.quest,.card,.away" +
    "{display:none!important}",
});
// The founding sweep drives the camera for its first seconds; a frame set while
// it runs is thrown away on the next tick.
await page.waitForSelector('[data-testid="rising"]', { state: "detached", timeout: 60_000 }).catch(() => {});

for (const spec of specs) {
  await page.evaluate(
    ([ids, one, at]) => {
      const levels = Object.fromEntries(ids.map((key) => [key, 0]));
      window.__city.setLevels({ ...levels, [one]: at });
    },
    [IDS, spec.id, spec.level],
  );
  await page.evaluate(
    ([at, h, y]) => window.__city.frameAt([at[0], y, at[1]], h, 6),
    [AT[spec.id], spec.height, spec.lift],
  );
  const file = resolve(artOut(), `eye_${spec.id}_${spec.level}.png`);
  await page.screenshot({ path: file, timeout: 240_000, animations: "disabled" });
  console.log(file);
}

await browser.close();
