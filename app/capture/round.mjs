import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

import { APP_URL, artifactPath, framesDir, launchOptions, openCity, shoot } from "./env.mjs";

/**
 * Evidence for the interface.
 *
 * Plays the round the way a person plays it and photographs each beat, then
 * strings the beats into a recording. A video of a WebGL city cannot be
 * recorded live on a machine with no GPU — presenting a frame costs seconds
 * there, whatever route it is read back through — so the film is the real
 * frames, held at reading pace.
 *
 * Clicks are forced. Playwright waits for an element's box to be unchanged
 * across two animation frames before acting, and in capture mode this page
 * deliberately runs no animation loop, so that probe can outlast its own
 * timeout on a control that has not moved. Elements are visible and enabled;
 * only the stability probe is skipped.
 *
 * Needs a fixtures build (`pnpm build:fixtures`). Every scenario is named in
 * the output and in the file names, because these are fixtures, not a live
 * business.
 */

const SS = Number(process.env.SS ?? 1);
const CLOCK = 6;
const HOLD = 2.7;
const FPS = 12;
const PHONE = { width: 390, height: 780 };

const browser = await chromium.launch(launchOptions());
console.log(`playing the round at ${APP_URL} (ss=${SS}) — every scenario below is a FIXTURE`);

const film = [];

async function beat(page, name, note, { inFilm = true } = {}) {
  await page.evaluate((t) => window.__city.renderFrame(t), CLOCK);
  await page.waitForTimeout(120);
  await shoot(page, `${name}.png`);
  if (inFilm) film.push(`${name}.png`);
  console.log(`  ${name.padEnd(26)} ${note}`);
}

const tap = (page, selector) => page.click(selector, { force: true });

async function toCity(page) {
  const back = page.locator(".bar__back");
  if (await back.count()) await back.click({ force: true });
  await page.evaluate(() => window.__city.frame("city", 6));
}

/** Enter a district by clicking it in the world, as a player does. */
async function enter(page, districtId) {
  await toCity(page);
  const point = await page.evaluate((id) => window.__city.markerPoint(id), districtId);
  await page.mouse.click(point.x, point.y);
  await page.waitForSelector(`.dossier[data-district="${districtId}"]`);
  await page.evaluate((id) => window.__city.frame(id, 6), districtId);
}

async function answer(page, prefer) {
  for (const wanted of prefer) {
    const button = page.locator(`[data-answer="${wanted}"]`);
    if (await button.count()) {
      await button.first().click({ force: true });
      await page.waitForTimeout(140);
      return;
    }
  }
  await page.locator(".answers .answer, .fork__options .plate").first().click({ force: true });
  await page.waitForTimeout(140);
}

// -------------------------------------------------------------- arrive, act
{
  const page = await openCity(browser, { scenario: "struggling", ss: SS });
  await toCity(page);
  await beat(page, "ui-1-rest", "FIXTURE struggling: the resting city — seal, one control, camera");

  await tap(page, '[data-action="about"]');
  await page.waitForTimeout(200);
  await beat(page, "ui-2-about", "what this is, and whose, on demand rather than on arrival");
  await tap(page, '[data-action="about-done"]');

  await enter(page, "commerce-core");
  await beat(page, "ui-3-district", "entering a district: identity, condition, one next action");

  await tap(page, ".why__summary");
  await page.waitForTimeout(180);
  await beat(page, "ui-4-evidence", "the observation and its ambiguity, one click away");
  await tap(page, ".why__summary");

  await answer(page, ["problem"]);
  await beat(page, "ui-5-survey", "a survey: the answered step collapses, carrying what you said");

  await page.fill(
    '[data-testid="note"]',
    "Support said two products went hidden after the migration. Check both before Friday's sale.",
  );
  await page.locator('[data-testid="note"]').blur();
  await page.waitForTimeout(250);
  await page.evaluate(() => (document.querySelector(".dossier").scrollTop = 420));
  await beat(page, "ui-5b-note", "the operator's own line, kept in this browser and added to the plan");
  await page.evaluate(() => (document.querySelector(".dossier").scrollTop = 0));

  await answer(page, ["confirmed"]);
  await answer(page, ["confirmed"]);
  await answer(page, ["problem"]);
  await toCity(page);
  await beat(page, "ui-6-worked", "worked, still not adding up: the hazard mark is still standing");

  await enter(page, "creator-quarter");
  await beat(page, "ui-7-optional", "a fork: affiliates asked about, not assumed");

  await tap(page, '.plate[data-answer="no"]');
  await page.waitForTimeout(200);
  await beat(page, "ui-8-declined", "set aside deliberately — an outcome, not a gap");
  await page.close();
}

