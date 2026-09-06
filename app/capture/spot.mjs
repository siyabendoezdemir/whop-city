/**
 * Close looks at named world coordinates, for inspecting the map itself.
 *
 *   node capture/spot.mjs name:x,z,height [more...]
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const shots = process.argv.slice(2).map((arg) => {
  const [name, rest] = arg.split(":");
  const [x, z, h] = rest.split(",").map(Number);
  return { name, x, z, h };
});
const base = process.env.CITY_BASE ?? "http://localhost:4173";
const out = process.env.CITY_OUT ?? "/tmp/ui";
const scenario = process.env.CITY_SCENARIO ?? "thriving";

await mkdir(out, { recursive: true });

const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  reducedMotion: "reduce",
});

await page.goto(`${base}/?scenario=${scenario}&ss=1&capture=1`, { waitUntil: "load" });
await page.waitForFunction(() => Boolean(window.__city?.ready), null, { timeout: 180_000 });
await page.waitForFunction(() => (window.__city?.info().parcels ?? 0) > 0, null, { timeout: 180_000 });

for (const shot of shots) {
  await page.evaluate((s) => window.__city.frameAt([s.x, 0, s.z], s.h, 6), shot);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${out}/spot_${shot.name}.png`, timeout: 180_000 });
  console.log(`${out}/spot_${shot.name}.png`);
}

await browser.close();
