import { execFileSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

import { DEV_URL, artOut, framesDir, launchOptions } from "./env.mjs";

/**
 * Capture harness.
 *
 * Deterministic by construction: the page renders by frame index, not by clock,
 * so the stills and the video reproduce exactly from the same seed.
 */

const OUT = artOut();
const FRAMES = framesDir();
const STATES = ["dormant", "rising", "healthy", "struggling"];
const FPS = 30;
const SECONDS = 12;

function ffmpeg(args) {
  try {
    execFileSync("ffmpeg", args, { stdio: "pipe" });
  } catch (error) {
    throw new Error(
      `ffmpeg failed or is not on PATH. Install it, or set PATH to include it.\n${String(error.stderr ?? error.message).slice(0, 400)}`,
    );
  }
}

for (const file of readdirSync(FRAMES)) rmSync(join(FRAMES, file), { force: true });

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: 1500, height: 960 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.log("PAGE ERROR:", String(e).slice(0, 300)));

console.log(`output   -> ${OUT}`);
console.log(`frames   -> ${FRAMES}`);
console.log(`page     -> ${DEV_URL}`);

await page.goto(`${DEV_URL}/?bare=1`, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready === true, { timeout: 60000 });
await page.waitForTimeout(1200);

const canvas = page.locator("canvas");
const stats = {};

// -------------------------------------------------------------- four stills
// Frame 0 of each state's dwell, so the still matches the video's first beat.
for (const state of STATES) {
  await page.evaluate((s) => window.__setState(s), state);
  await page.waitForTimeout(900);
  await page.evaluate(() => window.__renderStill());
  await canvas.screenshot({ path: `${OUT}/${state}.png` });
  stats[state] = await page.evaluate(() => window.__info());
  console.log(`still ${state.padEnd(11)} ${JSON.stringify(stats[state])}`);
}

// ------------------------------------------------------ silhouette contact
for (const state of STATES) {
  await page.evaluate((s) => window.__setState(s), state);
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__silhouette(true));
  await page.waitForTimeout(450);
  await canvas.screenshot({ path: `${FRAMES}/sil-${state}.png` });
  await page.evaluate(() => window.__silhouette(false));
  await page.waitForTimeout(250);
}
ffmpeg([
  "-y",
  "-i", `${FRAMES}/sil-dormant.png`,
  "-i", `${FRAMES}/sil-rising.png`,
  "-i", `${FRAMES}/sil-healthy.png`,
  "-i", `${FRAMES}/sil-struggling.png`,
  "-filter_complex",
  "[0:v]scale=720:-1,pad=iw:ih+2:0:0:white[a];[1:v]scale=720:-1,pad=iw:ih+2:0:0:white[b];" +
    "[2:v]scale=720:-1,pad=iw:ih+2:0:0:white[c];[3:v]scale=720:-1,pad=iw:ih+2:0:0:white[d];" +
    "[a][b]hstack[top];[c][d]hstack[bot];[top][bot]vstack",
  `${OUT}/silhouette_contact_sheet.png`,
]);
console.log("silhouette contact sheet written");

// ------------------------------------------------------------------- video
const total = FPS * SECONDS;
const started = Date.now();
for (let frame = 0; frame < total; frame++) {
  await page.evaluate((f) => window.__renderFrame(f), frame);
  await canvas.screenshot({ path: `${FRAMES}/f${String(frame).padStart(4, "0")}.png` });
  if (frame % 60 === 0) {
    const rate = (frame + 1) / ((Date.now() - started) / 1000);
    console.log(`frame ${frame}/${total}  ${rate.toFixed(1)} fps capture`);
  }
}
console.log(`captured ${total} frames in ${((Date.now() - started) / 1000).toFixed(0)}s`);

ffmpeg([
  "-y",
  "-framerate", String(FPS),
  "-i", `${FRAMES}/f%04d.png`,
  "-c:v", "libx264",
  "-preset", "medium",
  "-crf", "20",
  "-pix_fmt", "yuv420p",
  "-movflags", "+faststart",
  `${OUT}/offer_forge_progression.mp4`,
]);
console.log("video written");

console.log("\nrenderer stats by state:");
console.log("  state        triangles  calls  instances  prototypes  geometries  textures");
for (const [state, i] of Object.entries(stats)) {
  console.log(
    `  ${state.padEnd(12)} ${String(i.triangles).padStart(9)} ${String(i.calls).padStart(6)} ` +
      `${String(i.instances).padStart(10)} ${String(i.prototypes).padStart(11)} ` +
      `${String(i.geometries).padStart(11)} ${String(i.textures).padStart(9)}`,
  );
}

await browser.close();
