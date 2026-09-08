import { chromium } from "@playwright/test";

import { artifactPath, launchOptions, openCity, SHOT_TIMEOUT } from "./env.mjs";

/**
 * The markers, on the states that actually occur.
 *
 * Not `setLevels`, which the other capture scripts use: that pins what the
 * renderer builds and leaves the game state where it was, so every plot keeps
 * whatever marker it had. Markers come from earned-against-claimed, so the only
 * way to photograph them honestly is to open a scenario and let the game decide.
 *
 * `blank` is the one that matters most — a business that has done nothing, where
 * every plot is a lawn, nothing is claimable, and until plots carried a ring of
 * their own there was no marker anywhere on the screen.
 *
 *   SCENES=blank,launch,thriving node capture/mine.mjs
 */

const scenes = (process.env.SCENES ?? "blank,launch,thriving").split(",");

const browser = await chromium.launch(launchOptions());
/**
 * Reduced motion, which is the product's own way of skipping the founding
 * sweep. Not a detail: markers are suppressed for the whole of that sweep, and
 * software rendering makes it take the better part of a minute — so a capture
 * that does not skip it photographs a city with no markers on it whatever the
 * business has done, and looks exactly like the bug it is meant to be checking.
 */
const context = await browser.newContext({
  viewport: { width: 1200, height: 760 },
  deviceScaleFactor: 1,
  reducedMotion: "reduce",
});

for (const scenario of scenes) {
  const page = await openCity(browser, { scenario, ss: 1, context });
  await page.addStyleTag({
    content:
      ".crest,.res,.corner,.rail,.feed,.pops,.camera,.nudge,.toast,.ready,.quest,.card,.away{display:none!important}",
  });
  await page.evaluate(() => window.__city.frame("city", 26));
  const name = `mine-${scenario}.png`;
  await page.screenshot({ path: artifactPath(name), timeout: SHOT_TIMEOUT });
  console.log(name);
  await page.close();
}

await browser.close();
