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

/**
 * A visible cursor.
 *
 * X11 screen capture does not record the pointer, and without it a recording
 * of a drag is unreadable — you cannot tell whether the world followed the
 * hand or ran away from it, which is the one thing a camera demo has to show.
 * Injected by the capture harness only; nothing in the product draws this.
 */
await context.addInitScript(() => {
  const dot = document.createElement("div");
  dot.style.cssText = [
    "position:fixed",
    "left:0",
    "top:0",
    "width:26px",
    "height:26px",
    "margin:-13px 0 0 -13px",
    "border-radius:50%",
    "border:2px solid rgba(255,255,255,0.95)",
    "background:rgba(255,194,71,0.42)",
    "box-shadow:0 0 0 2px rgba(0,0,0,0.45), 0 2px 10px rgba(0,0,0,0.5)",
    "pointer-events:none",
    "z-index:2147483647",
    "transition:transform 60ms ease, background 60ms ease",
  ].join(";");
  const attach = () => {
    document.body.appendChild(dot);
    addEventListener("pointermove", (event) => {
      dot.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
    });
    addEventListener("pointerdown", () => {
      dot.style.background = "rgba(116,221,143,0.75)";
      dot.style.transform += " scale(0.78)";
    });
    addEventListener("pointerup", () => {
      dot.style.background = "rgba(255,194,71,0.42)";
    });
  };
  if (document.body) attach();
  else addEventListener("DOMContentLoaded", attach);
});

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
const size = page.viewportSize() ?? { width: W, height: H };
const cx = Math.round(size.width / 2);
const cy = Math.round(size.height / 2);

// The loop first, while the plot is still where the default framing put it.
// Open a building that has outgrown itself, and build it.
const at = await page.evaluate(() => window.__city.plotGround("core-landmark"));
if (at) {
  await page.mouse.move(at.x, at.y, { steps: 20 });
  await beat(900);
  await page.mouse.click(at.x, at.y);
}
await beat(3600);

const button = page.locator('[data-action="upgrade"]');
if ((await button.count()) > 0) {
  const box = await button.boundingBox();
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
  await beat(800);
  await button.click({ force: true, timeout: 120_000 });
}
await beat(5000);

await page.locator('[data-action="close-card"]').click({ force: true }).catch(() => undefined);
await beat(1600);

// Then the camera. Drag down and right: the ground has to stay under the dot.
await page.mouse.move(cx, cy - 60, { steps: 14 });
await beat(700);
await page.mouse.down();
await page.mouse.move(cx + 110, cy + 150, { steps: 30 });
await page.mouse.up();
await beat(2000);

await page.mouse.down();
await page.mouse.move(cx - 150, cy - 90, { steps: 26 });
await page.mouse.up();
await beat(2000);

// Zoom in on the wheel, then back out.
for (let i = 0; i < 4; i++) {
  await page.mouse.wheel(0, -120);
  await beat(280);
}
await beat(1800);
for (let i = 0; i < 4; i++) {
  await page.mouse.wheel(0, 120);
  await beat(280);
}
await beat(1400);

// Back to the whole city, then into two districts and their own quests.
await page.locator('[data-cam="reset"]').click({ force: true });
await beat(2800);

await page.locator('[data-district="creator-quarter"].rail__go').click({ force: true });
await beat(3800);

await page.locator('[data-district="offer-forge"].rail__go').click({ force: true });
await beat(3600);

// Whose city is this.
await page.locator('[data-action="profile"]').click({ force: true });
await beat(4000);

console.log("done");
// Left open on the last frame: closing the browser inside the recording
// paints a black screen over the end of it.
