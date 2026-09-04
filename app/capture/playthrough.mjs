import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

import { APP_URL, artifactPath, framesDir, launchOptions, openCity, shoot } from "./env.mjs";

/**
 * Evidence for the operator session.
 *
 * Clicks are forced. Playwright waits for an element's box to be stable across
 * animation frames before acting, and in capture mode this page deliberately
 * does not run an animation loop, so that check can outlast its own timeout on
 * a machine where presenting a frame takes seconds. The elements are visible
 * and enabled; only the stability probe is skipped.
 *
 * Plays the loop the way a person plays it — clicking markers in the world,
 * answering prompts, reaching the plan — and photographs each beat. The same
 * frames are then held and strung into a short recording, because a video of a
 * WebGL city cannot be recorded live on a machine with no GPU: presenting a
 * frame costs seven to fourteen seconds there, whatever route it is read back
 * through.
 *
 * Needs a fixtures build (`pnpm build:fixtures`). Every scenario is named in
 * the console output and in the file names, because these are fixtures, not a
 * live business.
 */

const SS = Number(process.env.SS ?? 2);
const CLOCK = 6;
/** Seconds each beat is held in the recording. */
const HOLD = 2.6;
const FPS = 12;

const browser = await chromium.launch(launchOptions());
console.log(`playing the session at ${APP_URL} (ss=${SS}) — all scenarios are FIXTURES`);

const beats = [];

async function beat(page, name, note) {
  await page.evaluate((t) => window.__city.renderFrame(t), CLOCK);
  await page.waitForTimeout(120);
  await shoot(page, `${name}.png`);
  beats.push(`${name}.png`);
  console.log(`  ${name.padEnd(26)} ${note}`);
}

async function pickDistrict(page, districtId) {
  await page.click('.city-jump button[data-district="city"]', { force: true });
  await page.evaluate(() => window.__city.frame("city", 6));
  const point = await page.evaluate((id) => window.__city.markerPoint(id), districtId);
  await page.mouse.click(point.x, point.y);
  await page.waitForSelector(`.city-brief[data-district="${districtId}"]`);
  await page.evaluate((id) => window.__city.frame(id, 6), districtId);
}

// ---------------------------------------------------------------- first visit
{
  const page = await openCity(browser, { scenario: "struggling", ss: SS });
  await beat(page, "play-1-orientation", "first visit: whose city, and what City can see");

  await page.click('[data-action="orient-done"]', { force: true });
  await page.waitForTimeout(300);
  await page.click('.city-jump button[data-district="city"]', { force: true });
  await page.evaluate(() => window.__city.frame("city", 6));
  await beat(page, "play-2-signal", "FIXTURE struggling: two districts reading wrong, one unbuilt");

  await pickDistrict(page, "commerce-core");
  await beat(page, "play-3-reading", "the reading, its ambiguity, and the limit of what City knows");

  await page.click('.answer[data-answer="problem"]', { force: true });
  await page.waitForTimeout(250);
  await beat(page, "play-4-finding", "a finding recorded; an action lands in the plan");

  await page.click('.answer[data-answer="confirmed"]', { force: true });
  await page.waitForTimeout(200);
  await page.click('.answer[data-answer="confirmed"]', { force: true });
  await page.waitForTimeout(200);
  await page.click('.answer[data-answer="problem"]', { force: true });
  await page.waitForTimeout(300);
  await page.click('.city-jump button[data-district="city"]', { force: true });
  await page.evaluate(() => window.__city.frame("city", 6));
  await beat(page, "play-5-worked", "worked, and still reading wrong: two marks, not one");

  await pickDistrict(page, "creator-quarter");
  await beat(page, "play-6-optional", "affiliates are optional; declining is an answer");

  await page.click('.answer[data-answer="no"]', { force: true });
  await page.waitForTimeout(300);
  await beat(page, "play-7-declined", "decided against, recorded as a decision");

  await page.close();
}

