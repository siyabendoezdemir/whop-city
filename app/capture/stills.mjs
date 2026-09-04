import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";

import { APP_URL, artifactPath, launchOptions, openCity, shoot } from "./env.mjs";

/**
 * Production route stills.
 *
 * Photographs the real app route — not a harness page — in each of the
 * projection states the fixture adapter can produce.
 *
 * District views are driven by clicking the district button rather than by
 * calling the camera hook, so what is photographed is the product doing the
 * thing: the camera glides in and the contextual explanation opens with it.
 */

const SS = Number(process.env.SS ?? 2);
/** A fixed clock, so the ambient life is in the same place every run. */
const CLOCK = 6;

const DISTRICTS = [
  ["commerce-core", "city-commerce-core.png"],
  ["offer-forge", "city-offer-forge.png"],
  ["creator-quarter", "city-creator-quarter.png"],
];

/** Each is a different projection, so each is a different world. */
const STATES = [
  ["launch", "state-rising.png", "everything new: rising"],
  ["thriving", "state-thriving.png", "established: healthy"],
  ["struggling", "state-struggling.png", "shuttered: struggling"],
  ["unavailable", "state-unavailable.png", "unreadable: dormant"],
];

const browser = await chromium.launch(launchOptions());
console.log(`capturing ${APP_URL} at ss=${SS}`);

const stats = {};

async function record(page, label) {
  const info = await page.evaluate(() => window.__city.info());
  stats[label] = info;
  console.log(
    `  ${label.padEnd(28)} ${String(info.drawCalls).padStart(3)} calls / ` +
      `${info.triangles.toLocaleString().padStart(9)} tris / ${info.propInstances} instances`,
  );
  return info;
}

// ------------------------------------------------------------- default city
{
  const page = await openCity(browser, { ss: SS });
  await page.evaluate((t) => window.__city.frame("city", t), CLOCK);
  await shoot(page, "city-default.png");
  await record(page, "city-default.png");
  await page.close();
}

// ---------------------------------------------------------- district framing
for (const [district, file] of DISTRICTS) {
  const page = await openCity(browser, { ss: SS });
  // The product interaction, not the capture hook: this is what a visitor does.
  await page.click(`.city-jump button[data-district="${district}"]`);
  await page.waitForSelector(`.city-place[data-district="${district}"]`, { timeout: 15_000 });
  await page.evaluate((t) => window.__city.renderFrame(t), CLOCK);
  await shoot(page, file);
  const explanation = await page.textContent(".city-place__explain");
  await record(page, file);
  console.log(`    panel: ${explanation}`);
  await page.close();
}

// --------------------------------------------------------- state evidence
for (const [scenario, file, label] of STATES) {
  const page = await openCity(browser, { scenario, ss: SS });
  await page.evaluate((t) => window.__city.frame("city", t), CLOCK);
  await shoot(page, file);
  await record(page, file);
  console.log(`    ${label}`);
  await page.close();
}

// ----------------------------------------------------------------- silhouette
{
  const page = await openCity(browser, { ss: SS });
  await page.evaluate((t) => {
    window.__city.frame("city", t);
    window.__city.silhouette(true);
  }, CLOCK);
  await page.locator("canvas").screenshot({ path: artifactPath("city-silhouette.png") });
  console.log("  city-silhouette.png");
  await page.close();
}

writeFileSync(artifactPath("renderer-stats.json"), `${JSON.stringify(stats, null, 2)}\n`);

const worst = Object.entries(stats).reduce(
  (max, [, info]) => ({
    drawCalls: Math.max(max.drawCalls, info.drawCalls),
    triangles: Math.max(max.triangles, info.triangles),
  }),
  { drawCalls: 0, triangles: 0 },
);
console.log(
  `\nworst case: ${worst.drawCalls} draw calls (budget 220), ` +
    `${worst.triangles.toLocaleString()} triangles (budget 250,000)`,
);
if (worst.drawCalls > 220 || worst.triangles > 250_000) {
  console.error("OVER BUDGET");
  process.exitCode = 1;
}

await browser.close();
console.log("done");
