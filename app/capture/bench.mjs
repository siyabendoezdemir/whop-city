/**
 * How long a level change actually costs.
 *
 * Times the two halves of the world separately in the page, because the whole
 * point of splitting them is that only one is paid for on an upgrade. Reports
 * the renderer's own draw-call and triangle counts alongside, so a cheaper
 * rebuild cannot be bought with a more expensive frame.
 *
 *   node capture/bench.mjs
 */
import { chromium } from "@playwright/test";

const base = process.env.CITY_BASE ?? "http://localhost:3000";

const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto(`${base}/?scenario=thriving&ss=1`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => Boolean(window.__city?.ready), null, { timeout: 120_000 });
await page.waitForTimeout(8000);

const result = await page.evaluate(async () => {
  const city = await import("/src/render/city/city.ts");
  const seed = "0000000000000000";
  const grown = Object.fromEntries(
    [
      "core-landmark",
      "core-north",
      "core-east",
      "core-southeast",
      "forge-hero",
      "forge-north",
      "forge-south",
      "creator-park",
      "creator-terrace",
      "creator-venue",
      "creator-struggling",
    ].map((id) => [id, 5]),
  );

  const time = (label, run) => {
    // One warm pass so the measurement is not paying for module init.
    run().dispose?.();
    const samples = [];
    for (let i = 0; i < 3; i++) {
      const at = performance.now();
      const made = run();
      samples.push(performance.now() - at);
      made.dispose?.();
    }
    return { label, ms: Math.round(Math.min(...samples)) };
  };

  return {
    terrain: time("terrain", () => city.buildTerrain(seed)),
    lots: time("lots (all at level 5)", () => city.buildLots(seed, grown)),
    empty: time("lots (all vacant)", () => city.buildLots(seed, {})),
    frame: window.__city.info(),
  };
});

console.log(JSON.stringify(result, null, 2));
await browser.close();
