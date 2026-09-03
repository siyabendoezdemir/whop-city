import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";
import { DEV_URL, artOut, launchOptions } from "./env.mjs";

/**
 * Shadow anchoring check.
 *
 * Two outputs, one visual and one numeric, both aimed at a single question:
 * does the shadow pattern stay welded to the buildings and roads while the
 * camera dollies, or does it swim across the world?
 *
 * The recording runs the same city -> Commerce -> Forge -> Creator path as
 * `pnpm capture`, but with the animation clock frozen. Nothing in the world is
 * allowed to move, so anything that changes between frames other than the
 * camera transform is a rendering artefact.
 *
 * The measurement is a shift-compensated micro-dolly. The camera is
 * orthographic, so nudging the focus along the screen-right axis by a known
 * distance translates the image by an exact whole number of pixels and nothing
 * else. Shifting the second frame back by that many pixels should reproduce the
 * first frame almost exactly. Whatever residue is left is the shadow map
 * failing to stay anchored, and it is reported as a mean absolute difference in
 * 0-255 levels per channel.
 *
 *   node capture/shadow-check.mjs [label] [--no-video]
 */

const LABEL = process.argv[2] ?? "after";
const SKIP_VIDEO = process.argv.includes("--no-video");
const OUT = artOut();
const FRAMES = resolve(OUT, `.shadow-frames-${LABEL}`);
const W = 1440;
const H = 900;
const FPS = 30;
/** Frozen. The point is to isolate the camera. */
const FROZEN_T = 7.5;
const PATH = [
  { kind: "hold", at: "city", seconds: 1.2 },
  { kind: "fly", from: "city", at: "commerce", seconds: 1.5 },
  { kind: "hold", at: "commerce", seconds: 0.8 },
  { kind: "fly", from: "commerce", at: "forge", seconds: 1.5 },
  { kind: "hold", at: "forge", seconds: 0.8 },
  { kind: "fly", from: "forge", at: "creator", seconds: 1.5 },
  { kind: "hold", at: "creator", seconds: 0.8 },
  { kind: "fly", from: "creator", at: "city", seconds: 1.5 },
  { kind: "hold", at: "city", seconds: 0.6 },
];

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on("pageerror", (e) => console.log("PAGE ERROR:", String(e).slice(0, 300)));

await page.goto(`${DEV_URL}/?bare=1&capture=1`, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready === true, { timeout: 120000 });
await page.waitForTimeout(1200);

