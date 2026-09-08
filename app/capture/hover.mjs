import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

import { chromium } from "@playwright/test";

import { artifactPath, framesDir, launchOptions, openCity, SHOT_TIMEOUT } from "./env.mjs";

/**
 * The pointer crossing the city, filmed.
 *
 * Hover feedback is the one thing in the game that cannot be photographed: a
 * still of a ring is a still of a ring, and says nothing about whether it
 * follows the pointer, lands on the right plot, or lets go at the edge of the
 * city. It has to be a film.
 *
 * The pointer is drawn in. A screenshot does not include the operating
 * system's cursor, so a film of hovering would otherwise be rings appearing
 * over an empty screen for no visible reason. The marker is placed at the
 * coordinates the pointer was actually moved to, so it is where the mouse is,
 * not an illustration of where it might be.
 */

const STOPS = [
  // Off the city first, so the opening frames establish that nothing is ringed
  // until the pointer is over something of the player's.
  { at: "sky" },
  { at: "plot", id: "forge-hero" },
  { at: "plot", id: "creator-park" },
  { at: "plot", id: "creator-terrace" },
  { at: "plot", id: "creator-venue" },
  { at: "plot", id: "core-southeast" },
  { at: "plot", id: "core-north" },
  { at: "plot", id: "core-landmark" },
  { at: "backdrop" },
  { at: "plot", id: "core-east", click: true },
];

const view = { width: 1200, height: 760 };
const dir = resolve(framesDir(), "hover");
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({
  viewport: view,
  deviceScaleFactor: 1,
  reducedMotion: "reduce",
});
const page = await openCity(browser, { scenario: "thriving", capture: false, ss: 1, context });
await page.waitForTimeout(2500);

await page.addStyleTag({
  content: `
    #shot-pointer {
      position: fixed; z-index: 99999; width: 22px; height: 30px; margin: -2px 0 0 -2px;
      pointer-events: none; transition: none;
      background: no-repeat center/contain url("data:image/svg+xml;utf8,\
<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 22 30'>\
<path d='M2 1 L2 23 L8 17.5 L11.5 26 L15.5 24 L12 16 L20 15.5 Z' fill='white' stroke='%23151a22' stroke-width='2' stroke-linejoin='round'/>\
</svg>");
    }`,
});
await page.evaluate(() => {
  const cursor = document.createElement("div");
  cursor.id = "shot-pointer";
  document.body.append(cursor);
  window.__point = (x, y) => {
    cursor.style.left = `${x}px`;
    cursor.style.top = `${y}px`;
  };
});

let frame = 0;
const shoot = async (holds = 1) => {
  const file = resolve(dir, `${String(frame).padStart(4, "0")}.png`);
  await page.screenshot({ path: file, timeout: SHOT_TIMEOUT });
  for (let copy = 1; copy < holds; copy++) {
    execFileSync("cp", [file, resolve(dir, `${String(frame + copy).padStart(4, "0")}.png`)]);
  }
  frame += holds;
};

for (const stop of STOPS) {
  const to =
    stop.at === "plot"
      ? await page.evaluate((id) => window.__city.plotGround(id), stop.id)
      : stop.at === "sky"
        ? { x: 620, y: 70 }
        : { x: 1090, y: 620 };
  if (!to) continue;

  await page.mouse.move(to.x, to.y);
  await page.evaluate(([x, y]) => window.__point(x, y), [to.x, to.y]);
  await page.waitForTimeout(140);
  await shoot(stop.click ? 3 : 4);

  if (stop.click) {
    await page.mouse.click(to.x, to.y);
    await page.waitForTimeout(900);
    await page.evaluate(([x, y]) => window.__point(x, y), [to.x, to.y]);
    await shoot(10);
  }
  console.log(stop.id ?? stop.at);
}

await browser.close();

const out = artifactPath("hover_rings_follow_the_pointer.mp4");
execFileSync("ffmpeg", [
  "-loglevel", "error", "-y",
  "-framerate", "4",
  "-pattern_type", "glob", "-i", resolve(dir, "*.png"),
  "-vf", "scale=1200:-2,format=yuv420p",
  "-c:v", "libx264", "-crf", "20", "-movflags", "+faststart",
  out,
]);
console.log(out);
