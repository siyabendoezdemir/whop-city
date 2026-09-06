import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

import { artifactPath, framesDir, launchOptions, openCity } from "./env.mjs";

/**
 * The world, and the things moving around in it.
 *
 * A deliberate tour of what the map pass changed: the plain running out to the
 * fog with no edge on it, a junction with traffic turning through it, and the
 * canal bridge being driven over rather than through.
 *
 * Recorded frame by frame because this machine has no GPU. Rendering a frame
 * costs about a millisecond under software WebGL; *presenting* one costs
 * seconds, whichever way it is asked for, so letting the page's own animation
 * loop run and screencasting it produces a film with a dozen distinct frames in
 * it. Every frame here is composed and photographed on purpose, which is the
 * only honest way to show motion from here.
 *
 * The two hold shots are held still on purpose. A camera panning across moving
 * traffic makes every vehicle that leaves the frame look like it vanished, and
 * "does anything disappear" is the exact question this film exists to answer.
 *
 * The world clock is offset so that a vehicle is genuinely on the bridge during
 * the last shot. It is found by stepping the simulation and asking, not by
 * guessing at a number and hoping — see `bridgeMoment`.
 *
 *   node capture/tour.mjs
 */

const SS = Number(process.env.SS ?? 1);
const FPS = Number(process.env.FPS ?? 16);
const VIEW = { width: 960, height: 600 };

const JUNCTION = { focus: [4, 0, -18], height: 54 };
const BRIDGE = { focus: [37, 0, -84], height: 48 };

const LEGS = [
  { note: "the city in open country", from: { focus: [-2, 0, -30], height: 116 }, to: { focus: [12, 0, -14], height: 252 }, seconds: 4.5 },
  { note: "down to the crossroads", from: { focus: [12, 0, -14], height: 252 }, to: JUNCTION, seconds: 2.5 },
  { note: "traffic turning through it", from: JUNCTION, to: JUNCTION, seconds: 5.0 },
  { note: "along the quay to the canal", from: JUNCTION, to: BRIDGE, seconds: 2.5 },
  { note: "over the bridge", from: BRIDGE, to: BRIDGE, seconds: 4.0 },
];

const DURATION = LEGS.reduce((total, leg) => total + leg.seconds, 0);
/** World time at which the last shot begins. */
const BRIDGE_SHOT_AT = DURATION - LEGS[LEGS.length - 1].seconds;
const ease = (k) => k * k * (3 - 2 * k);
const mix = (a, b, k) => a + (b - a) * k;

const FRAMES = framesDir();
for (const file of readdirSync(FRAMES)) rmSync(resolve(FRAMES, file), { recursive: true });
mkdirSync(FRAMES, { recursive: true });

const browser = await chromium.launch(launchOptions());
const page = await openCity(browser, { scenario: "thriving", ss: SS, view: VIEW });
page.on("pageerror", (error) => console.log("PAGE ERROR:", String(error).slice(0, 200)));

/**
 * When a vehicle is actually up on the bridge deck.
 *
 * Steps the world without drawing it and watches the stretch of the quay road
 * that spans the canal. Returns the middle of the longest crossing found, so
 * the shot is centred on a vehicle in the act rather than catching the tail of
 * one.
 */
const bridgeMoment = await page.evaluate(() => {
  const onBridge = (t) =>
    window.__city
      .actors(t)
      .some(
        (actor) =>
          actor.name.startsWith("vehicle-") &&
          actor.x > 30 &&
          actor.x < 44 &&
          Math.abs(actor.z + 84) < 7 &&
          actor.y > 0.45,
      );

  let best = null;
  let run = null;
  for (let t = 0; t <= 900; t += 0.25) {
    if (onBridge(t)) {
      run ??= t;
    } else if (run !== null) {
      const length = t - run;
      if (!best || length > best.length) best = { at: run + length / 2, length };
      run = null;
    }
  }
  return best;
});

if (!bridgeMoment) throw new Error("no vehicle crosses the bridge — the routes are wrong");
console.log(`bridge crossing at t=${bridgeMoment.at.toFixed(2)}s, lasting ${bridgeMoment.length.toFixed(2)}s`);

// Line the crossing up with the middle of the last shot.
const clockOffset = bridgeMoment.at - (BRIDGE_SHOT_AT + LEGS[LEGS.length - 1].seconds / 2);

const clip = await page.locator("canvas").boundingBox();
const total = Math.round(DURATION * FPS);
console.log(`tour: ${DURATION.toFixed(1)}s -> ${total} frames at ${VIEW.width}x${VIEW.height} ss=${SS}`);

let frame = 0;
let elapsed = 0;
const started = Date.now();

for (const leg of LEGS) {
  const steps = Math.round(leg.seconds * FPS);
  for (let i = 0; i < steps; i++) {
    const k = ease((i + 1) / steps);
    const focus = [0, 1, 2].map((axis) => mix(leg.from.focus[axis], leg.to.focus[axis], k));
    const height = mix(leg.from.height, leg.to.height, k);
    const t = clockOffset + elapsed + i / FPS;

    await page.evaluate(([at, h, clock]) => window.__city.frameAt(at, h, clock), [focus, height, t]);
    await page.screenshot({
      path: resolve(FRAMES, `f${String(frame).padStart(5, "0")}.png`),
      clip,
      timeout: 240_000,
      animations: "disabled",
    });
    frame++;
    if (frame % 25 === 0) {
      const rate = (Date.now() - started) / frame;
      const left = Math.round(((total - frame) * rate) / 1000);
      console.log(`  ${frame}/${total}  ~${Math.floor(left / 60)}m${String(left % 60).padStart(2, "0")}s left`);
    }
  }
  elapsed += leg.seconds;
}

await browser.close();

const out = artifactPath(process.env.TOUR_NAME ?? "world_tour.mp4");
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
