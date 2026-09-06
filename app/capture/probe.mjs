import { chromium } from "@playwright/test";
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => console.log("pageerror:", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("console:", m.text()); });
await page.goto("http://localhost:3000/?scenario=thriving&ss=1", { waitUntil: "domcontentloaded" });
const t0 = Date.now();
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(2000);
  const state = await page.evaluate(() => ({
    rising: Boolean(document.querySelector('[data-testid="rising"]')),
    tier: document.querySelector('[data-testid="tier"]')?.textContent?.slice(0, 40),
  }));
  console.log(`${Math.round((Date.now() - t0) / 1000)}s`, JSON.stringify(state));
  if (!state.rising && i > 2) break;
}
await browser.close();
