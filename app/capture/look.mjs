import { resolve } from "node:path";
import { chromium } from "@playwright/test";

import { artOut, launchOptions, openCity } from "./env.mjs";

/**
 * One plot, one level, full frame.
 *
 * The contact sheets are for spotting a problem across six states; this is for
 * looking at the one that turned up.
 *
 *   node capture/look.mjs <plotId> <level> [frustumHeight] [lift]
 */

const [id, levelArg, heightArg, liftArg] = process.argv.slice(2);
const level = Number(levelArg ?? 5);
const height = Number(heightArg ?? 48);
const lift = Number(liftArg ?? 8);

const IDS = [
  "core-landmark",
  "core-north",
  "core-east",
  "core-southeast",
  "forge-hero",
  "forge-north",
  "forge-south",
  "creator-park",
  "creator-terrace",
  "creator-venue",
  "creator-struggling",
];
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

const browser = await chromium.launch(launchOptions());
const page = await openCity(browser, { scenario: "thriving", ss: 1, view: { width: 1200, height: 900 } });
page.on("pageerror", (error) => console.log("PAGE ERROR:", String(error).slice(0, 300)));
await page.addStyleTag({
  content:
    ".crest,.res,.corner,.rail,.feed,.pops,.camera,.nudge,.toast,.ready,.quest,.card,.away" +
    "{display:none!important}",
});

// The founding sweep drives the camera for its first five seconds, and a frame
// set while it is running is thrown away on its next tick.
await page.waitForSelector('[data-testid="rising"]', { state: "detached", timeout: 60_000 }).catch(() => {});
await page.evaluate(
  ([ids, one, at]) => {
    const levels = Object.fromEntries(ids.map((key) => [key, 0]));
    window.__city.setLevels({ ...levels, [one]: at });
  },
  [IDS, id, level],
);
await page.evaluate(
  ([at, h, y]) => window.__city.frameAt([at[0], y, at[1]], h, 6),
  [AT[id], height, lift],
);

const file = resolve(artOut(), `look_${id}_${level}.png`);
await page.screenshot({ path: file, timeout: 240_000, animations: "disabled" });
console.log(file);
await browser.close();
