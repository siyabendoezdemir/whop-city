import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

import { artOut, launchOptions, openCity } from "./env.mjs";

/**
 * The whole city at one level, from four heights.
 *
 * The plot sheets answer "is this building right"; this answers "does the city
 * read", which is a different question and the one a player actually asks. Run
 * it at 0 to see what an untraded business arrives to, and at 5 to see the
 * payoff.
 *
 *   node capture/survey.mjs [level] [name]
 */

const LEVEL = Number(process.argv[2] ?? 5);
const NAME = process.argv[3] ?? `survey_l${LEVEL}`;
const SS = Number(process.env.SS ?? 1);
const VIEW = { width: 1440, height: 900 };

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

/** Four looks: the whole board, then each district at working distance. */
const SHOTS = [
  { key: "city", at: [-4, 0, -18], height: 132 },
  { key: "core", at: [4, 0, -50], height: 74 },
  { key: "forge", at: [-46, 0, -10], height: 74 },
  { key: "creator", at: [22, 0, 10], height: 78 },
];

const scratch = resolve(artOut(), ".survey");
rmSync(scratch, { recursive: true, force: true });
mkdirSync(scratch, { recursive: true });

const browser = await chromium.launch(launchOptions());
const page = await openCity(browser, { scenario: "thriving", ss: SS, view: VIEW });
page.on("pageerror", (error) => console.log("PAGE ERROR:", String(error).slice(0, 200)));
await page.addStyleTag({
  content:
    ".crest,.res,.corner,.rail,.feed,.pops,.camera,.nudge,.toast,.ready,.quest,.card,.away" +
    "{display:none!important}",
});

await page.evaluate(
  ([ids, level]) => window.__city.setLevels(Object.fromEntries(ids.map((id) => [id, level]))),
  [IDS, LEVEL],
);
await page.waitForTimeout(400);

const tiles = [];
for (const shot of SHOTS) {
  await page.evaluate(([at, h]) => window.__city.frameAt(at, h, 6), [shot.at, shot.height]);
  const file = resolve(scratch, `${shot.key}.png`);
  await page.screenshot({ path: file, timeout: 240_000, animations: "disabled" });
  tiles.push(file);
  process.stdout.write(".");
}

const sheet = resolve(artOut(), `${NAME}.png`);
execFileSync(
  "ffmpeg",
  [
    "-y",
    ...tiles.flatMap((tile) => ["-i", tile]),
    "-filter_complex",
    "[0:v][1:v]hstack=inputs=2[top];[2:v][3:v]hstack=inputs=2[low];[top][low]vstack=inputs=2,scale=1920:-1",
    sheet,
  ],
  { stdio: ["ignore", "ignore", "inherit"] },
);

console.log(`\n${sheet}`);
console.log(JSON.stringify(await page.evaluate(() => window.__city.info())));
await browser.close();