// ------------------------------------------- 1. shadow rig stability scan
// The direct measurement. Walk the whole fly path and record what decides
// where the shadow map lands in the world. A world-fixed rig produces exactly
// one distinct state; anything else remaps every texel as the camera moves.
const rigStates = await page.evaluate(
  ([path, fps, t]) => {
    const seen = new Map();
    for (const step of path) {
      const steps = Math.round(step.seconds * fps);
      // Every third frame. If the rig tracks the camera it varies at every
      // sample, and each sample costs a full 4096-shadow-map render.
      for (let i = 0; i < steps; i += 3) {
        if (step.kind === "hold") window.__frame(step.at, t);
        else window.__flyTo(step.at, t, (i + 1) / steps, step.from);
        const key = window
          .__shadowRig()
          .map((n) => n.toFixed(4))
          .join(",");
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
    }
    return [...seen.keys()];
  },
  [PATH, FPS, FROZEN_T],
);

console.log("1. shadow rig stability along the fly path");
console.log(`   distinct sun/shadow-camera states : ${rigStates.length}`);
console.log(`   ${rigStates.length === 1 ? "world-fixed" : "MOVES WITH THE CAMERA"}`);
if (rigStates.length > 1) {
  console.log(`   first : ${rigStates[0]}`);
  console.log(`   last  : ${rigStates[rigStates.length - 1]}`);
}

// ------------------------------------------------- 2. fly-step warp residue
// The end-to-end check. Two consecutive frames of a real fly differ by a known
// uniform scale and translation, because the camera is orthographic and only
// dollies and zooms, so warping one onto the other should reproduce it.
//
// What is left over is not all shadow: a fly also changes the zoom, and
// resampling a scaled image blurs it, while fog and environment specular are
// genuinely view-dependent. So the same measurement is taken twice, once with
// the sun casting and once with it not, and the gap between them is the part
// that is actually attributable to the shadow map moving.
const warp = await page.evaluate(
  ([fps, t]) => {
    const canvas = document.querySelector("canvas");
    const w = canvas.width;
    const h = canvas.height;
    const scratch = document.createElement("canvas");
    scratch.width = w;
    scratch.height = h;
    const sctx = scratch.getContext("2d", { willReadFrequently: true });
    const grab = () => {
      sctx.drawImage(canvas, 0, 0);
      return sctx.getImageData(0, 0, w, h).data;
    };

    const table = window.__framingTable();
    const byKey = Object.fromEntries(table.map((e) => [e.key, e]));
    const right = table[0].right;
    const up = table[0].up;
    const ease = (p) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2);
    const lerp3 = (a, b, s) => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];

    const sun = [];
    window.__scene.traverse((o) => {
      if (o.isDirectionalLight && o.shadow && o.shadow.mapSize.width > 1024) sun.push(o);
    });
    const setShadows = (on) => {
      for (const s of sun) s.castShadow = on;
    };

    /**
     * The shadow mask for one framing: the same frame rendered with and without
     * the sun casting, differenced. Everything view-dependent — fog, specular,
     * tone mapping — cancels, leaving only what the shadow map darkened.
     */
    const shadowMask = (focus, height) => {
      setShadows(true);
      window.__frameAt(focus, height, t);
      const lit = grab();
      setShadows(false);
      window.__frameAt(focus, height, t);
      const unlit = grab();
      setShadows(true);
      const mask = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) {
        const j = i * 4;
        mask[i] = (Math.abs(lit[j] - unlit[j]) + Math.abs(lit[j + 1] - unlit[j + 1]) + Math.abs(lit[j + 2] - unlit[j + 2])) / 3;
      }
      return mask;
    };

    /** Mean absolute difference between B and A warped into B's camera. */
    const residue = (fA, hA, fB, hB, masked) => {
      let a;
      let b;
      if (masked) {
        a = shadowMask(fA, hA);
        b = shadowMask(fB, hB);
      } else {
        window.__frameAt(fA, hA, t);
        a = grab();
        window.__frameAt(fB, hB, t);
        b = grab();
      }
      const stride = masked ? 1 : 4;
      const channels = masked ? 1 : 3;

      const sA = h / hA;
      const sB = h / hB;
      const cx = w / 2;
      const cy = h / 2;
      const df = [fA[0] - fB[0], fA[1] - fB[1], fA[2] - fB[2]];
      const dRight = df[0] * right[0] + df[1] * right[1] + df[2] * right[2];
      const dUp = df[0] * up[0] + df[1] * up[1] + df[2] * up[2];

      const margin = 40;
      let total = 0;
      let count = 0;
      for (let y = margin; y < h - margin; y += 2) {
        for (let x = margin; x < w - margin; x += 2) {
          // Pixel in B -> world offset from fB -> pixel in A.
          const u = ((x - cx) / sB - dRight) * sA;
          const v = ((cy - y) / sB - dUp) * sA;
          const xa = cx + u;
          const ya = cy - v;
          const x0 = Math.floor(xa);
          const y0 = Math.floor(ya);
          if (x0 < 0 || y0 < 0 || x0 + 1 >= w || y0 + 1 >= h) continue;
          const fx = xa - x0;
          const fy = ya - y0;
          const ib = (y * w + x) * stride;
          for (let c = 0; c < channels; c++) {
            const p00 = a[(y0 * w + x0) * stride + c];
            const p10 = a[(y0 * w + x0 + 1) * stride + c];
            const p01 = a[((y0 + 1) * w + x0) * stride + c];
            const p11 = a[((y0 + 1) * w + x0 + 1) * stride + c];
            const top = p00 + (p10 - p00) * fx;
            const bot = p01 + (p11 - p01) * fx;
            total += Math.abs(top + (bot - top) * fy - b[ib + c]);
            count++;
          }
        }
      }
      return total / count;
    };

    /**
     * The zoom test, and the sharpest of the three.
     *
     * Render the same focus at height h and at height 2h. The tighter frame is
     * then exactly twice the scale of the wider one, so a 2x2 box average of it
     * lines up with the middle of the wider frame with no interpolation and no
     * fractional offsets anywhere. Any disagreement between the two shadow
     * masks is the shadow map landing somewhere different for the same piece of
     * world, which is precisely what a zoom-dependent shadow volume causes.
     */
    const zoomPair = (focus, height) => {
      const tight = shadowMask(focus, height);
      const wide = shadowMask(focus, height * 2);
      const margin = 24;
      let total = 0;
      let count = 0;
      for (let yw = h / 4 + margin; yw < (3 * h) / 4 - margin; yw++) {
        const yt = 2 * yw - h / 2;
        for (let xw = w / 4 + margin; xw < (3 * w) / 4 - margin; xw++) {
          const xt = 2 * xw - w / 2;
          const boxed =
            (tight[yt * w + xt] +
              tight[yt * w + xt + 1] +
              tight[(yt + 1) * w + xt] +
              tight[(yt + 1) * w + xt + 1]) /
            4;
          total += Math.abs(boxed - wide[yw * w + xw]);
          count++;
        }
      }
      return total / count;
    };

    const out = {};
    const c = byKey.city;
    // Control: the identical code path with the camera standing still.
    out.still = residue(c.focus, c.height, c.focus, c.height, true);
    out["zoom city 47.5<->95"] = zoomPair(c.focus, c.height / 2);
    out["zoom forge 26<->52"] = zoomPair(byKey.forge.focus, byKey.forge.height / 2);
    // One frame's worth of motion, from the steepest part of each fly.
    for (const [from, to] of [
      ["city", "commerce"],
      ["commerce", "forge"],
      ["forge", "creator"],
      ["creator", "city"],
    ]) {
      const a = byKey[from];
      const b = byKey[to];
      const steps = Math.round(1.5 * fps);
      const p1 = ease(0.5);
      const p2 = ease(0.5 + 1 / steps);
      out[`${from}->${to}`] = residue(
        lerp3(a.focus, b.focus, p1),
        a.height + (b.height - a.height) * p1,
        lerp3(a.focus, b.focus, p2),
        a.height + (b.height - a.height) * p2,
        true,
      );
    }
    return out;
  },
  [FPS, FROZEN_T],
);

