import { expect, test, type Page } from "@playwright/test";

/**
 * The game, played in a browser.
 *
 * These are the assertions that would have caught the things that were
 * actually wrong: a city that looked identical whatever the business had done,
 * bubbles that lagged the camera, and a vertical drag that pulled the world
 * the wrong way. So they compare built geometry and screen positions rather
 * than panel text, which a static city would pass.
 *
 * Every scenario here is a **fixture** — an invented business — and the suite
 * only runs against a fixtures build.
 */

const SETTLE = 1200;

/**
 * Opens the city.
 *
 * Reduced motion by default, which is the product's own way of skipping the
 * founding sweep — software rendering makes that sweep take the better part of
 * a minute, and only the one test that is about it should pay for it.
 */
async function open(page: Page, scenario: string, options: { motion?: boolean } = {}) {
  await page.emulateMedia({ reducedMotion: options.motion ? "no-preference" : "reduce" });
  const params = new URLSearchParams({ scenario, ss: "1" });
  await page.goto(`/?${params}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__city?.ready === true, null, { timeout: 120_000 });
  await page.waitForFunction(() => (window.__city?.info().parcels ?? 0) > 0, null, { timeout: 120_000 });
  await page.waitForTimeout(SETTLE);
}

/** Waits out the founding sweep, however slow software rendering makes it. */
async function founded(page: Page) {
  await page.waitForFunction(() => document.querySelector('[data-testid="rising"]') === null, null, {
    timeout: 150_000,
  });
  await page.waitForTimeout(SETTLE);
}

const triangles = (page: Page) => page.evaluate(() => window.__city!.info().triangles);

/** Knocks every claimed level back by one: a business that grew overnight. */
async function fallBehind(page: Page): Promise<number> {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((entry) => entry.startsWith("whop-city.game.v1"));
    if (!key) return 0;
    const saved = JSON.parse(localStorage.getItem(key)!);
    let knocked = 0;
    for (const id of Object.keys(saved.state.claimed)) {
      if (saved.state.claimed[id] > 0) {
        saved.state.claimed[id] -= 1;
        knocked += 1;
      }
    }
    localStorage.setItem(key, JSON.stringify(saved));
    return knocked;
  });
}

// ---------------------------------------------------------------------------
// The city is the business
// ---------------------------------------------------------------------------

test("a business with nothing sold gets empty ground, and one with a lot gets a skyline", async ({
  page,
}) => {
  await open(page, "blank");
  const nothing = await triangles(page);
  const nothingBuilt = await page.locator('[data-testid="rail-built-commerce-core"]').textContent();

  await open(page, "thriving");
  const everything = await triangles(page);
  const lotsBuilt = await page.locator('[data-testid="rail-built-commerce-core"]').textContent();

  expect(nothingBuilt).toBe("0/4");
  expect(lotsBuilt).toBe("4/4");
  // Not "the same city relabelled": a grown business is measurably more world.
  // An absolute difference rather than a ratio, because most of the triangles
  // in either frame are the terrain — roads, both bays, the far banks — which
  // is identical in both and would flatten any proportion.
  expect(everything - nothing, "the built city is barely more geometry").toBeGreaterThan(40_000);
});

test("the first visit plays the city being built, and only the first", async ({ page }) => {
  await page.context().clearCookies();
  await open(page, "balanced", { motion: true });

  // Mid-sweep the caption is up and the city is smaller than it will be.
  await expect(page.locator('[data-testid="rising"]')).toBeVisible();
  const during = await triangles(page);

  await founded(page);
  const after = await triangles(page);
  expect(after).toBeGreaterThan(during);

  // Coming back does not replay it: the city is already theirs.
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.__city?.ready === true, null, { timeout: 120_000 });
  await page.waitForTimeout(SETTLE);
  await expect(page.locator('[data-testid="rising"]')).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

test("a business that grew puts bubbles over the plots that outgrew themselves", async ({ page }) => {
  await open(page, "balanced");
  expect(await fallBehind(page)).toBeGreaterThan(0);

  await open(page, "balanced");
  // The rail counts what is waiting, district by district.
  const waiting = await page.locator('[data-testid^="rail-ready-"]').allTextContents();
  expect(waiting.length).toBe(3);
  expect(waiting.every((count) => Number(count) > 0)).toBe(true);
});

test("clicking a building opens it, and pressing the button puts a floor on it", async ({ page }) => {
  await open(page, "balanced");
  await fallBehind(page);
  await open(page, "balanced");

  // Click the plot's ground in the world, not a marker in the DOM: the pick
  // box is world geometry over the whole parcel.
  const at = await page.evaluate(() => window.__city!.plotGround("core-landmark"));
  expect(at).not.toBeNull();
  await page.mouse.click(at!.x, at!.y);

  const card = page.locator('[data-testid="building-card"]');
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-building", "core-landmark");
  const before = Number(await card.getAttribute("data-level"));

  // The roofline, before and after. Measured rather than counted: a taller
  // building can carry *fewer* triangles, because past six storeys the glazing
  // runs in bands instead of punched openings.
  const roof = () => page.evaluate(() => window.__city!.plotPoint("core-landmark")!.y);
  const beforeRoof = await roof();

  const button = page.locator('[data-action="upgrade"]');
  await expect(button).toBeEnabled();
  await button.click();

  await expect(card).toHaveAttribute("data-level", String(before + 1), { timeout: 60_000 });
  await page.waitForTimeout(SETTLE);
  expect(beforeRoof - (await roof()), "the building did not get taller").toBeGreaterThan(8);
});

test("nothing can be built that the business has not paid for", async ({ page }) => {
  // A settled city: every level the figures allow has already been taken.
  await open(page, "balanced");
  await founded(page).catch(() => undefined);

  const at = await page.evaluate(() => window.__city!.plotGround("core-landmark"));
  await page.mouse.click(at!.x, at!.y);

  await expect(page.locator('[data-testid="building-card"]')).toBeVisible();
  await expect(page.locator('[data-action="upgrade"]')).toBeDisabled();
});

// ---------------------------------------------------------------------------
// The camera
// ---------------------------------------------------------------------------

test("dragging moves the world with the hand, on both axes", async ({ page }) => {
  await open(page, "balanced");

  const where = () => page.evaluate(() => window.__city!.plotGround("creator-venue"));

  const start = await where();
  expect(start).not.toBeNull();

  // Grab the middle of the canvas and pull down and right. The ground under
  // the cursor must follow the cursor: this is the assertion that fails when
  // the vertical axis is inverted, which it was.
  await page.mouse.move(720, 420);
  await page.mouse.down();
  await page.mouse.move(720 + 60, 420 + 160, { steps: 16 });
  await page.mouse.up();
  await page.waitForTimeout(900);

  const moved = await where();
  expect(moved!.y - start!.y, "the world did not follow the hand downward").toBeGreaterThan(90);
  expect(moved!.x - start!.x, "the world did not follow the hand rightward").toBeGreaterThan(20);
});

test("hovering does not move the camera or select anything", async ({ page }) => {
  await open(page, "balanced");

  const before = await page.evaluate(() => window.__city!.plotGround("creator-venue"));
  for (const x of [300, 500, 700, 900, 1100]) {
    await page.mouse.move(x, 380);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(600);

  const after = await page.evaluate(() => window.__city!.plotGround("creator-venue"));
  expect(Math.abs(after!.x - before!.x)).toBeLessThan(2);
  expect(Math.abs(after!.y - before!.y)).toBeLessThan(2);
  await expect(page.locator('[data-testid="building-card"]')).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Whose city, and on what screen
// ---------------------------------------------------------------------------

test("the city says which Whop it is without being asked", async ({ page }) => {
  await open(page, "balanced");

  // Top left, in the loudest type on the screen. "I don't know which Whop it
  // selects" has to be a question the player cannot have.
  await expect(page.locator('[data-testid="crest-business"]')).toHaveText("Fixture Whop");
  await expect(page.locator('[data-testid="profile-business"]')).toHaveText("Fixture Whop");

  await page.locator('[data-action="profile"]').click();
  const menu = page.locator('[data-testid="profile-menu"]');
  await expect(menu).toBeVisible();
  await expect(menu).toContainText("One city per Whop");
  await expect(menu).toContainText("Second Whop");
  // The one this deployment cannot read says what to do about it rather than
  // offering a switch that would quietly show a city full of noughts.
  await expect(menu.locator(".is-locked")).toContainText("publish City there");
  await expect(menu.locator('[data-action="signout"]')).toBeVisible();
});

test("the resource bar names the Whop metric, not an invented currency", async ({ page }) => {
  await open(page, "balanced");

  // "0 Gold" and "0 Reserve" are unreadable: a player cannot tell whether that
  // is a fact about their business or a thing the game has not handed over.
  const bar = page.locator(".res");
  for (const label of ["Revenue", "Members", "Visitors", "MRR"]) {
    await expect(bar).toContainText(label);
  }
  for (const invented of ["Gold", "Citizens", "Footfall", "Reserve"]) {
    await expect(bar).not.toContainText(invented);
  }
});

test("the resting quest is four things, and the rest is behind a button", async ({ page }) => {
  await open(page, "balanced");

  const quest = page.locator('[data-testid="quest"]');
  await expect(quest).toBeVisible();

  // The bar carries two real figures rather than a percentage.
  await expect(quest.locator('[data-testid="quest-count"]')).toContainText("/");

  // At rest, no steps and no reasoning: those are what made it a wall of text.
  await expect(quest.locator(".quest__how")).toHaveCount(0);
  await expect(quest.locator(".quest__why")).toHaveCount(0);

  await quest.locator('[data-action="quest-how"]').click();
  await expect(quest.locator(".quest__how li")).toHaveCount(3);
  await expect(quest.locator(".quest__why")).toBeVisible();
});

test("a phone is told to come back on a desktop", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?scenario=balanced&ss=1", { waitUntil: "load" });

  await expect(page.locator(".gate__title")).toBeVisible();
  // And it does not quietly start a WebGL context behind the gate.
  await expect(page.locator("canvas")).toHaveCount(0);
});

test("every district has a quest of its own", async ({ page }) => {
  await open(page, "launch");

  const seen: string[] = [];
  for (const district of ["commerce-core", "offer-forge", "creator-quarter"]) {
    await page.locator(`[data-district="${district}"].rail__go`).click();
    await page.waitForTimeout(400);
    const quest = page.locator('[data-testid="quest"]');
    await expect(quest).toHaveAttribute("data-district", district);
    seen.push((await quest.getAttribute("data-quest")) ?? "");
  }

  // Three districts, three different things to do.
  expect(new Set(seen).size).toBe(3);
});