// ------------------------------------------------------------ a new business
{
  const page = await openCity(browser, { scenario: "blank", ss: SS });
  await toCity(page);
  await beat(page, "ui-9-blank", "FIXTURE blank: a new business gets a different round");

  await enter(page, "offer-forge");
  await beat(page, "ui-10-decision", "a pricing decision, composed as a fork rather than a form");
  await page.close();
}

// ----------------------------------------------------------- payoff, return
{
  const page = await openCity(browser, { scenario: "thriving", ss: SS });
  for (const id of ["commerce-core", "offer-forge", "creator-quarter"]) {
    await enter(page, id);
    for (let guard = 0; guard < 8; guard++) {
      if ((await page.locator(".act[data-prompt]").count()) === 0) break;
      await answer(page, ["confirmed", "keep", "fine", "will-do"]);
    }
  }
  await page.waitForTimeout(300);
  await beat(page, "ui-11-plan", "FIXTURE thriving: the round's deliverable, observed and reported apart");

  // Filing keeps the round; it is not the same act as throwing it away.
  await tap(page, '[data-action="new-round"]');
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__city.frame("city", 6));
  await beat(page, "ui-11b-newround", "filed, and a fresh round open — the finished one is kept");

  await page.keyboard.press("p");
  await page.waitForTimeout(200);
  await tap(page, ".filed__summary");
  await page.waitForTimeout(200);
  await beat(page, "ui-11c-filed", "earlier rounds, still copyable and downloadable");
  await tap(page, '[data-action="close-plan"]');

  await page.goto(`${APP_URL}/?capture=1&ss=${SS}&scenario=struggling`, { waitUntil: "load" });
  await page.waitForFunction(() => (window.__city?.info().parcels ?? 0) > 0, null, { timeout: 60_000 });
  await enter(page, "commerce-core");
  await beat(page, "ui-12-return", "returning to a changed reading: kept, flagged, not claimed");
  await page.close();
}

// ---------------------------------------------------------------- no reading
{
  const page = await openCity(browser, { scenario: "unavailable", ss: SS });
  await enter(page, "commerce-core");
  await beat(page, "ui-13-unavailable", "FIXTURE unavailable: no reading, so nothing suggested");
  const info = await page.evaluate(() => window.__city.info());
  console.log(`\n  renderer: ${info.drawCalls} draw calls / ${info.triangles.toLocaleString()} triangles`);
  await page.close();
}

// -------------------------------------------------------------------- phone
{
  const page = await openCity(browser, { scenario: "struggling", ss: SS, view: PHONE });
  await toCity(page);
  await beat(page, "ui-14-phone-rest", "FIXTURE struggling on a phone: the city fills the window", {
    inFilm: false,
  });
  await tap(page, '.stud[data-district="commerce-core"]');
  await page.waitForSelector(".dossier");
  await page.evaluate(() => window.__city.frame("commerce-core", 6));
  await beat(page, "ui-15-phone-district", "the sheet takes the lower part; the city keeps the top", {
    inFilm: false,
  });

  await tap(page, '[data-answer="problem"]');
  await page.fill('[data-testid="note"]', "Two hidden after the migration — check both before Friday.");
  await page.locator('[data-testid="note"]').blur();
  await page.evaluate(() => {
    const sheet = document.querySelector(".dossier");
    sheet.scrollTop = sheet.scrollHeight;
  });
  await beat(page, "ui-16-phone-note", "typing on a phone, with the last line clear of the bar", {
    inFilm: false,
  });
  await page.close();
}

// ----------------------------------------------------------------- the film
const FRAMES = framesDir();
for (const file of readdirSync(FRAMES)) rmSync(resolve(FRAMES, file), { recursive: true });
mkdirSync(FRAMES, { recursive: true });

let index = 0;
for (const name of film) {
  for (let hold = 0; hold < Math.round(HOLD * FPS); hold++) {
    execFileSync("cp", [artifactPath(name), resolve(FRAMES, `f${String(index).padStart(5, "0")}.png`)]);
    index++;
  }
}

const out = artifactPath("city-round.mp4");
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
console.log(`wrote ${out}: ${film.length} beats, ${(index / FPS).toFixed(1)}s`);
