import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";
import { DEV_URL, artOut, framesDir, launchOptions } from "./env.mjs";

/**
 * Full capture harness.
 *
 * Produces every deliverable in one pass: the default city view, one framing
 * per district, the flat-black silhouette composition, and a deterministic
 * fly-through recording. Output lands in ./artifacts unless ART_OUT says
 * otherwise, and the browser is discovered rather than hard-coded, so the same
 * command works locally and in CI.
 */

const OUT = artOut();
const FRAMES = framesDir();
const W = 1440;
const H = 900;
const FPS = 30;

/**
 * The recording. Times are in seconds and drive both the animation clock and
 * the camera, so the same frame index always produces the same image.
 */
const TIMELINE = [
  { kind: "hold", at: "city", seconds: 2.2 },
  { kind: "fly", from: "city", at: "commerce", seconds: 1.5 },
  { kind: "hold", at: "commerce", seconds: 1.8 },
  { kind: "fly", from: "commerce", at: "forge", seconds: 1.5 },
  { kind: "hold", at: "forge", seconds: 1.8 },
  { kind: "fly", from: "forge", at: "creator", seconds: 1.5 },
  { kind: "hold", at: "creator", seconds: 1.8 },
  { kind: "fly", from: "creator", at: "city", seconds: 1.5 },
  { kind: "hold", at: "city", seconds: 0.8 },
];
const DURATION = TIMELINE.reduce((a, s) => a + s.seconds, 0);

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on("pageerror", (e) => console.log("PAGE ERROR:", String(e).slice(0, 300)));

await page.goto(`${DEV_URL}/?bare=1&capture=1`, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready === true, { timeout: 120000 });
await page.waitForTimeout(1200);

const canvas = page.locator("canvas");

// ------------------------------------------------------------------- stills
const STILL_T = 7.5;
const shots = [
  ["city", "city-default.png"],
  ["commerce", "district-commerce-core.png"],
  ["forge", "district-offer-forge.png"],
  ["creator", "district-creator-quarter.png"],
];
for (const [framing, name] of shots) {
  await page.evaluate(([f, t]) => window.__frame(f, t), [framing, STILL_T]);
  await page.waitForTimeout(200);
  await canvas.screenshot({ path: resolve(OUT, name) });
  console.log("still", name);
}

// --------------------------------------------------------------- silhouette
await page.evaluate(([t]) => window.__frame("city", t), [STILL_T]);
await page.evaluate(() => window.__silhouette(true));
await page.waitForTimeout(220);
await canvas.screenshot({ path: resolve(OUT, "silhouette-city.png") });
console.log("still silhouette-city.png");
await page.evaluate(() => window.__silhouette(false));

// ------------------------------------------------------------------- stats
const stats = await page.evaluate(() => {
  window.__frame("city", 7.5);
  return window.__info();
});
writeFileSync(resolve(OUT, "renderer-stats.json"), `${JSON.stringify(stats, null, 2)}\n`);
console.log("stats", JSON.stringify(stats));

// ---------------------------------------------------------------- recording
if (process.argv.includes("--stills")) {
  await browser.close();
  console.log("stills only; skipping the recording");
  process.exit(0);
}

for (const file of readdirSync(FRAMES)) rmSync(resolve(FRAMES, file));
mkdirSync(FRAMES, { recursive: true });

const total = Math.round(DURATION * FPS);
console.log(`recording ${DURATION.toFixed(1)}s -> ${total} frames`);

let frame = 0;
let elapsed = 0;
for (const step of TIMELINE) {
  const steps = Math.round(step.seconds * FPS);
  for (let i = 0; i < steps; i++) {
    const t = elapsed + i / FPS;
    if (step.kind === "hold") {
      await page.evaluate(([f, tt]) => window.__frame(f, tt), [step.at, t]);
    } else {
      const progress = (i + 1) / steps;
      await page.evaluate(
        ([to, tt, p, from]) => window.__flyTo(to, tt, p, from),
        [step.at, t, progress, step.from],
      );
    }
    await canvas.screenshot({ path: resolve(FRAMES, `f${String(frame).padStart(5, "0")}.png`) });
    frame++;
    if (frame % 60 === 0) console.log(`  ${frame}/${total}`);
  }
  elapsed += step.seconds;
}

await browser.close();

// --------------------------------------------------------------------- mux
const mp4 = resolve(OUT, "whop-city-flythrough.mp4");
execFileSync(
  "ffmpeg",
  [
    "-y",
    "-framerate", String(FPS),
    "-i", resolve(FRAMES, "f%05d.png"),
    "-c:v", "libx264",
    "-preset", "slow",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    mp4,
  ],
  { stdio: "inherit" },
);
console.log("wrote", mp4);