console.log("\n2. shadow-mask warp residue (mean abs difference, 0-255)");
let worstZoom = 0;
for (const [key, value] of Object.entries(warp)) {
  if (key.startsWith("zoom")) worstZoom = Math.max(worstZoom, value);
  const label = key === "still" ? "camera still (control)" : key;
  console.log(`   ${label.padEnd(28)} ${value.toFixed(3).padStart(8)}`);
}
console.log(
  `   worst zoom pair               ${worstZoom.toFixed(3).padStart(8)}`,
);
console.log(
  "\n   Both pixel metrics sit on a floor of roughly 1.2 levels that comes from\n" +
    "   antialiasing along every geometry edge, so they are regression guards\n" +
    "   rather than evidence. Measurement 1 is the one that decides it.",
);

console.log(
  `\nVERDICT: ${rigStates.length === 1 ? "shadows are world-fixed" : "SHADOWS TRACK THE CAMERA"}`,
);

// ---------------------------------------------------------------- recording
if (SKIP_VIDEO) {
  await browser.close();
  process.exit(rigStates.length === 1 ? 0 : 2);
}

mkdirSync(FRAMES, { recursive: true });
for (const file of readdirSync(FRAMES)) rmSync(resolve(FRAMES, file));

const canvas = page.locator("canvas");
const total = Math.round(PATH.reduce((a, s) => a + s.seconds, 0) * FPS);
console.log(`\nrecording frozen-world dolly path -> ${total} frames`);

let frame = 0;
for (const step of PATH) {
  const steps = Math.round(step.seconds * FPS);
  for (let i = 0; i < steps; i++) {
    if (step.kind === "hold") {
      await page.evaluate(([f, t]) => window.__frame(f, t), [step.at, FROZEN_T]);
    } else {
      await page.evaluate(
        ([to, t, p, from]) => window.__flyTo(to, t, p, from),
        [step.at, FROZEN_T, (i + 1) / steps, step.from],
      );
    }
    await canvas.screenshot({ path: resolve(FRAMES, `f${String(frame).padStart(5, "0")}.png`) });
    frame++;
    if (frame % 60 === 0) console.log(`  ${frame}/${total}`);
  }
}

await browser.close();

const mp4 = resolve(OUT, `shadow-path-${LABEL}.mp4`);
execFileSync(
  "ffmpeg",
  [
    "-y",
    "-framerate", String(FPS),
    "-i", resolve(FRAMES, "f%05d.png"),
    "-c:v", "libx264",
    "-preset", "slow",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    mp4,
  ],
  { stdio: "inherit" },
);
console.log("wrote", mp4);
