/**
 * A scripted play session against the running dev server.
 *
 * Seeds a saved city one level behind what the business earned — which is what
 * coming back to a Whop that grew overnight actually looks like — then walks
 * the loop: bubbles over the plots that outgrew themselves, click one, read the
 * card, press the button, watch the building go up.
 *
 * Writes a numbered still at each step and prints the time an upgrade takes,
 * because a rebuild the player can feel is a bug even when the picture is right.
 *
 *   node capture/play.mjs [scenario]
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const scenario = process.argv[2] ?? "balanced";
const base = process.env.CITY_BASE ?? "http://localhost:3000";
const out = process.env.CITY_OUT ?? "artifacts";
const settle = Number(process.env.CITY_SETTLE ?? 2600);

await mkdir(out, { recursive: true });

const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

const problems = [];
page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") problems.push(`console: ${message.text()}`);
});

const shot = async (name) => {
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 120_000 });
  console.log(`${out}/${name}.png`);
};

const ready = async () => {
  await page.waitForFunction(() => Boolean(window.__city?.ready), null, { timeout: 120_000 });
  await page.waitForTimeout(settle);
};

// ---------------------------------------------------------------- first visit
await page.goto(`${base}/?scenario=${scenario}&ss=1`, { waitUntil: "domcontentloaded" });
await ready();
await page.waitForTimeout(6500); // let the founding sweep finish
await shot("play-1-founded");

// --------------------------------------------- come back to a business that grew
// Knock every claimed level back by one and reload: the city is now behind the
// business, which is exactly the state a bubble exists to announce.
const behind = await page.evaluate(() => {
  const key = Object.keys(localStorage).find((entry) => entry.startsWith("whop-city.game.v1"));
  if (!key) return null;
  const saved = JSON.parse(localStorage.getItem(key));
  const claimed = saved.state.claimed;
  let knocked = 0;
  for (const id of Object.keys(claimed)) {
    if (claimed[id] > 0) {
      claimed[id] -= 1;
      knocked += 1;
    }
  }
  localStorage.setItem(key, JSON.stringify(saved));
  return { knocked, claimed };
});
console.log("knocked back:", JSON.stringify(behind));

await page.reload({ waitUntil: "domcontentloaded" });
await ready();
await shot("play-2-waiting");

// ------------------------------------------------------------- pick a building
// Click the plot's ground in the world. The pick boxes are world geometry, so
// this is a click on the canvas at the projected position of the plot rather
// than on a DOM element.
const clicked = await page.evaluate(() => {
  const hooks = window.__city;
  if (!hooks) return null;
  for (const id of ["core-landmark", "core-east", "creator-venue", "forge-hero"]) {
    const at = hooks.plotGround(id);
    if (at && at.x > 60 && at.x < 1380 && at.y > 60 && at.y < 840) return { id, ...at };
  }
  return null;
});
console.log("clicking:", JSON.stringify(clicked));
if (clicked) {
  await page.mouse.click(clicked.x, clicked.y);
  await page.waitForTimeout(1400);
  await shot("play-3-card");
}

// --------------------------------------------------------------- press upgrade
const button = page.locator('[data-action="upgrade"]');
if ((await button.count()) > 0 && (await button.isEnabled())) {
  const started = Date.now();
  await button.click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="toast"]') !== null,
    null,
    { timeout: 30_000 },
  ).catch(() => {});
  console.log(`upgrade round trip: ${Date.now() - started}ms`);
  await page.waitForTimeout(settle);
  await shot("play-4-upgraded");
} else {
  console.log("no upgrade available on the selected plot");
}

// ------------------------------------------------------------- camera handling
await page.mouse.move(720, 450);
await page.mouse.down();
await page.mouse.move(720, 620, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(1200);
await shot("play-5-panned");

if (problems.length > 0) console.error(problems.join("\n"));
await browser.close();
