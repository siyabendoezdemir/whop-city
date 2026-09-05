import { chromium } from "@playwright/test";
import { launchOptions, shoot } from "./env.mjs";
const b = await chromium.launch(launchOptions());
const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(180000);
page.on("pageerror", (e) => console.log("PAGEERROR:", String(e).slice(0, 200)));
await page.goto("https://city-spike.whop.site/?capture=1&ss=2", { waitUntil: "load", timeout: 300000 });
await page.waitForFunction(() => window.__city?.ready === true, null, { timeout: 240000 });
for (const a of ["away-done", "dismiss-hint"]) {
  const c = page.locator(`[data-action="${a}"]`); if (await c.count()) await c.click({ force: true });
}
await page.evaluate(() => window.__city.frame("city", 6));
await shoot(page, "live-1-city.png");
console.log("credits :", await page.locator('[data-testid="credits"]').textContent().catch(() => "MISSING"));
console.log("status  :", await page.locator('[data-testid="city-status"]').textContent().catch(() => "-"));
console.log("freshness:", await page.locator(".seal__state").textContent().catch(() => "-"));
console.log("renderer:", JSON.stringify(await page.evaluate(() => window.__city.info())));

// Play a move on the live site.
await page.click('[data-action="primary"]', { force: true });
await page.waitForSelector(".moves", { timeout: 60000 });
const offer = page.locator(".offer:not([disabled])").first();
const name = await offer.locator(".offer__name").textContent().catch(() => "?");
await offer.click({ force: true });
await page.waitForTimeout(600);
await page.evaluate(() => window.__city.renderFrame(6));
await shoot(page, "live-2-built.png");
console.log(`built   : ${name} -> credits now ${await page.locator('[data-testid="credits"]').textContent()}`);
console.log("panel   :", (await page.locator(".moves").innerText()).slice(0, 90).replace(/\n/g, " | "));
await b.close();
