import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { DEV_URL, artOut, launchOptions } from "./env.mjs";

/** Supersampling factor, pinned so captures are reproducible. */
const SS = Number(process.env.SS ?? 2);

/**
 * Geometric aliasing detector.
 *
 * Detail thinner than a pixel cannot be drawn stably. As the camera creeps
 * along, a sub-pixel line lands on a slightly different part of the pixel grid
 * each frame and pops in and out — which is what road markings and paving
 * joints do at the default framing, and what reads as the roads shimmering.
 *
 * The camera is walked across exactly one pixel in eight sub-pixel steps with
 * the world frozen. For a crop over the road network it reports how much the
 * mean brightness swings, and how many pixels swing hard between neighbouring
 * steps. Stable geometry barely moves; a sub-pixel white line on dark asphalt
 * swings a lot.
 *
 * Also writes a 6x zoom of the same crop at two sub-pixel offsets, so the crawl
 * is visible rather than only counted.
 *
 *   node capture/aliasing-check.mjs [label]
 */

const LABEL = process.argv[2] ?? "after";
const OUT = artOut();
const W = 1440;
const H = 900;
const STEPS = 8;
/** A junction, its carriageway markings and its footways, at the default framing. */
const CROP = { x: 300, y: 640, w: 340, h: 120 };
const ZOOM = 4;

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on("pageerror", (e) => console.log("PAGE ERROR:", String(e).slice(0, 300)));

await page.goto(`${DEV_URL}/?bare=1&capture=1&ss=${SS}`, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready === true, { timeout: 120000 });
await page.waitForTimeout(1200);

const out = await page.evaluate(
  ([steps, crop, zoom]) => {
    const canvas = document.querySelector("canvas");
    // The displayed size, not the backing store: with supersampling on, the
    // artefact we care about is what survives the downsample.
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const scratch = document.createElement("canvas");
    scratch.width = w;
    scratch.height = h;
    const sctx = scratch.getContext("2d", { willReadFrequently: true });

    const entry = window.__framingTable().find((e) => e.key === "city");
    const perUnit = h / entry.height;

    const frames = [];
    for (let i = 0; i < steps; i++) {
      const d = i / steps / perUnit; // sub-pixel walk across exactly one pixel
      window.__frameAt(
        [entry.focus[0] + entry.right[0] * d, entry.focus[1], entry.focus[2] + entry.right[2] * d],
        entry.height,
        7.5,
      );
      sctx.drawImage(canvas, 0, 0, w, h);
      frames.push(sctx.getImageData(crop.x, crop.y, crop.w, crop.h).data);
    }

    const luma = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    const means = frames.map((f) => {
      let total = 0;
      for (let i = 0; i < crop.w * crop.h; i++) total += luma(f, i * 4);
      return total / (crop.w * crop.h);
    });

    // Hard swings between neighbouring sub-pixel steps, as a share of the crop.
    let worstStepFlips = 0;
    for (let s = 1; s < frames.length; s++) {
      let flips = 0;
      for (let i = 0; i < crop.w * crop.h; i++) {
        if (Math.abs(luma(frames[s], i * 4) - luma(frames[s - 1], i * 4)) > 18) flips++;
      }
      worstStepFlips = Math.max(worstStepFlips, flips);
    }

    // Top: the frame. Bottom: every pixel that swings hard across the walk,
    // marked in red, so the crawling features can be identified by eye.
    const flipMap = new Uint8ClampedArray(frames[0]);
    for (let i = 0; i < crop.w * crop.h; i++) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const f of frames) {
        const v = luma(f, i * 4);
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      const j = i * 4;
      if (hi - lo > 18) {
        flipMap[j] = 255;
        flipMap[j + 1] = 30;
        flipMap[j + 2] = 30;
      } else {
        flipMap[j] = frames[0][j] * 0.4;
        flipMap[j + 1] = frames[0][j + 1] * 0.4;
        flipMap[j + 2] = frames[0][j + 2] * 0.4;
      }
      flipMap[j + 3] = 255;
    }

    const zc = document.createElement("canvas");
    zc.width = crop.w * zoom;
    zc.height = crop.h * zoom * 2;
    const zctx = zc.getContext("2d");
    zctx.imageSmoothingEnabled = false;
    const paint = (data, oy) => {
      const tmp = document.createElement("canvas");
      tmp.width = crop.w;
      tmp.height = crop.h;
      tmp.getContext("2d").putImageData(new ImageData(data, crop.w, crop.h), 0, 0);
      zctx.drawImage(tmp, 0, oy, crop.w * zoom, crop.h * zoom);
    };
    paint(new Uint8ClampedArray(frames[0]), 0);
    paint(flipMap, crop.h * zoom);

    return {
      meanSwing: Math.max(...means) - Math.min(...means),
      worstStepFlips,
      cropPixels: crop.w * crop.h,
      image: zc.toDataURL("image/png"),
    };
  },
  [STEPS, CROP, ZOOM],
);

const pct = (100 * out.worstStepFlips) / out.cropPixels;
console.log(`walking the camera across one pixel in ${STEPS} steps, world frozen`);
console.log(`crop: ${CROP.w}x${CROP.h} over a junction and its footways\n`);
console.log(`mean brightness swing        ${out.meanSwing.toFixed(3)} levels`);
console.log(`worst single-step hard flips ${out.worstStepFlips} px  (${pct.toFixed(2)}% of crop)`);
console.log(`\n${pct < 0.6 ? "stable" : "CRAWLING"}`);

const path = resolve(OUT, `aliasing-${LABEL}.png`);
writeFileSync(path, Buffer.from(out.image.split(",")[1], "base64"));
console.log("wrote", path);

// ------------------------------------------------------------ crawl clip
// A very slow dolly over the same crop, magnified. Counting flips proves the
// change; watching a kerb line creep past at eight frames per pixel is what
// makes it legible.
if (process.argv.includes("--video")) {
  const { mkdirSync, readdirSync, rmSync } = await import("node:fs");
  const { execFileSync } = await import("node:child_process");
  const dir = resolve(OUT, `.crawl-${LABEL}`);
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) rmSync(resolve(dir, f));

  const FRAMES = 90;
  const PIXELS = 11; // across the whole clip, so roughly eight frames per pixel
  console.log(`\nrecording crawl clip: ${FRAMES} frames over ${PIXELS}px of dolly`);

  for (let i = 0; i < FRAMES; i++) {
    await page.evaluate(
      ([step, frames, pixels]) => {
        const canvas = document.querySelector("canvas");
        const entry = window.__framingTable().find((e) => e.key === "city");
        const perUnit = canvas.clientHeight / entry.height;
        const d = ((step / frames) * pixels) / perUnit;
        window.__frameAt(
          [entry.focus[0] + entry.right[0] * d, entry.focus[1], entry.focus[2] + entry.right[2] * d],
          entry.height,
          7.5,
        );
      },
      [i, FRAMES, PIXELS],
    );
    await page.locator("canvas").screenshot({
      path: resolve(dir, `f${String(i).padStart(4, "0")}.png`),
      clip: CROP,
    });
  }

  const clip = resolve(OUT, `crawl-${LABEL}.mp4`);
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-framerate", "24",
      "-i", resolve(dir, "f%04d.png"),
      "-vf", `scale=iw*${ZOOM}:ih*${ZOOM}:flags=neighbor`,
      "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p",
      clip,
    ],
    { stdio: "ignore" },
  );
  console.log("wrote", clip);
}

await browser.close();
