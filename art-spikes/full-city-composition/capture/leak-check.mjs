import { chromium } from "@playwright/test";
import { DEV_URL, launchOptions } from "./env.mjs";

/**
 * Leak check.
 *
 * Repeatedly cycles the district framings and rebuilds the city, then asserts
 * the renderer's texture and geometry counts come back to where they started.
 * Any growth means something allocated per rebuild is not being freed.
 */

const CYCLES = 3;
const FRAMINGS = ["city", "commerce", "forge", "creator"];

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => console.log("PAGE ERROR:", String(e).slice(0, 300)));

await page.goto(`${DEV_URL}/?bare=1&capture=1`, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready === true, { timeout: 120000 });
await page.waitForTimeout(1200);

const read = () => page.evaluate(() => window.__info());

await page.evaluate(() => window.__frame("city", 5));
await page.waitForTimeout(300);
const baseline = await read();
console.log("baseline        ", JSON.stringify({ textures: baseline.textures, geometries: baseline.geometries }));

for (let cycle = 1; cycle <= CYCLES; cycle++) {
  for (const framing of FRAMINGS) {
    await page.evaluate((f) => window.__frame(f, 5), framing);
    await page.waitForTimeout(90);
  }
  // Silhouette swaps every material in the scene and back.
  await page.evaluate(() => window.__silhouette(true));
  await page.waitForTimeout(120);
  await page.evaluate(() => window.__silhouette(false));
  // A full rebuild of every lot, which is what a state change costs.
  await page.evaluate(() => window.__rebuild());
  await page.waitForTimeout(320);
  await page.evaluate(() => window.__frame("city", 5));
  await page.waitForTimeout(220);
  const now = await read();
  const ok = now.textures === baseline.textures && now.geometries === baseline.geometries;
  console.log(
    `after cycle ${cycle}   `,
    JSON.stringify({ textures: now.textures, geometries: now.geometries }),
    ok ? "OK" : "GREW",
  );
}

const final = await read();
const dTex = final.textures - baseline.textures;
const dGeo = final.geometries - baseline.geometries;
console.log(`\ntexture delta over ${CYCLES} cycles  : ${dTex}`);
console.log(`geometry delta over ${CYCLES} cycles : ${dGeo}`);
console.log(`verdict                      : ${dTex === 0 && dGeo === 0 ? "NO LEAK" : "LEAK"}`);

await browser.close();
process.exit(dTex === 0 && dGeo === 0 ? 0 : 2);
