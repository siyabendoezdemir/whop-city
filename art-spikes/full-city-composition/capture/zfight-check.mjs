import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { DEV_URL, artOut, launchOptions } from "./env.mjs";

/** Supersampling factor, pinned so captures are reproducible. */
const SS = Number(process.env.SS ?? 2);

/**
 * Depth-fighting detector.
 *
 * Two surfaces at the same height fight over the same depth values, and which
 * one wins is decided per pixel by floating point. Nudge the camera by a
 * fraction of a pixel and the winner flips in large patches, which is what
 * reads as shimmer while the camera moves.
 *
 * So: render, nudge the focus by a quarter of a pixel, render again, and count
 * pixels that changed by more than a threshold. A quarter pixel cannot move any
 * real edge more than a hair, so a correctly layered scene changes almost
 * nothing. Anything that lights up is two surfaces trading places.
 *
 * Writes an amplified difference image so the affected surfaces are visible
 * rather than just counted.
 *
 *   node capture/zfight-check.mjs [label]
 */

const LABEL = process.argv[2] ?? "after";
const OUT = artOut();
const W = 1440;
const H = 900;
/** Sub-pixel, so nothing genuine should move. */
const NUDGE_PX = 0.25;
/** A flip between two similar greys is still a flip. */
const THRESHOLD = 6;

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on("pageerror", (e) => console.log("PAGE ERROR:", String(e).slice(0, 300)));

await page.goto(`${DEV_URL}/?bare=1&capture=1&ss=${SS}`, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready === true, { timeout: 120000 });
await page.waitForTimeout(1200);

const framings = await page.evaluate(() => window.__framingTable().map((f) => f.key));

console.log(`sub-pixel nudge of ${NUDGE_PX}px, counting pixels that shift by >${THRESHOLD} levels\n`);
console.log("framing        flipped px      % of frame");

const results = [];
for (const key of framings) {
  const out = await page.evaluate(
    ([framing, nudgePx, threshold, wantImage]) => {
      const canvas = document.querySelector("canvas");
      // The displayed size, not the backing store: with supersampling on, the
      // artefact we care about is what survives the downsample.
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const scratch = document.createElement("canvas");
      scratch.width = w;
      scratch.height = h;
      const sctx = scratch.getContext("2d", { willReadFrequently: true });
      const grab = () => {
        sctx.drawImage(canvas, 0, 0, w, h);
        return sctx.getImageData(0, 0, w, h).data;
      };

      const entry = window.__framingTable().find((e) => e.key === framing);
      const perUnit = h / entry.height;
      const d = nudgePx / perUnit;

      window.__frameAt(entry.focus, entry.height, 7.5);
      const a = grab();
      window.__frameAt(
        [entry.focus[0] + entry.right[0] * d, entry.focus[1], entry.focus[2] + entry.right[2] * d],
        entry.height,
        7.5,
      );
      const b = grab();

      let flipped = 0;
      const mask = wantImage ? sctx.createImageData(w, h) : null;
      for (let i = 0; i < w * h; i++) {
        const j = i * 4;
        const delta = Math.max(
          Math.abs(a[j] - b[j]),
          Math.abs(a[j + 1] - b[j + 1]),
          Math.abs(a[j + 2] - b[j + 2]),
        );
        const hit = delta > threshold;
        if (hit) flipped++;
        if (mask) {
          // Flips in red over a dimmed copy of the frame, so the affected
          // surfaces are identifiable rather than just a count.
          mask.data[j] = hit ? 255 : a[j] * 0.32;
          mask.data[j + 1] = hit ? 40 : a[j + 1] * 0.32;
          mask.data[j + 2] = hit ? 40 : a[j + 2] * 0.32;
          mask.data[j + 3] = 255;
        }
      }
      let image = null;
      if (mask) {
        sctx.putImageData(mask, 0, 0);
        image = scratch.toDataURL("image/png");
      }
      return { flipped, total: w * h, image };
    },
    [key, NUDGE_PX, THRESHOLD, key === "city"],
  );

  const pct = (100 * out.flipped) / out.total;
  results.push([key, pct]);
  console.log(`${key.padEnd(14)} ${String(out.flipped).padStart(9)} ${pct.toFixed(2).padStart(14)}%`);

  if (out.image) {
    const path = resolve(OUT, `zfight-${LABEL}.png`);
    mkdirSync(dirname(path), { recursive: true });
    const { writeFileSync } = await import("node:fs");
    writeFileSync(path, Buffer.from(out.image.split(",")[1], "base64"));
    console.log(`   -> wrote ${path}`);
  }
}

const worst = Math.max(...results.map(([, p]) => p));
console.log(
  `\nworst: ${worst.toFixed(2)}%  ->  ${worst < 0.5 ? "no depth fighting" : "SURFACES FIGHTING FOR DEPTH"}`,
);

await browser.close();
process.exit(worst < 0.5 ? 0 : 2);
