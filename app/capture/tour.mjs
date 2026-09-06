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

/**
 * The junction the middle shot sits on.
 *
 * Not the downtown crossroads, which is ringed by towers that stand between it
 * and this camera — from the fixed three-quarter angle you cannot see the road
 * at all. This one is where the cross street ends at the southern street, on
 * the open edge of the quarter: clear sightlines, and a T means every vehicle
 * arriving down the cross street has to turn.
 */
const JUNCTION = { focus: [4, 0, 30], height: 62 };
const BRIDGE = { focus: [37, 0, -84], height: 48 };

const LEGS = [
  { note: "the city in open country", from: { focus: [-2, 0, -30], height: 116 }, to: { focus: [12, 0, -14], height: 252 }, seconds: 4.5 },
  { note: "down to the junction", from: { focus: [12, 0, -14], height: 252 }, to: JUNCTION, seconds: 2.5 },
  { note: "traffic turning through it", from: JUNCTION, to: JUNCTION, seconds: 5.5 },
  { note: "across to the canal", from: JUNCTION, to: BRIDGE, seconds: 2.5 },
  { note: "over the bridge", from: BRIDGE, to: BRIDGE, seconds: 4.0 },
];

const DURATION = LEGS.reduce((total, leg) => total + leg.seconds, 0);
const ease = (k) => k * k * (3 - 2 * k);
const mix = (a, b, k) => a + (b - a) * k;

/** Where each held shot sits in the film, in seconds from the start. */
const SHOTS = (() => {
  let at = 0;
  const spans = LEGS.map((leg) => {
    const span = { from: at, to: at + leg.seconds };
    at += leg.seconds;
    return span;
  });
  return { junction: spans[2], bridge: spans[4] };
})();

const FRAMES = framesDir();
for (const file of readdirSync(FRAMES)) rmSync(resolve(FRAMES, file), { recursive: true });
mkdirSync(FRAMES, { recursive: true });

const browser = await chromium.launch(launchOptions());
const page = await openCity(browser, { scenario: "thriving", ss: SS, view: VIEW });
page.on("pageerror", (error) => console.log("PAGE ERROR:", String(error).slice(0, 200)));

/**
 * Where to start the world clock.
 *
 * The two held shots each need something to be happening in them: a vehicle
 * turning at the junction, and a vehicle up on the bridge deck. Both are
 * properties of the simulation at a given moment, not of the camera, so rather
 * than guessing an offset and hoping, this steps the world without drawing it
 * and searches for a start time where both shots land on one.
 *
 * One clock for the whole film, so the traffic is continuous across the cuts.
 */
const clockOffset = await page.evaluate(
  ([junction, bridge]) => {
    const STEP = 0.25;
    const HORIZON = 1200;

    // Sample the world once, then read the two questions off the samples.
    const frames = [];
    for (let t = 0; t <= HORIZON; t += STEP) {
      frames.push(
        window.__city.actors(t).filter((actor) => actor.name.startsWith("vehicle-")),
      );
    }

    const onBridge = frames.map((actors) =>
      actors.some(
        (actor) => actor.x > 30 && actor.x < 44 && Math.abs(actor.z + 84) < 7 && actor.y > 0.45,
      ),
    );

    /**
     * A vehicle changing direction inside the junction.
     *
     * Compared against its own heading a second earlier, so a lane change or
     * the natural wobble of a rounded corner does not count: a turn is a
     * quarter circle.
     */
    const back = Math.round(1 / STEP);
    const turning = frames.map((actors, index) => {
      if (index < back) return false;
      const before = frames[index - back];
      return actors.some((actor, seat) => {
        const was = before[seat];
        if (!was) return false;
        const near = Math.hypot(actor.x - junction[0], actor.z - junction[1]) < 22;
        if (!near) return false;
        const nowHeading = Math.atan2(actor.x - was.x, actor.z - was.z);
        const moved = Math.hypot(actor.x - was.x, actor.z - was.z);
        if (moved < 1) return false;
        // Heading a second ago, from the step before that.
        const earlier = frames[index - back * 2]?.[seat];
        if (!earlier) return false;
        const wasHeading = Math.atan2(was.x - earlier.x, was.z - earlier.z);
        const delta = Math.abs(((nowHeading - wasHeading + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        return delta > 1.0;
      });
    });

    const anyIn = (flags, from, to) => {
      for (let t = from; t <= to; t += STEP) {
        if (flags[Math.round(t / STEP)]) return true;
      }
      return false;
    };

    for (let offset = 0; offset < HORIZON - 60; offset += STEP) {
      if (!anyIn(onBridge, offset + bridge[0], offset + bridge[1])) continue;
      if (!anyIn(turning, offset + junction[2], offset + junction[3])) continue;
      return offset;
    }
    return null;
  },
  [
    [JUNCTION.focus[0], JUNCTION.focus[2], SHOTS.junction.from, SHOTS.junction.to],
    [SHOTS.bridge.from, SHOTS.bridge.to],
  ],
);

if (clockOffset === null) {
  throw new Error("could not find a moment with both a turn and a bridge crossing in it");
}
console.log(`world clock starts at t=${clockOffset.toFixed(2)}s`);

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
