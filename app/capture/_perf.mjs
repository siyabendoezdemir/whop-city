import { chromium } from "@playwright/test";
import { launchOptions } from "./env.mjs";
const b = await chromium.launch(launchOptions());
for (const scenario of ["blank", "launch", "thriving"]) {
  const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://localhost:4173/?capture=1&ss=2&scenario=${scenario}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__city?.ready === true, null, { timeout: 180000 });
  await page.evaluate(() => window.__city.frame("city", 6));
  const base = await page.evaluate(() => window.__city.info());
  // Now force a fully built city: every plot at level 3.
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("whop-city.sim.v1"));
    if (!key) return;
    const save = JSON.parse(localStorage.getItem(key));
    const trades = { "commerce-core": "market", "offer-forge": "foundry", "creator-quarter": "signal" };
    save.state.plots = save.state.plots.map((p, i) => ({ ...p, level: 3, trade: trades[p.district], derelict: false, offline: null, built: i + 1 }));
    save.state.credits = 9999;
    localStorage.setItem(key, JSON.stringify(save));
  });
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.__city?.ready === true, null, { timeout: 180000 });
  await page.evaluate(() => window.__city.frame("city", 6));
  const full = await page.evaluate(() => window.__city.info());
  console.log(`${scenario.padEnd(9)} seeded ${String(base.drawCalls).padStart(3)}/${base.triangles.toLocaleString().padStart(8)}   full ${String(full.drawCalls).padStart(3)}/${full.triangles.toLocaleString().padStart(8)}`);
  await page.close();
}
await b.close();
