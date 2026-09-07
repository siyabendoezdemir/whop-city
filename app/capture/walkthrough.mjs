/**
 * The artifact set.
 *
 * Drives the built app through the whole loop and writes one still per state:
 * a business with nothing sold, the same city grown, a plot waiting to be
 * built, the card, the building a storey taller, a district's own quest, the
 * profile menu, and the two states nobody signs in for.
 *
 * Every scenario is a fixture — an invented business — and the stills are
 * labelled as such wherever they are used.
 *
 *   node capture/walkthrough.mjs [outDir]
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const out = process.argv[2] ?? "/opt/cursor/artifacts";
const base = process.env.CITY_BASE ?? "http://localhost:4173";
const W = 1440;
const H = 900;
/** `CITY_STEPS=3,4` reruns part of the set without paying for the rest. */
const wanted = process.env.CITY_STEPS?.split(",").map(Number) ?? null;
const doing = (step) => wanted === null || wanted.includes(step);

await mkdir(out, { recursive: true });

const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });

const problems = [];

async function fresh({ motion = false } = {}) {
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    reducedMotion: motion ? "no-preference" : "reduce",
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });
  return { context, page };
}

async function ready(page, extra = 2200) {
  await page.waitForFunction(() => Boolean(window.__city?.ready), null, { timeout: 180_000 });
  await page.waitForFunction(() => (window.__city?.info().parcels ?? 0) > 0, null, { timeout: 180_000 });
  await page.waitForTimeout(extra);
}

const shot = async (page, name) => {
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 180_000 });
  console.log(`${out}/${name}.png`);
};

/** Knocks every claimed level back by one: a business that grew overnight. */
const fallBehind = (page) =>
  page.evaluate(() => {
    const key = Object.keys(localStorage).find((entry) => entry.startsWith("whop-city.game.v1"));
    if (!key) return 0;
    const saved = JSON.parse(localStorage.getItem(key));
    let knocked = 0;
    for (const id of Object.keys(saved.state.claimed)) {
      if (saved.state.claimed[id] > 0) {
        saved.state.claimed[id] -= 1;
        knocked += 1;
      }
    }
    // Pretend the last visit saw smaller figures too, so the return panel has
    // something true to say about the gap.
    if (saved.state.lastSeen) {
      saved.state.lastSeen = {
        ...saved.state.lastSeen,
        gold: Math.round(saved.state.lastSeen.gold * 0.62),
        citizens: Math.round(saved.state.lastSeen.citizens * 0.78),
        traffic: Math.round(saved.state.lastSeen.traffic * 1.24),
      };
    }
    localStorage.setItem(key, JSON.stringify(saved));
    return knocked;
  });

// ------------------------------------------------------- 1. nothing sold yet
if (doing(1)) {
  const { context, page } = await fresh();
  await page.goto(`${base}/?scenario=launch&ss=1`, { waitUntil: "load" });
  await ready(page);
  await shot(page, "city_1_empty_ground");
  await context.close();
}

// ---------------------------------------------------------- 2. a grown business
if (doing(2)) {
  const { context, page } = await fresh();
  await page.goto(`${base}/?scenario=thriving&ss=1`, { waitUntil: "load" });
  await ready(page);
  await shot(page, "city_2_grown_skyline");
  await context.close();
}

// ------------------------------------- 3-5. the loop: waiting, card, built
if (doing(3)) {
  const { context, page } = await fresh();
  await page.goto(`${base}/?scenario=balanced&ss=1`, { waitUntil: "load" });
  await ready(page);
  console.log("knocked back:", await fallBehind(page));

  await page.reload({ waitUntil: "load" });
  await ready(page);
  await shot(page, "city_3_waiting_to_build");

  const at = await page.evaluate(() => window.__city.plotGround("core-landmark"));
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(2200);
  await shot(page, "city_4_building_card");

  // Forced: the button carries a slow "press me" pulse and the page is busy
  // software-rendering a city, so Playwright's stability wait times out long
  // before the button is anything other than perfectly clickable.
  await page.locator('[data-action="upgrade"]').click({ force: true, timeout: 90_000 });
  await page.waitForTimeout(3600);
  await shot(page, "city_5_one_storey_taller");

  await context.close();
}

// ------------------------------------------------- 6. a district's own quest
if (doing(6)) {
  const { context, page } = await fresh();
  await page.goto(`${base}/?scenario=struggling&ss=1`, { waitUntil: "load" });
  await ready(page);
  await page.locator('[data-district="creator-quarter"].rail__go').click();
  await page.waitForTimeout(2400);
  await shot(page, "city_6_district_quest");
  await context.close();
}

// --------------------------------------------------------- 7. which Whop
if (doing(7)) {
  const { context, page } = await fresh();
  await page.goto(`${base}/?scenario=balanced&ss=1`, { waitUntil: "load" });
  await ready(page);
  await page.locator('[data-action="profile"]').click();
  await page.waitForTimeout(700);
  await shot(page, "city_7_which_whop");
  await context.close();
}

// ---------------------------------------------------------- 8. a phone
if (doing(8)) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`${base}/?scenario=balanced&ss=1`, { waitUntil: "load" });
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${out}/city_8_not_on_a_phone.png` });
  console.log(`${out}/city_8_not_on_a_phone.png`);
  await context.close();
}

if (problems.length > 0) console.error("PROBLEMS:\n" + problems.join("\n"));
await browser.close();
