import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

import { APP_URL, artOut, launchOptions, openCity } from "./env.mjs";

/**
 * Every plot, at every level, on its own.
 *
 * Eleven parcels across six levels is sixty-six states, and the only way any
 * of them is ever seen in the product is by a business earning exactly that
 * much. So the levels are set directly and each plot is photographed alone,
 * with the rest of the city knocked back to vacant ground so nothing behind it
 * can be mistaken for part of it.
 *
 * The output is one contact sheet per plot: six frames left to right, empty
 * ground through to the top. Reviewing a building means looking at its row.
 *
 *   node capture/plots.mjs [plotId...]
 */

/**
 * Where each plot is, and how much room its tallest state needs.
 *
 * The frame grows with the level and the camera target rises with it, because
 * a framing that holds a five-storey tower makes a vacant lot a speck and one
 * that holds the vacant lot crops the tower off at the fourth floor.
 */
const PLOTS = [
  { id: "core-landmark", at: [20, -62], near: 34, far: 88 },
  { id: "core-north", at: [-12, -64], near: 34, far: 84 },
  { id: "core-east", at: [20, -34], near: 34, far: 80 },
  { id: "core-southeast", at: [-14, -34], near: 30, far: 72 },
  { id: "forge-hero", at: [-46, -8], near: 36, far: 66 },
  { id: "forge-north", at: [-46, -42], near: 32, far: 60 },
  { id: "forge-south", at: [-46, 22], near: 30, far: 56 },
  { id: "creator-park", at: [-14, 8], near: 32, far: 62 },
  { id: "creator-terrace", at: [18, 8], near: 30, far: 58 },
  { id: "creator-venue", at: [48, 8], near: 32, far: 62 },
  { id: "creator-struggling", at: [72, 8], near: 26, far: 48 },
];

const wanted = process.argv.slice(2);
const chosen = wanted.length > 0 ? PLOTS.filter((plot) => wanted.includes(plot.id)) : PLOTS;
const LEVELS = [0, 1, 2, 3, 4, 5];
const SS = Number(process.env.SS ?? 1);
/**
 * Wide enough that the game will run.
 *
 * Below 900 by 560 the shell decides this is a phone and shows the
 * come-back-on-a-desktop screen instead of a city, so the tiles are cropped out
 * of a legal viewport rather than rendered at their own size.
 */
const VIEW = { width: 960, height: 620 };
const TILE = { width: 620, height: 460 };

const scratch = resolve(artOut(), ".plots");
rmSync(scratch, { recursive: true, force: true });
mkdirSync(scratch, { recursive: true });

const browser = await chromium.launch(launchOptions());
const page = await openCity(browser, { scenario: "thriving", ss: SS, view: VIEW });
page.on("pageerror", (error) => console.log("PAGE ERROR:", String(error).slice(0, 200)));

// Hide the interface. This is a review of the world, and a heads-up display
// over a 640-pixel frame covers most of the building under review.
await page.addStyleTag({
  content:
    ".crest,.res,.corner,.rail,.feed,.pops,.camera,.nudge,.toast,.ready,.quest,.card,.away" +
    "{display:none!important}",
});

// A centred crop of the canvas: the framing puts the plot in the middle, and
// the tile only has to hold the plot.
const canvas = await page.locator("canvas").boundingBox();
const clip = {
  x: canvas.x + (canvas.width - TILE.width) / 2,
  y: canvas.y + (canvas.height - TILE.height) / 2,
  width: TILE.width,
  height: TILE.height,
};

/** Everything vacant, and the pin taken, before the first tile is shot. */
await page.evaluate(
  (ids) => window.__city.setLevels(Object.fromEntries(ids.map((id) => [id, 0]))),
  PLOTS.map((entry) => entry.id),
);
await page.waitForTimeout(500);

for (const plot of chosen) {
  const tiles = [];
  for (const level of LEVELS) {
    // Everything else vacant, so the plot under review is the only thing built.
    await page.evaluate(
      ([ids, id, at]) => {
        const levels = Object.fromEntries(ids.map((key) => [key, 0]));
        window.__city.setLevels({ ...levels, [id]: at });
      },
      [PLOTS.map((entry) => entry.id), plot.id, level],
    );
    const k = level / 5;
    const height = plot.near + (plot.far - plot.near) * k;
    // Lift the target with the building so a tower is centred, not decapitated.
    const lift = (height - plot.near) * 0.34;
    await page.evaluate(
      ([at, h, y]) => window.__city.frameAt([at[0], y, at[1]], h, 6),
      [plot.at, height, lift],
    );
    const file = resolve(scratch, `${plot.id}-${level}.png`);
    await page.screenshot({ path: file, clip, timeout: 240_000, animations: "disabled" });
    tiles.push(file);
    process.stdout.write(".");
  }

  const sheet = resolve(artOut(), `plot_${plot.id}.png`);
  execFileSync(
    "ffmpeg",
    [
      "-y",
      ...tiles.flatMap((tile) => ["-i", tile]),
      "-filter_complex",
      // Two rows of three: six frames side by side are too small to judge.
      `[0:v][1:v][2:v]hstack=inputs=3[top];[3:v][4:v][5:v]hstack=inputs=3[low];` +
        `[top][low]vstack=inputs=2`,
      sheet,
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  console.log(` ${plot.id}`);
}

await browser.close();
console.log(`\ncontact sheets in ${artOut()}`);
for (const file of readdirSync(artOut()).filter((name) => name.startsWith("plot_"))) {
  console.log(`  ${file}`);
}
