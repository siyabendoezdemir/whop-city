import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

import { APP_URL, artifactPath, framesDir, launchOptions, openCity } from "./env.mjs";

/**
 * The deterministic fly-through.
 *
 * Recorded frame by frame, which on this machine is the only honest option.
 * Rendering a frame of this city costs about six milliseconds under software
 * WebGL, but *presenting* one costs seven to fourteen seconds — the same cost
 * whether it is reached through Playwright's screenshot, through
 * canvas.toDataURL, or by simply letting the page's own animation loop run,
 * which manages 0.1 frames per second here. A live screencast of an animated
 * WebGL canvas is therefore not available on a machine without a GPU: the first
 * attempt at one produced a film with no camera motion and no ambient life in
 * it, because barely a dozen distinct frames ever reached the compositor.
 *
 * So each frame is composed and photographed deliberately. Every frame is a
 * pure function of its index — the animation clock and the camera
 * interpolation both — so the same film comes out of every run.
 *
 * Recorded at 960x600 rather than the authored 1440x900: same 16:10 aspect, so
 * the composition and every framing are unchanged, and supersampling still
 * applies on top. It is purely a cost decision. Presenting a frame is 7.7s
 * there against 13.2s at full size, which is the difference between a
 * half-hour recording and an hour.
 *
 * The districts are selected by clicking their buttons, not by calling the
 * camera hook, so the contextual panel opens as the camera arrives and the film
 * shows the product rather than a camera path with the interface removed.
 */

const SS = Number(process.env.SS ?? 2);
const FPS = Number(process.env.FPS ?? 20);
const VIEW = {
  width: Number(process.env.FLY_WIDTH ?? 960),
  height: Number(process.env.FLY_HEIGHT ?? 600),
};

const TIMELINE = [
  { kind: "hold", at: "city", seconds: 2.2 },
  { kind: "fly", from: "city", at: "commerce-core", seconds: 1.2, select: "commerce-core" },
  { kind: "hold", at: "commerce-core", seconds: 1.5 },
  { kind: "fly", from: "commerce-core", at: "offer-forge", seconds: 1.2, select: "offer-forge" },
  { kind: "hold", at: "offer-forge", seconds: 1.5 },
  { kind: "fly", from: "offer-forge", at: "creator-quarter", seconds: 1.2, select: "creator-quarter" },
  { kind: "hold", at: "creator-quarter", seconds: 1.5 },
  { kind: "fly", from: "creator-quarter", at: "city", seconds: 1.2, select: "city" },
  { kind: "hold", at: "city", seconds: 0.9 },
];
const DURATION = TIMELINE.reduce((total, step) => total + step.seconds, 0);

const FRAMES = framesDir();
for (const file of readdirSync(FRAMES)) rmSync(resolve(FRAMES, file), { recursive: true });
mkdirSync(FRAMES, { recursive: true });

const browser = await chromium.launch(launchOptions());
const page = await openCity(browser, { ss: SS, view: VIEW });
page.on("pageerror", (error) => console.log("PAGE ERROR:", String(error).slice(0, 200)));

const clip = await page.locator("canvas").boundingBox();
const total = Math.round(DURATION * FPS);
console.log(
  `recording ${DURATION.toFixed(1)}s of ${APP_URL} -> ${total} frames ` +
    `at ${VIEW.width}x${VIEW.height} ss=${SS} ${FPS}fps`,
);

let frame = 0;
let elapsed = 0;
const started = Date.now();

for (const step of TIMELINE) {
  if (step.select) {
    // The product interaction: opens the panel and marks the button pressed.
    await page.click(`.city-jump button[data-district="${step.select}"]`);
  }

  const steps = Math.round(step.seconds * FPS);
  for (let i = 0; i < steps; i++) {
    const t = elapsed + i / FPS;
    if (step.kind === "hold") {
      await page.evaluate(([at, clock]) => window.__city.frame(at, clock), [step.at, t]);
    } else {
      await page.evaluate(
        ([to, from, progress, clock]) => window.__city.flyTo(to, from, progress, clock),
        [step.at, step.from, (i + 1) / steps, t],
      );
    }
    await page.screenshot({
      path: resolve(FRAMES, `f${String(frame).padStart(5, "0")}.png`),
      clip,
      timeout: 180_000,
      animations: "disabled",
    });
    frame++;
    if (frame % 20 === 0) {
      const rate = (Date.now() - started) / frame;
      const left = Math.round(((total - frame) * rate) / 1000);
      console.log(`  ${frame}/${total}  ~${Math.floor(left / 60)}m${String(left % 60).padStart(2, "0")}s left`);
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
    "-an",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-crf", "18",
    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    out,
  ],
  { stdio: ["ignore", "ignore", "inherit"] },
);

console.log(`wrote ${out}: ${DURATION.toFixed(1)}s, ${total} frames at ${FPS}fps`);
