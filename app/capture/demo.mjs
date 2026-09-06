/**
 * The recorded walkthrough.
 *
 * Drives a real browser window on the VM's display so a screen recording
 * captures the actual application rather than a sequence of stills. Split into
 * two phases around a file handshake, so the recorder can be started *after*
 * the setup — nobody needs to watch a city load.
 *
 *   node capture/demo.mjs
 *     writes  /tmp/demo-ready   when the city is up and staged
 *     waits for /tmp/demo-go    then plays the loop and exits
 *
 * There is no GPU on this machine, so everything below runs on SwiftShader and
 * the recording will show software-rendered frame rates. That is a property of
 * the recorder, not of the game.
 */
import { chromium } from "@playwright/test";
import { existsSync, writeFileSync, unlinkSync } from "node:fs";

const base = process.env.CITY_BASE ?? "http://localhost:4173";
const W = Number(process.env.CITY_W ?? 1280);
const H = Number(process.env.CITY_H ?? 800);
const READY = "/tmp/demo-ready";
const GO = "/tmp/demo-go";

for (const path of [READY, GO]) if (existsSync(path)) unlinkSync(path);

const browser = await chromium.launch({
  headless: false,
  args: [
    "--use-gl=swiftshader",
    "--enable-unsafe-swiftshader",
    `--window-size=${W},${H}`,
    "--window-position=0,0",
    "--hide-scrollbars",
    "--disable-infobars",
    "--start-maximized",
  ],
});

const context = await browser.newContext({ viewport: null });
const page = await context.newPage();

const ready = async (extra = 2500) => {
  await page.waitForFunction(() => Boolean(window.__city?.ready), null, { timeout: 240_000 });
  await page.waitForFunction(() => (window.__city?.info().parcels ?? 0) > 0, null, { timeout: 240_000 });
  await page.waitForTimeout(extra);
};

const beat = (ms) => page.waitForTimeout(ms);

// ------------------------------------------------------------------ phase A
// Load once so the browser has a saved city, then knock it a level behind the
// business. That is what coming back to a Whop that grew overnight looks like,
// and it is the state the loop starts from.
await page.goto(`${base}/?scenario=balanced&ss=1`, { waitUntil: "load" });
await page.emulateMedia({ reducedMotion: "reduce" });
await ready();

await page.evaluate(() => {
  const key = Object.keys(localStorage).find((entry) => entry.startsWith("whop-city.game.v1"));
  if (!key) return;
  const saved = JSON.parse(localStorage.getItem(key));
  for (const id of Object.keys(saved.state.claimed)) {
    if (saved.state.claimed[id] > 0) saved.state.claimed[id] -= 1;
  }
  localStorage.setItem(key, JSON.stringify(saved));
});

await page.reload({ waitUntil: "load" });
await ready(3500);

writeFileSync(READY, "ready");
console.log("staged; waiting for the recorder");
while (!existsSync(GO)) await beat(400);
await beat(1200);

// ------------------------------------------------------------------ phase B
// Fly around. Drag down and right: the ground has to stay under the cursor.
const size = page.viewportSize() ?? { width: W, height: H };
const cx = Math.round(size.width / 2);
const cy = Math.round(size.height / 2);

await page.mouse.move(cx, cy - 40);
await page.mouse.down();
await page.mouse.move(cx + 90, cy + 130, { steps: 26 });
await page.mouse.up();
await beat(1600);

await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx - 140, cy - 70, { steps: 22 });
await page.mouse.up();
await beat(1800);

// Zoom in on the wheel, then back out.
for (let i = 0; i < 4; i++) {
  await page.mouse.wheel(0, -120);
  await beat(260);
}
await beat(1600);
for (let i = 0; i < 4; i++) {
  await page.mouse.wheel(0, 120);
  await beat(260);
}
await beat(1400);

// Open a building that has outgrown itself, and build it.
const at = await page.evaluate(() => window.__city.plotGround("core-landmark"));
if (at) {
  await page.mouse.move(at.x, at.y, { steps: 12 });
  await beat(500);
  await page.mouse.click(at.x, at.y);
}
await beat(3200);

const button = page.locator('[data-action="upgrade"]');
if ((await button.count()) > 0 && (await button.isEnabled())) {
  await button.click({ force: true, timeout: 90_000 });
}
await beat(4200);

await page.locator('[data-action="close-card"]').click({ force: true }).catch(() => undefined);
await beat(1400);

// Back to the whole city, then into a district and its own quest.
await page.locator('[data-cam="reset"]').click({ force: true });
await beat(2600);

await page.locator('[data-district="creator-quarter"].rail__go').click({ force: true });
await beat(3600);

await page.locator('[data-district="offer-forge"].rail__go').click({ force: true });
await beat(3400);

// Whose city is this.
await page.locator('[data-action="profile"]').click({ force: true });
await beat(3200);

console.log("done");
await browser.close();
