import { chromium } from "@playwright/test";
import { DEV_URL, launchOptions } from "./env.mjs";

/**
 * Leak check.
 *
 * Cycles the four states repeatedly and asserts the renderer's texture and
 * geometry counts return to where they started. Any growth means a state swap
 * is allocating something `disposeLot` does not free.
 */

const CYCLES = 3;
const STATES = ["dormant", "rising", "healthy", "struggling"];

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: 1500, height: 960 } });
page.on("pageerror", (e) => console.log("PAGE ERROR:", String(e).slice(0, 300)));

await page.goto(`${DEV_URL}/?bare=1`, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready === true, { timeout: 60000 });
await page.waitForTimeout(1200);

const read = () => page.evaluate(() => window.__info());

// Settle on a known state, then take the baseline.
await page.evaluate(() => window.__setState("dormant"));
await page.waitForTimeout(500);
const baseline = await read();
console.log("baseline           ", JSON.stringify({ textures: baseline.textures, geometries: baseline.geometries }));

for (let cycle = 1; cycle <= CYCLES; cycle++) {
  for (const state of STATES) {
    await page.evaluate((s) => window.__setState(s), state);
    await page.waitForTimeout(160);
  }
  await page.evaluate(() => window.__setState("dormant"));
  await page.waitForTimeout(400);
  const now = await read();
  console.log(
    `after cycle ${cycle}      `,
    JSON.stringify({ textures: now.textures, geometries: now.geometries }),
    now.textures === baseline.textures && now.geometries === baseline.geometries ? "OK" : "GREW",
  );
}

const final = await read();
const grewTextures = final.textures - baseline.textures;
const grewGeometries = final.geometries - baseline.geometries;
console.log(`\ntexture delta over ${CYCLES} cycles   : ${grewTextures}`);
console.log(`geometry delta over ${CYCLES} cycles  : ${grewGeometries}`);
console.log(`verdict                       : ${grewTextures === 0 && grewGeometries === 0 ? "NO LEAK" : "LEAK"}`);

await browser.close();
process.exit(grewTextures === 0 && grewGeometries === 0 ? 0 : 2);
