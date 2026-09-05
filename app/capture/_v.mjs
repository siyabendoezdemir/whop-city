import { chromium } from "@playwright/test";
import { launchOptions, shoot } from "./env.mjs";
const b = await chromium.launch(launchOptions());
for (const [w, h, tag] of [[1920, 1080, "wide"], [1440, 900, "std"], [1180, 760, "small"]]) {
  const page = await b.newPage({ viewport: { width: w, height: h } });
  page.setDefaultTimeout(180000);
  page.on("pageerror", (e) => console.log("ERR:", String(e).slice(0, 200)));
  await page.goto("http://localhost:4173/?capture=1&ss=1&scenario=thriving", { waitUntil: "load" });
  await page.waitForFunction(() => window.__city?.ready === true, null, { timeout: 180000 });
  await page.waitForTimeout(1000);
  const overflow = await page.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll("main.city > *")) {
      const r = el.getBoundingClientRect();
      if (r.right > innerWidth + 1 || r.left < -1 || r.bottom > innerHeight + 1 || r.top < -1) {
        bad.push(`${el.className.toString().slice(0, 24)} ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    }
    return bad;
  });
  console.log(`${tag} ${w}x${h}  overflow: ${overflow.length ? overflow.join(" | ") : "none"}`);
  await shoot(page, `v-${tag}.png`);
  await page.close();
}
const m = await b.newPage({ viewport: { width: 390, height: 780 } });
await m.goto("http://localhost:4173/?scenario=thriving", { waitUntil: "load" });
await m.waitForTimeout(2500);
console.log("phone gate:", (await m.locator(".gate__title").innerText().catch(() => "MISSING")));
await b.close();
