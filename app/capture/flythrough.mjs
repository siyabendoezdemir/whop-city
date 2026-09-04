import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

import { APP_URL, artifactPath, framesDir, launchOptions, openCity } from "./env.mjs";

/**
 * The deterministic fly-through.
 *
 * Every frame is addressed by index, not by wall clock: the animation time and
 * the camera interpolation are both functions of the frame number, so the same
 * command produces the same film on any machine.
 *
 * Frames come from an element screenshot of the canvas rather than a page
 * screenshot. A page screenshot has to composite the shell's blurred panels
 * over a supersampled canvas, which costs ten to twenty seconds a frame under
 * software rendering and would make a 400-frame recording take hours. The shell
 * is photographed in the stills instead; this film is the world.
 */

const SS = Number(process.env.SS ?? 2);
const FPS = 30;

const TIMELINE = [
  { kind: "hold", at: "city", seconds: 2.2 },
  { kind: "fly", from: "city", at: "commerce-core", seconds: 1.5 },
  { kind: "hold", at: "commerce-core", seconds: 1.8 },
  { kind: "fly", from: "commerce-core", at: "offer-forge", seconds: 1.5 },
  { kind: "hold", at: "offer-forge", seconds: 1.8 },
  { kind: "fly", from: "offer-forge", at: "creator-quarter", seconds: 1.5 },
  { kind: "hold", at: "creator-quarter", seconds: 1.8 },
  { kind: "fly", from: "creator-quarter", at: "city", seconds: 1.5 },
  { kind: "hold", at: "city", seconds: 0.8 },
];
const DURATION = TIMELINE.reduce((total, step) => total + step.seconds, 0);

const FRAMES = framesDir();
for (const file of readdirSync(FRAMES)) rmSync(resolve(FRAMES, file));
mkdirSync(FRAMES, { recursive: true });

const browser = await chromium.launch(launchOptions());
const page = await openCity(browser, { ss: SS });
page.on("pageerror", (error) => console.log("PAGE ERROR:", String(error).slice(0, 200)));

const canvas = page.locator("canvas");
const total = Math.round(DURATION * FPS);
console.log(`recording ${DURATION.toFixed(1)}s of ${APP_URL} -> ${total} frames at ss=${SS}`);

let frame = 0;
let elapsed = 0;
const started = Date.now();

for (const step of TIMELINE) {
  const steps = Math.round(step.seconds * FPS);
  for (let i = 0; i < steps; i++) {
    const t = elapsed + i / FPS;
    if (step.kind === "hold") {
      await page.evaluate(([at, clock]) => window.__city.frame(at, clock), [step.at, t]);
    } else {
      const progress = (i + 1) / steps;
      await page.evaluate(
        ([to, from, p, clock]) => window.__city.flyTo(to, from, p, clock),
        [step.at, step.from, progress, t],
      );
    }
    await canvas.screenshot({ path: resolve(FRAMES, `f${String(frame).padStart(5, "0")}.png`) });
    frame++;
    if (frame % 60 === 0) {
      const rate = (Date.now() - started) / frame;
      console.log(`  ${frame}/${total}  (${((total - frame) * rate) / 1000 | 0}s left)`);
    }
  }
  elapsed += step.seconds;
}

await browser.close();

const out = artifactPath("city-flythrough.mp4");
execFileSync(
  "ffmpeg",
  [
    "-y",
    "-framerate", String(FPS),
    "-i", resolve(FRAMES, "f%05d.png"),
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-crf", "18",
    // Even dimensions, which libx264 requires and a supersampled canvas may not
    // already have.
    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    out,
  ],
  { stdio: "inherit" },
);

console.log(`wrote ${out} (${DURATION.toFixed(1)}s, ${total} frames)`);
