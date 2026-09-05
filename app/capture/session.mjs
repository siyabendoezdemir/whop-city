import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

import { APP_URL, artifactPath, framesDir, launchOptions, shoot } from "./env.mjs";

/**
 * A complete session, played against the built app.
 *
 * Founds a city, builds into a constraint, gets out of it, unlocks a rank,
 * saves, resumes, and comes back to time having passed. Every frame is a real
 * capture of the running game; the film is those frames held at reading pace,
 * because this machine has no GPU and a live recording of a WebGL city would
 * show a slideshow with the wrong timing rather than the game's motion.
 */

const SS = Number(process.env.SS ?? 1);
const HOLD = 2.6;
const FPS = 12;
const beats = [];

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
// Every navigation rebuilds a WebGL city under software rasterisation, which
// is minutes rather than seconds on a machine with no GPU.
page.setDefaultTimeout(180_000);
page.setDefaultNavigationTimeout(300_000);
page.on("pageerror", (error) => console.log("PAGE ERROR:", String(error).slice(0, 200)));

async function open(scenario, { fresh = false } = {}) {
  await page.goto(`${APP_URL}/?capture=1&ss=${SS}&scenario=${scenario}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__city?.ready === true, null, { timeout: 180_000 });
  if (fresh) {
    await page.evaluate(() => {
      for (const key of Object.keys(localStorage)) if (key.startsWith("whop-city.sim")) localStorage.removeItem(key);
    });
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => window.__city?.ready === true, null, { timeout: 180_000 });
  }
  const away = page.locator('[data-action="away-done"]');
  if (await away.count()) await away.click({ force: true });
  const hint = page.locator('[data-action="dismiss-hint"]');
  if (await hint.count()) await hint.click({ force: true });
}

/**
 * Photograph a beat and record what the city actually said at that moment.
 *
 * The status line is read off the running HUD rather than written into the
 * script, because a caption that asserts a state the game did not reach is a
 * lie in the evidence. An earlier pass captioned a frame "out of headroom"
 * while the city was reading "running well".
 */
async function beat(name, note, { film = true } = {}) {
  await page.evaluate(() => window.__city.renderFrame(6));
  await page.waitForTimeout(120);
  await shoot(page, `${name}.png`);
  if (film) beats.push(`${name}.png`);
  const credits = await page.locator('[data-testid="credits"]').textContent().catch(() => "?");
  const said = await page.locator('[data-testid="city-status"]').textContent().catch(() => "");
  console.log(`  ${name.padEnd(22)} ${String(credits).padStart(5)}c  ${note}`);
  console.log(`  ${"".padEnd(22)}        city said: ${said}`);
}

const wide = async () => {
  const back = page.locator(".bar__back");
  if (await back.count()) await back.click({ force: true });
  await page.evaluate(() => window.__city.frame("city", 6));
};

/**
 * Select a plot by clicking the ground it stands on.
 *
 * This is the primary way a player picks a plot, so the session does it for
 * real at least once and asserts it worked.
 */
async function clickPlotInWorld(id) {
  await wide();
  const point = await page.evaluate((plotId) => window.__city.plotPoint(plotId), id);
  if (!point) throw new Error(`no plot ${id} on screen`);
  await page.mouse.click(point.x, point.y);
  await page.waitForSelector(`.moves[data-plot="${id}"]`, { timeout: 20_000 });
  console.log(`      (${id} selected by clicking the world)`);
}

/** Open a district and select one of its plots from the panel's plot row. */
async function selectPlot(district, chooser) {
  await page.click(`.stud[data-district="${district}"]`, { force: true });
  await page.waitForSelector(`.dossier[data-district="${district}"]`, { timeout: 20_000 });
  await page.waitForSelector(".plotchip", { timeout: 20_000 });
  const id = await page.locator(chooser).first().getAttribute("data-plot");
  if (!id) throw new Error(`no plot matching ${chooser} in ${district}`);
  await page.click(`.plotchip[data-plot="${id}"]`, { force: true });
  await page.waitForSelector(`.moves[data-plot="${id}"]`, { timeout: 20_000 });
  return id;
}

const bareIn = (district) => selectPlot(district, '.plotchip[data-level="0"]');
const builtIn = (district) => selectPlot(district, '.plotchip:not([data-level="0"])');

/** Bare ground anywhere, preferring the district asked for. */
async function anyBare(preferred, only = ["creator-quarter", "commerce-core", "offer-forge"]) {
  const order = [preferred, ...only].filter(
    (district, index, all) => all.indexOf(district) === index && only.includes(district),
  );
  for (const district of order) {
    await page.click(`.stud[data-district="${district}"]`, { force: true });
    await page.waitForSelector(`.dossier[data-district="${district}"]`, { timeout: 20_000 });
    await page.waitForSelector(".plotchip", { timeout: 20_000 });
    if ((await page.locator('.plotchip[data-level="0"]').count()) > 0) {
      return { district, id: await bareIn(district) };
    }
  }
  return null;
}

/** Build the first thing on offer here, whatever it is. */
async function buildAnything() {
  const offer = page.locator(".offer:not([disabled])").first();
  if ((await offer.count()) === 0) return false;
  await offer.click({ force: true });
  await page.waitForTimeout(220);
  return true;
}

const buildHere = async (trade) => {
  await page.click(`.offer[data-trade="${trade}"]`, { force: true });
  await page.waitForTimeout(200);
};

/** Let simulated time pass by rewinding the save's clock and reloading. */
async function passTime(seconds) {
  await page.evaluate((sec) => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("whop-city.sim.v1"));
    const save = JSON.parse(localStorage.getItem(key));
    save.state.lastTickAt -= sec * 1000;
    localStorage.setItem(key, JSON.stringify(save));
  }, seconds);
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.__city?.ready === true, null, { timeout: 180_000 });
  // Enough time passed to bring up the return card, which is modal and would
  // swallow every click after it.
  const card = page.locator('[data-action="away-done"]');
  if (await card.count()) await card.click({ force: true });
}

console.log(`playing a session at ${APP_URL} — the scenario is a FIXTURE`);

await open("blank", { fresh: true });
await wide();
await beat("game-1-founded", "a new city: bare plots, sixty credits, nothing running");

const firstPlot = await bareIn("creator-quarter");
await clickPlotInWorld(firstPlot);
await beat("game-2-first-build", "the first choice: who comes to the city, or what sells to them");

await buildHere("signal");
await wide();
await beat("game-3-signal", "a signal tower is up and lit — footfall, but nothing selling");

await bareIn("commerce-core");
await buildHere("market");
await wide();
await beat("game-4-earning", "paired with a market hall, the city starts taking money");

// Overbuild into the capacity ceiling: base headroom is six, and a signal
// tower plus a market hall already uses five of it.
for (let more = 0; more < 2; more++) {
  // Deliberately not the Offer Forge: its plots are wanted for the foundry
  // that relieves the ceiling this loop is about to hit.
  const spot = await anyBare("creator-quarter", ["creator-quarter", "commerce-core"]);
  if (!spot) break;
  if (!(await buildAnything())) break;
}
await passTime(20);
await wide();
await beat("game-5-pressure", "four buildings up, and the ceiling is close");

// Relief. Undoing the thing that broke it is always available, whatever the
// board looks like, and it is the move the world is pointing at: the plot
// standing amber is the newest one.
const dark = page.locator('.plotchip[data-dark="capacity"]').first();
if ((await dark.count()) > 0) {
  const darkId = await dark.getAttribute("data-plot");
  await dark.click({ force: true });
  await page.waitForSelector(`.moves[data-plot="${darkId}"]`);
  await page.click('[data-action="clear"]', { force: true });
  await page.waitForTimeout(300);
}
await passTime(20);
await wide();
await beat("game-6-cleared", "clearing a plot: some of the money back, and the headroom with it");

await passTime(600);
await wide();
await beat("game-7-grown", "ten minutes of trading later, a Township with money to spend");

// A Township raises the level cap, so an existing plot can go up a storey.
let raised = false;
for (const district of ["commerce-core", "creator-quarter", "offer-forge"]) {
  await page.click(`.stud[data-district="${district}"]`, { force: true });
  await page.waitForSelector(`.dossier[data-district="${district}"]`);
  const chip = page.locator('.plotchip:not([data-level="0"])').first();
  if ((await chip.count()) === 0) continue;
  await chip.click({ force: true });
  await page.waitForTimeout(300);
  const upgrade = page.locator('[data-action="upgrade"]:not([disabled])');
  if ((await upgrade.count()) > 0) {
    await upgrade.click({ force: true });
    await page.waitForTimeout(300);
    raised = true;
    break;
  }
}
await wide();
await beat(
  "game-8-upgraded",
  raised ? "the rank unlocked a second storey; a plot is raised" : "no plot could be raised yet",
);

// The return card, shown deliberately: dismissed inside passTime, so this one
// is raised again by rewinding the clock and reloading without dismissing it.
await page.evaluate(() => {
  const key = Object.keys(localStorage).find((k) => k.startsWith("whop-city.sim.v1"));
  const save = JSON.parse(localStorage.getItem(key));
  save.state.lastTickAt -= 1_800_000;
  localStorage.setItem(key, JSON.stringify(save));
});
await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => window.__city?.ready === true, null, { timeout: 180_000 });
await beat("game-9-return", "coming back: the city kept its own time while the tab was shut");
const awayCard = page.locator('[data-action="away-done"]');
if (await awayCard.count()) await awayCard.click({ force: true });
await wide();
await beat("game-10-city", "the city as the player left it, standing and lit");

// Phone
await page.setViewportSize({ width: 390, height: 780 });
await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => window.__city?.ready === true, null, { timeout: 180_000 });
const away2 = page.locator('[data-action="away-done"]');
if (await away2.count()) await away2.click({ force: true });
await page.evaluate(() => window.__city.frame("city", 6));
await beat("game-11-phone", "the same city on a phone", { film: false });
await page.click('.stud[data-district="commerce-core"]', { force: true });
await page.waitForTimeout(300);
await page.evaluate(() => window.__city.frame("commerce-core", 6));
await beat("game-12-phone-build", "building on a phone, the city still visible above", { film: false });

const info = await page.evaluate(() => window.__city.info());
console.log(`\n  renderer: ${info.drawCalls} draw calls / ${info.triangles.toLocaleString()} triangles`);

const FRAMES = framesDir();
for (const file of readdirSync(FRAMES)) rmSync(resolve(FRAMES, file), { recursive: true });
mkdirSync(FRAMES, { recursive: true });
let index = 0;
for (const name of beats) {
  for (let hold = 0; hold < Math.round(HOLD * FPS); hold++) {
    execFileSync("cp", [artifactPath(name), resolve(FRAMES, `f${String(index).padStart(5, "0")}.png`)]);
    index++;
  }
}
const out = artifactPath("city-session.mp4");
execFileSync("ffmpeg", ["-y", "-framerate", String(FPS), "-i", resolve(FRAMES, "f%05d.png"), "-an",
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20",
  "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", out], { stdio: ["ignore", "ignore", "inherit"] });

await browser.close();
console.log(`wrote ${out}: ${beats.length} beats, ${(index / FPS).toFixed(1)}s`);
