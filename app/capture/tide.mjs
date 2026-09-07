import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { chromium } from "@playwright/test";

import { artOut, framesDir, launchOptions, openCity } from "./env.mjs";

/**
 * The waterfront, held still.
 *
 * Every other piece of evidence in here moves the camera, which is the one
 * thing that makes it impossible to tell whether the world is moving or the
 * lens is. This locks the camera on the bay and advances only the clock, so
 * what is left on screen is the city's own motion: the current, the ferry on
 * its crossing, and the traffic on the quay.
 */

const SECONDS = Number(process.env.TIDE_SECONDS ?? 10);
const FPS = Number(process.env.TIDE_FPS ?? 24);
const START = Number(process.env.TIDE_START ?? 26);

const frames = resolve(framesDir(), "tide");
await rm(frames, { recursive: true, force: true });
await mkdir(frames, { recursive: true });

const browser = await chromium.launch(launchOptions());
const page = await openCity(browser, {
  scenario: "thriving",
  ss: 2,
  view: { width: 1100, height: 700 },
});
await page.addStyleTag({
  content:
    ".crest,.res,.corner,.rail,.feed,.pops,.camera,.nudge,.toast,.ready,.quest,.card,.away{display:none!important}",
});

const clip = await page.locator("canvas").boundingBox();
const total = Math.round(SECONDS * FPS);

for (let i = 0; i < total; i++) {
  // Start well past the founding sweep, which runs on wall time rather than
  // this clock and would otherwise grow buildings through the shot.
  const t = START + i / FPS;
  await page.evaluate(([at, clock]) => window.__city.frame(at, clock), ["commerce-core", t]);
  await page.screenshot({
    path: resolve(frames, `f${String(i).padStart(4, "0")}.png`),
    clip,
    timeout: 240_000,
    animations: "disabled",
  });
  if (i % 24 === 0) console.log(`frame ${i}/${total}`);
}

await browser.close();
console.log(`frames in ${frames}`);
console.log(`encode to ${artOut()}`);
