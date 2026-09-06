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

  /**
   * What it costs to *submit* one frame.
   *
   * Not what it costs to see one: the draw calls return as soon as the driver
   * has them, and on software WebGL the work happens afterwards. The gap
   * between this number and `present` below is the whole story.
   */
  const submit = () => {
    const samples = [];
    for (let i = 0; i < 8; i++) {
      const at = performance.now();
      window.__city.renderFrame(i * 0.5);
      samples.push(performance.now() - at);
    }
    return Math.round(Math.min(...samples));
  };

  return {
    terrain: time("terrain", () => city.buildTerrain(seed)),
    lots: time("lots (all at level 5)", () => city.buildLots(seed, grown)),
    empty: time("lots (all vacant)", () => city.buildLots(seed, {})),
    submitMs: submit(),
    frame: window.__city.info(),
  };
});

/**
 * What it costs to get that frame *out* of the browser.
 *
 * Measured separately, and at both sizes the capture harness uses, because on
 * a machine with no GPU presenting a frame dwarfs drawing one by three orders
 * of magnitude — which is the whole reason the scripted captures photograph
 * frame by frame instead of screencasting.
 */
const present = {};
for (const [label, size] of [
  ["1440x900", { width: 1440, height: 900 }],
  ["960x600", { width: 960, height: 600 }],
]) {
  await page.setViewportSize(size);
  await page.waitForTimeout(1500);
  const samples = [];
  for (let i = 0; i < 3; i++) {
    const at = Date.now();
    await page.screenshot({ timeout: 240_000 });
    samples.push(Date.now() - at);
  }
  present[label] = `${(Math.min(...samples) / 1000).toFixed(1)}s`;
}

console.log(JSON.stringify({ ...result, present }, null, 2));
await browser.close();
