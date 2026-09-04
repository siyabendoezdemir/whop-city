import { chromium } from "@playwright/test";

import { APP_URL, artifactPath, launchOptions, openCity, shoot } from "./env.mjs";

/**
 * Evidence for the operator loop.
 *
 * Photographs the real route being used: the queue ranking, a district selected
 * by clicking its marker in the world, moves being reviewed, a district
 * resolving, the change notice, and the unreadable city.
 *
 * Needs a fixtures build (`pnpm build:fixtures`) so districts can be put in
 * known states. Everything captured is the same code a live deployment runs.
 */

const SS = Number(process.env.SS ?? 2);
const CLOCK = 6;

const browser = await chromium.launch(launchOptions());
console.log(`capturing the operator loop at ${APP_URL} (ss=${SS})`);

/** Click a district's marker where it actually is on screen. */
async function clickMarker(page, districtId) {
  const point = await page.evaluate((id) => window.__city.markerPoint(id), districtId);
  if (!point) throw new Error(`no marker on screen for ${districtId}`);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(250);
}

async function settle(page) {
  await page.evaluate((t) => window.__city.renderFrame(t), CLOCK);
  await page.waitForTimeout(120);
}

// 1. The signal: a city asking for attention, nothing selected yet.
{
  const page = await openCity(browser, { scenario: "struggling", ss: SS });
  await page.evaluate((t) => window.__city.frame("city", t), CLOCK);
  await shoot(page, "loop-1-signal.png");
  console.log("  loop-1-signal.png        queue ranked, markers lit");
  await page.close();
}

// 2. The focus: selected by clicking the marker in the world.
{
  const page = await openCity(browser, { scenario: "struggling", ss: SS });
  await clickMarker(page, "commerce-core");
  await settle(page);
  await shoot(page, "loop-2-focus.png");
  console.log(
    "  loop-2-focus.png         briefing:",
    (await page.textContent(".city-brief__reading")).slice(0, 60),
  );
  await page.close();
}

// 3. Review and resolve: every move ticked, district cleared.
{
  const page = await openCity(browser, { scenario: "struggling", ss: SS });
  await clickMarker(page, "creator-quarter");
  const moves = page.locator(".city-move__mark");
  const total = await moves.count();
  for (let i = 0; i < total; i++) await moves.nth(i).click();
  await page.waitForTimeout(250);
  await settle(page);
  await shoot(page, "loop-3-resolved.png");
  console.log(
    "  loop-3-resolved.png      progress:",
    await page.textContent("[data-testid=district-progress]"),
    "| queue:",
    await page.textContent('.city-queue__item[data-district="creator-quarter"] .city-queue__status'),
  );
  await page.close();
}

// 4. Progression across a change: reviewed in one state, read in another.
{
  const page = await openCity(browser, { scenario: "struggling", ss: SS });
  await clickMarker(page, "commerce-core");
  await page.locator(".city-move__mark").first().click();
  await page.waitForTimeout(200);

  await page.goto(`${APP_URL}/?capture=1&ss=${SS}&scenario=thriving`, { waitUntil: "load" });
  await page.waitForFunction(() => (window.__city?.info().parcels ?? 0) > 0, null, { timeout: 60_000 });
  await clickMarker(page, "commerce-core");
  await settle(page);
  await shoot(page, "loop-4-changed.png");
  console.log(
    "  loop-4-changed.png       notice:",
    (await page.textContent(".city-brief__changed")).slice(0, 60),
  );
  await page.close();
}

// 5. No reading: no ranking, no moves, and the city says so.
{
  const page = await openCity(browser, { scenario: "unavailable", ss: SS });
  await clickMarker(page, "commerce-core");
  await settle(page);
  await shoot(page, "loop-5-unavailable.png");
  console.log(
    "  loop-5-unavailable.png   moves offered:",
    await page.locator(".city-move__mark").count(),
  );
  await page.close();
}

// 6. The approved world, unchanged, with markers off for comparison.
{
  const page = await openCity(browser, { ss: SS });
  await page.evaluate((t) => window.__city.frame("city", t), CLOCK);
  const info = await page.evaluate(() => window.__city.info());
  await shoot(page, "loop-6-default.png");
  console.log(
    `  loop-6-default.png       ${info.drawCalls} draw calls / ${info.triangles.toLocaleString()} triangles`,
  );
  await page.close();
}

await browser.close();
console.log(`done -> ${artifactPath("")}`);
