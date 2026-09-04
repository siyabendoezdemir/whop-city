import { execFileSync } from "node:child_process";
import { readdirSync, renameSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

import { APP_URL, artOut, artifactPath, framesDir, launchOptions, openCity } from "./env.mjs";

/**
 * The fly-through, recorded as a real visit.
 *
 * Not screenshotted frame by frame. Rendering a frame of this city costs about
 * six milliseconds even under software WebGL, but reading one back out of a
 * supersampled buffer costs eleven to twenty-four *seconds* — through
 * Playwright's screenshot and through canvas.toDataURL alike, because the
 * expense is the readback itself. Frame by frame, a 350-frame film is an
 * afternoon.
 *
 * So the page runs its own animation loop and the browser's compositor records
 * it, and the camera is driven the way a visitor drives it: by clicking the
 * district buttons. What comes out is the product being used — the world in
 * motion, the camera gliding between neighbourhoods, and the contextual panel
 * opening on arrival — rather than a camera path with the interface removed.
 *
 * The script is fixed, so two runs visit the same places for the same beats.
 */

const SS = Number(process.env.SS ?? 2);
const FPS = Number(process.env.FPS ?? 30);
const VIEW = {
  width: Number(process.env.FLY_WIDTH ?? 1280),
  height: Number(process.env.FLY_HEIGHT ?? 800),
};

/** Beats, in milliseconds. Sums to the intended length of the film. */
const SCRIPT = [
  { hold: 2600, label: "the city" },
  { click: "commerce-core", hold: 2600 },
  { click: "offer-forge", hold: 2600 },
  { click: "creator-quarter", hold: 2600 },
  { click: "city", hold: 1800 },
];
const DURATION_MS = SCRIPT.reduce((total, beat) => total + beat.hold, 0);

const RAW = framesDir();
for (const file of readdirSync(RAW)) rmSync(resolve(RAW, file), { recursive: true });

const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({
  viewport: VIEW,
  deviceScaleFactor: 1,
  recordVideo: { dir: RAW, size: VIEW },
});
// Recording starts when the page does, so the load has to be timed and trimmed
// off the front. The webm's own timestamps are not wall clock, so the cut is
// computed as a proportion of the session rather than in seconds.
const openedAt = Date.now();
// Not capture mode: the page has to run its own loop for there to be motion.
const page = await openCity(browser, { ss: SS, view: VIEW, context, capture: false });
const readyAt = Date.now();
console.log(`  city ready after ${((readyAt - openedAt) / 1000).toFixed(1)}s of load`);
page.on("pageerror", (error) => console.log("PAGE ERROR:", String(error).slice(0, 200)));

console.log(
  `recording ${(DURATION_MS / 1000).toFixed(1)}s of ${APP_URL} ` +
    `at ${VIEW.width}x${VIEW.height} ss=${SS}`,
);

for (const beat of SCRIPT) {
  if (beat.click) {
    await page.click(`.city-jump button[data-district="${beat.click}"]`);
    console.log(`  -> ${beat.click}`);
  }
  await page.waitForTimeout(beat.hold);
}

// Let the screencast flush the tail before the context closes.
await page.waitForTimeout(800);
const endedAt = Date.now();
await context.close();
await browser.close();

const recorded = readdirSync(RAW).filter((file) => file.endsWith(".webm"));
if (recorded.length === 0) throw new Error("no video was recorded");
const source = resolve(RAW, recorded[0]);

const probed = Number(
  execFileSync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    source,
  ]).toString().trim(),
);

const session = endedAt - openedAt;
const trimStart = probed * ((readyAt - openedAt) / session);
const kept = probed - trimStart;
// The page renders slower than real time under software WebGL, so what is left
// still runs long. Retime it to the scripted length.
const speed = kept / (DURATION_MS / 1000);
const out = artifactPath("city-flythrough.mp4");

execFileSync(
  "ffmpeg",
  [
    "-y",
    "-ss", trimStart.toFixed(3),
    "-i", source,
    "-filter:v", `setpts=PTS/${speed.toFixed(6)},scale=trunc(iw/2)*2:trunc(ih/2)*2`,
    "-r", String(FPS),
    "-an",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-crf", "20",
    out,
  ],
  { stdio: ["ignore", "ignore", "inherit"] },
);

renameSync(source, resolve(artOut(), "city-flythrough-raw.webm"));
console.log(
  `recorded ${probed.toFixed(1)}s, trimmed ${trimStart.toFixed(1)}s of load, ` +
    `retimed ${kept.toFixed(1)}s -> ${(DURATION_MS / 1000).toFixed(1)}s at ${out}`,
);
