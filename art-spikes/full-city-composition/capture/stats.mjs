import { chromium } from "@playwright/test";
import { DEV_URL, launchOptions } from "./env.mjs";

/** Supersampling factor, pinned so captures are reproducible. */
const SS = Number(process.env.SS ?? 1);

/**
 * Renderer accounting.
 *
 * Prints the real figures from THREE.WebGLRenderer.info at the default framing
 * plus a per-group draw-call breakdown, so the README quotes measurements
 * rather than estimates.
 */
const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${DEV_URL}/?bare=1&capture=1&ss=${SS}`, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready === true, { timeout: 90000 });
await page.waitForTimeout(800);
const out = await page.evaluate(() => {
  const scene = window.__scene;
  const rows = [];
  scene.traverse((o) => {
    if (o.parent === scene || (o.parent && o.parent.parent === scene && o.parent.name === "city")) {
      let n = 0;
      o.traverse((c) => { if (c.isMesh || c.isInstancedMesh) n++; });
      if (n) rows.push([o.name || o.type, n]);
    }
  });
  return rows;
});
const info = await page.evaluate(() => window.__info());
console.log("draw calls        ", info.drawCalls);
console.log("triangles         ", info.triangles);
console.log("geometries        ", info.geometries);
console.log("textures          ", info.textures);
console.log("parcels           ", info.parcels);
console.log("prop instances    ", info.propInstances);
console.log("\nmeshes by group:");
console.log(out.map(([n, c]) => `${String(c).padStart(5)}  ${n}`).join("\n"));
await browser.close();
