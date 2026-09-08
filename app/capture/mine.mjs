import { chromium } from "@playwright/test";

import { artifactPath, launchOptions, openCity, SHOT_TIMEOUT } from "./env.mjs";

/**
 * Which of these are mine, before and after.
 *
 * Not `setLevels`, which the other capture scripts use to pin what the renderer
 * builds: markers come from earned-against-claimed, and `setLevels` clears
 * them, so a sweep built on it can show the palette or the markers but never
 * the two at once. This opens a scenario and lets the game decide everything.
 *
 * Both frames come off one page, in one framing, with only the paint and the
 * markers changed between them. Shooting them in two runs left the camera a few
 * pixels apart, which in a before-and-after is the first thing a reader notices
 * and the last thing you want them looking at.
 *
 *   SCENES=blank,launch,thriving node capture/mine.mjs
 *
 * `blank` is the one that matters most — a business that has done nothing,
 * where every plot is a lawn, nothing is claimable, and until plots carried a
 * ring of their own there was no marker anywhere on the screen.
 */

/** Which playable body each backdrop one was drained from. */
const FROM = {
  backdropBrick: "brick",
  backdropBrickDark: "brickDark",
  backdropCream: "renderCream",
  backdropTeal: "renderTeal",
  backdropClay: "renderClay",
  backdropPlaster: "plaster",
};

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

  const shoot = async (suffix) => {
    await page.evaluate(() => window.__city.frame("city", 26));
    const name = `mine-${scenario}${suffix}.png`;
    await page.screenshot({ path: artifactPath(name), timeout: SHOT_TIMEOUT });
    console.log(name);
  };

  await shoot("");

  /**
   * Put the city back the way it was, then shoot it again.
   *
   * Two changes together, because they were one state: the backdrop repainted
   * in the player's own body colours, and the quiet ring taken off every plot
   * with nothing waiting — under the old rule those wore nothing at all.
   * Reconstructing only the paint would leave the rings on and label the result
   * "before", which is the sort of before-and-after that proves nothing.
   *
   * Reconstructed from the running build rather than kept as a checked-in
   * screenshot: the colours are copied off the playable materials by name, so
   * this cannot fall out of date the way an image would.
   */
  await page.evaluate((from) => {
    const scene = window.__city.scene;
    const quiet = scene.getObjectByName("works:marker:owned");
    if (quiet) quiet.visible = false;

    const playable = new Map();
    scene.traverse((object) => {
      for (const m of [object.material ?? []].flat()) {
        if (m?.color && m.name && !playable.has(m.name)) playable.set(m.name, m.color.clone());
      }
    });
    scene.getObjectByName("surroundings")?.traverse((object) => {
      for (const m of [object.material ?? []].flat()) {
        const was = playable.get(from[m?.name]);
        if (was) m.color.copy(was);
      }
    });
  }, FROM);

  await shoot("-before");
  await page.close();
}

await browser.close();
