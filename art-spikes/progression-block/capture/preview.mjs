import { chromium } from "@playwright/test";

const GL_ARGS = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
];

const state = process.argv[2] ?? "healthy";
const out = process.argv[3] ?? `/tmp/whop-spike/preview-${state}.png`;

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: GL_ARGS });
const page = await browser.newPage({ viewport: { width: 1500, height: 960 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.log("PAGE ERROR:", String(e).slice(0, 400)));
page.on("console", (m) => {
  if (m.type() === "error") console.log("CONSOLE ERROR:", m.text().slice(0, 400));
});

await page.goto(`http://127.0.0.1:5180/?bare=1&state=${state}`, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready === true, { timeout: 60000 });
await page.waitForTimeout(1500);
await page.evaluate((s) => window.__setState(s), state);
await page.waitForTimeout(1200);

console.log("info:", JSON.stringify(await page.evaluate(() => window.__info())));
await page.locator("canvas").screenshot({ path: out });
console.log("saved", out);

await browser.close();
