/**
 * The live feed, photographed while it is doing something.
 *
 * The interesting states are transient — a card that lasts seven seconds, a
 * figure that pulses for one — so this drives the page rather than waiting for
 * one to happen: it opens the roll, then injects a poll reply carrying a sale
 * the page has not seen, and shoots the result.
 *
 *   node capture/feed.mjs
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const base = process.env.CITY_BASE ?? "http://localhost:4173";
const out = process.env.CITY_OUT ?? "/tmp/ui";
const scenario = process.env.CITY_SCENARIO ?? "thriving";

await mkdir(out, { recursive: true });

const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.emulateMedia({ reducedMotion: "reduce" });

/**
 * A sale the page has never seen.
 *
 * Served by intercepting the live endpoint, not by faking the UI: everything
 * downstream — the dedupe, the feed merge, the resource bump, the level
 * threshold — runs exactly as it would against a real payment.
 */
let extra = 0;
let boost = 0;
await page.route("**/api/city/live*", async (route) => {
  const response = await route.fetch();
  const body = await response.json();
  if (body.live && extra > 0) {
    const now = Date.now();
    const injected = Array.from({ length: extra }, (_, i) => ({
      key: `injected-${i}-${now}`,
      cents: [12_900, 4_900, 34_900][i % 3],
      at: now - i * 4_000,
      kind: i % 3 === 1 ? "renewal" : "first",
      product: ["Annual pass", "Pro monthly", "Coaching call"][i % 3],
    }));
    body.sales = [...injected, ...(body.sales ?? [])];
    body.metrics = { ...body.metrics, gold: body.metrics.gold + boost, citizens: body.metrics.citizens + 2 };
  }
  await route.fulfill({ response, json: body });
});

await page.goto(`${base}/?scenario=${scenario}&ss=1&capture=1`, { waitUntil: "load" });
await page.waitForFunction(() => Boolean(window.__city?.ready), null, { timeout: 180_000 });
await page.waitForSelector('[data-testid="feed-toggle"]', { timeout: 60_000 });
await page.waitForTimeout(2500);

await page.click('[data-testid="feed-toggle"]', { force: true });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/feed_roll.png`, timeout: 180_000 });
console.log(`${out}/feed_roll.png`);

await page.click('[data-testid="feed-toggle"]', { force: true });
extra = 3;
boost = 526;
// The hook polls every fifteen seconds; wait one round for the injected sales.
await page.waitForSelector('[data-testid="sale-pops"]', { timeout: 60_000 });
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/feed_sale.png`, timeout: 180_000 });
console.log(`${out}/feed_sale.png`);

await browser.close();