// ------------------------------------------------------------- brand new city
{
  const page = await openCity(browser, { scenario: "blank", ss: SS });
  const go = page.locator('[data-action="orient-done"]');
  if (await go.count()) await go.click({ force: true });
  await page.click('.city-jump button[data-district="city"]', { force: true });
  await page.evaluate(() => window.__city.frame("city", 6));
  await beat(page, "play-8-blank", "FIXTURE blank: a new business gets a different session");

  await pickDistrict(page, "offer-forge");
  await beat(page, "play-9-decision", "a branching pricing decision, not a checklist");

  await page.click('.answer[data-answer="ongoing"]', { force: true });
  await page.waitForTimeout(300);
  await beat(page, "play-10-branch", "the answer chose what comes next");
  await page.close();
}

// -------------------------------------------------------------- payoff, return
{
  const page = await openCity(browser, { scenario: "thriving", ss: SS });
  const go = page.locator('[data-action="orient-done"]');
  if (await go.count()) await go.click({ force: true });

  for (const id of ["commerce-core", "offer-forge", "creator-quarter"]) {
    await pickDistrict(page, id);
    for (let guard = 0; guard < 8; guard++) {
      if ((await page.locator(".prompt").count()) === 0) break;
      const answers = page.locator(".prompt__answers .answer");
      let clicked = false;
      for (const wanted of ["confirmed", "keep", "fine", "will-do"]) {
        const button = page.locator(`.prompt__answers .answer[data-answer="${wanted}"]`);
        if (await button.count()) {
          await button.first().click({ force: true });
          clicked = true;
          break;
        }
      }
      if (!clicked) await answers.first().click({ force: true });
      await page.waitForTimeout(150);
    }
  }
  await page.waitForTimeout(400);
  await beat(page, "play-11-plan", "FIXTURE thriving: the round finishes and the plan is the payoff");

  // Return: the same browser, a business that now reads differently.
  await page.goto(`${APP_URL}/?capture=1&ss=${SS}&scenario=struggling`, { waitUntil: "load" });
  await page.waitForFunction(() => (window.__city?.info().parcels ?? 0) > 0, null, { timeout: 60_000 });
  const again = page.locator('[data-action="orient-done"]');
  if (await again.count()) await again.click({ force: true });
  await pickDistrict(page, "commerce-core");
  await beat(page, "play-12-return", "returning to a changed reading: kept, flagged, not claimed");
  await page.close();
}

// ---------------------------------------------------------------- no reading
{
  const page = await openCity(browser, { scenario: "unavailable", ss: SS });
  const go = page.locator('[data-action="orient-done"]');
  if (await go.count()) await go.click({ force: true });
  await pickDistrict(page, "commerce-core");
  await beat(page, "play-13-unavailable", "FIXTURE unavailable: no reading, so no work proposed");

  const info = await page.evaluate(() => window.__city.info());
  console.log(`\n  renderer: ${info.drawCalls} draw calls / ${info.triangles.toLocaleString()} triangles`);
  await page.close();
}

// ---------------------------------------------------------------- the film
const FRAMES = framesDir();
for (const file of readdirSync(FRAMES)) rmSync(resolve(FRAMES, file), { recursive: true });
mkdirSync(FRAMES, { recursive: true });

let index = 0;
for (const name of beats) {
  for (let hold = 0; hold < Math.round(HOLD * FPS); hold++) {
    execFileSync("cp", [artifactPath(name), resolve(FRAMES, `f${String(index).padStart(5, "0")}.png`)]);
    index++;
  }
}

const out = artifactPath("city-playthrough.mp4");
execFileSync(
  "ffmpeg",
  [
    "-y",
    "-framerate", String(FPS),
    "-i", resolve(FRAMES, "f%05d.png"),
    "-an",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-crf", "20",
    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    out,
  ],
  { stdio: ["ignore", "ignore", "inherit"] },
);

await browser.close();
console.log(`wrote ${out}: ${beats.length} beats, ${(index / FPS).toFixed(1)}s`);
