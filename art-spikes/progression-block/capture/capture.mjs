import { existsSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";

/**
 * Capture harness.
 *
 * Everything here is deterministic: the page renders by frame index, not by
 * clock, so the stills and the video are reproducible from the same seed.
 */

const OUT = process.env.ART_OUT ?? "/opt/cursor/artifacts";
const FRAMES = "/tmp/whop-spike/art-frames";
const URL_BASE = "http://127.0.0.1:5180/?bare=1";
const STATES = ["dormant", "rising", "healthy", "struggling"];
const FPS = 30;
const SECONDS = 12;

const GL_ARGS = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
];

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: GL_ARGS });
const page = await browser.newPage({ viewport: { width: 1500, height: 960 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.log("PAGE ERROR:", String(e).slice(0, 300)));

await page.goto(URL_BASE, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready === true, { timeout: 60000 });
await page.waitForTimeout(1200);

const canvas = page.locator("canvas");
const stats = {};

// -------------------------------------------------------------- four stills
for (const state of STATES) {
  await page.evaluate((s) => window.__setState(s), state);
  await page.waitForTimeout(900);
  await canvas.screenshot({ path: `${OUT}/${state}.png` });
  stats[state] = await page.evaluate(() => window.__info());
  console.log(`still ${state.padEnd(11)} ${JSON.stringify(stats[state])}`);
}

// ------------------------------------------------------ silhouette contact
// Flat black on white: proves the block is recognisable as a shape, and that
// the same landmark spine survives every state.
for (const state of STATES) {
  await page.evaluate((s) => window.__setState(s), state);
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__silhouette(true));
  await page.waitForTimeout(400);
  await canvas.screenshot({ path: `${FRAMES}/sil-${state}.png` });
  await page.evaluate(() => window.__silhouette(false));
  await page.waitForTimeout(200);
}
console.log("silhouette frames captured");

// Stitch the four silhouettes into one contact sheet.
execFileSync("ffmpeg", [
  "-y",
  "-i", `${FRAMES}/sil-dormant.png`,
  "-i", `${FRAMES}/sil-rising.png`,
  "-i", `${FRAMES}/sil-healthy.png`,
  "-i", `${FRAMES}/sil-struggling.png`,
  "-filter_complex",
  "[0:v]scale=720:-1[a];[1:v]scale=720:-1[b];[2:v]scale=720:-1[c];[3:v]scale=720:-1[d];" +
    "[a][b]hstack[top];[c][d]hstack[bot];[top][bot]vstack",
  `${OUT}/silhouette_contact_sheet.png`,
], { stdio: "pipe" });
console.log("silhouette contact sheet written");

// ------------------------------------------------------------------- video
const total = FPS * SECONDS;
const started = Date.now();
for (let frame = 0; frame < total; frame++) {
  await page.evaluate((f) => window.__renderFrame(f), frame);
  await canvas.screenshot({ path: `${FRAMES}/f${String(frame).padStart(4, "0")}.png` });
  if (frame % 30 === 0) {
    const rate = (frame + 1) / ((Date.now() - started) / 1000);
    console.log(`frame ${frame}/${total}  ${rate.toFixed(1)} fps capture`);
  }
}
console.log(`captured ${total} frames in ${((Date.now() - started) / 1000).toFixed(0)}s`);

execFileSync("ffmpeg", [
  "-y",
  "-framerate", String(FPS),
  "-i", `${FRAMES}/f%04d.png`,
  "-c:v", "libx264",
  "-preset", "medium",
  "-crf", "20",
  "-pix_fmt", "yuv420p",
  "-movflags", "+faststart",
  `${OUT}/offer_forge_progression.mp4`,
], { stdio: "pipe" });
console.log("video written");

console.log("\nrenderer stats by state:");
for (const [state, info] of Object.entries(stats)) {
  console.log(`  ${state.padEnd(11)} triangles=${info.triangles} drawCalls=${info.calls} instances=${info.instances} prototypes=${info.prototypes} geometries=${info.geometries} textures=${info.textures}`);
}

await browser.close();
