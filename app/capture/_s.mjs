import { chromium } from "@playwright/test";
import { launchOptions, shoot } from "./env.mjs";
const b = await chromium.launch(launchOptions());
for (const sc of ["launch", "struggling", "thriving"]) {
  const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(180000);
  await page.goto(`http://localhost:4173/?capture=1&ss=2&scenario=${sc}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__city?.ready === true, null, { timeout: 180000 });
  await page.waitForTimeout(900);
  const res = (await page.locator(".res").innerText()).replace(/\n/g, " ");
  console.log(`${sc.padEnd(11)} ${res}`);
  console.log(`${"".padEnd(11)} advisor: ${(await page.locator('[data-testid="mission"]').innerText().catch(() => "-"))} | ${(await page.locator('[data-testid="bottleneck"]').innerText().catch(() => "-")).slice(0, 60)}`);
  console.log(`${"".padEnd(11)} tier: ${(await page.locator('[data-testid="tier"]').innerText()).replace(/\n/g, " ")}  ready: ${await page.locator(".ready").count()}`);
  await shoot(page, `s-${sc}.png`);
  await page.close();
}
await b.close();
