import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

import { APP_URL, artifactPath, launchOptions, openCity } from "./env.mjs";

/**
 * Geometric aliasing detector.
 *
 * Detail thinner than a pixel cannot be drawn stably. As the camera creeps
 * along, a sub-pixel line lands on a slightly different part of the pixel grid
 * each frame and pops in and out — which is what road markings and paving
 * joints did at the default framing before the supersampling work, and what
 * read as the roads shimmering.
 *
 * The camera is walked across exactly one pixel in eight sub-pixel steps with
 * the world frozen. Over a crop of the road network it reports how far the mean
 * brightness swings, and how many pixels swing hard between neighbouring steps.
 * Stable geometry barely moves; a sub-pixel white line on dark asphalt swings a
 * lot.
 *
 *   node capture/aliasing-check.mjs
 */

const SS = Number(process.env.SS ?? 2);
const STEPS = 8;
/** A junction, its carriageway markings and its footways, at the default framing. */
const CROP = { x: 300, y: 640, w: 340, h: 120 };
/** Share of the crop allowed to swing hard between two sub-pixel steps. */
const THRESHOLD = 0.02;

const browser = await chromium.launch(launchOptions());
const page = await openCity(browser, { ss: SS });
page.on("pageerror", (error) => console.log("PAGE ERROR:", String(error).slice(0, 200)));

const result = await page.evaluate(
  ([steps, crop]) => {
    const canvas = document.querySelector("canvas");
    // The displayed size, not the backing store: with supersampling on, the
    // artefact that matters is what survives the downsample.
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const scratch = document.createElement("canvas");
    scratch.width = w;
    scratch.height = h;
    const ctx = scratch.getContext("2d", { willReadFrequently: true });

    const entry = window.__city.framingTable().find((e) => e.key === "city");
    const pixelsPerUnit = h / entry.height;

    const frames = [];
    for (let i = 0; i < steps; i++) {
      const d = i / steps / pixelsPerUnit; // one pixel, in sub-pixel steps
      window.__city.frameAt(
        [entry.focus[0] + entry.right[0] * d, entry.focus[1], entry.focus[2] + entry.right[2] * d],
        entry.height,
        7.5,
      );
      ctx.drawImage(canvas, 0, 0, w, h);
      frames.push(ctx.getImageData(crop.x, crop.y, crop.w, crop.h).data);
    }

    const luma = (data, i) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    const pixels = crop.w * crop.h;

    const means = frames.map((frame) => {
      let total = 0;
      for (let i = 0; i < pixels; i++) total += luma(frame, i * 4);
      return total / pixels;
    });

    let worstFlips = 0;
    for (let s = 1; s < frames.length; s++) {
      let flips = 0;
      for (let i = 0; i < pixels; i++) {
        if (Math.abs(luma(frames[s], i * 4) - luma(frames[s - 1], i * 4)) > 18) flips++;
      }
      worstFlips = Math.max(worstFlips, flips);
    }

    return {
      meanSwing: Math.max(...means) - Math.min(...means),
      worstStepFlipShare: worstFlips / pixels,
      pixels,
    };
  },
  [STEPS, CROP],
);

await browser.close();

const report = {
  url: APP_URL,
  supersample: SS,
  crop: CROP,
  steps: STEPS,
  ...result,
  threshold: THRESHOLD,
  pass: result.worstStepFlipShare <= THRESHOLD,
};
writeFileSync(artifactPath("aliasing-check.json"), `${JSON.stringify(report, null, 2)}\n`);

console.log(`aliasing check at ss=${SS} over ${result.pixels.toLocaleString()} px of road`);
console.log(`  mean brightness swing across the walk: ${result.meanSwing.toFixed(3)}`);
console.log(
  `  worst single-step hard flips: ${(result.worstStepFlipShare * 100).toFixed(2)}% ` +
    `(threshold ${(THRESHOLD * 100).toFixed(0)}%)`,
);
console.log(report.pass ? "  PASS" : "  FAIL");
if (!report.pass) process.exitCode = 1;
