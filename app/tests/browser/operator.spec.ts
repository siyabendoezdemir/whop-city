import { expect, test, type Page } from "@playwright/test";

/**
 * The operator loop, end to end in a real browser against the built app.
 *
 *   signal → focus → review → progression
 *
 * These run against a fixtures build (`pnpm build:fixtures`), because the loop
 * needs districts in known states to be worth testing. Everything they exercise
 * is the same code a live deployment runs; only the source of the states
 * differs.
 */

async function open(page: Page, scenario?: string) {
  const params = new URLSearchParams();
  if (scenario) params.set("scenario", scenario);
  await page.goto(`/?${params}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__city?.ready === true, null, { timeout: 120_000 });
  await page.waitForFunction(() => (window.__city?.info().parcels ?? 0) > 0, null, {
    timeout: 120_000,
  });
}

/** Click a district's marker where it actually is on screen. */
async function clickMarker(page: Page, districtId: string) {
  const point = await page.evaluate((id) => window.__city!.markerPoint(id), districtId);
  expect(point, `no marker on screen for ${districtId}`).not.toBeNull();
  await page.mouse.click(point!.x, point!.y);
}

const queueOrder = (page: Page) =>
  page.locator(".city-queue__item").evaluateAll((items) =>
    items.map((item) => `${(item as HTMLElement).dataset.district}:${(item as HTMLElement).dataset.level}`),
  );

// ------------------------------------------------------------------ signal

test("the city ranks what needs attention", async ({ page }) => {
  await open(page, "struggling");

  // Two shuttered districts outrank the unbuilt one; nothing is healthy here.
  expect(await queueOrder(page)).toEqual([
    "commerce-core:urgent",
    "offer-forge:urgent",
    "creator-quarter:opportunity",
  ]);
  await expect(page.locator(".city-queue__title")).toHaveText("Asking for attention");
});

test("a healthy city says so instead of inventing work", async ({ page }) => {
  await open(page, "thriving");
  const order = await queueOrder(page);
  expect(order.every((entry) => entry.endsWith(":steady"))).toBe(true);
  await expect(page.locator(".city-queue__title")).toHaveText("Nothing is asking for attention");
});

test("every district carries a marker in the world", async ({ page }) => {
  await open(page, "struggling");
  for (const id of ["commerce-core", "offer-forge", "creator-quarter"]) {
    const point = await page.evaluate((district) => window.__city!.markerPoint(district), id);
    expect(point, `${id} has no marker`).not.toBeNull();
    // On screen, not behind the camera or off in the water.
    expect(point!.x).toBeGreaterThan(0);
    expect(point!.y).toBeGreaterThan(0);
  }
});

// ------------------------------------------------------------------- focus

test("clicking a marker in the world opens that district's briefing", async ({ page }) => {
  await open(page, "struggling");
  await expect(page.locator(".city-brief")).toHaveCount(0);

  await clickMarker(page, "offer-forge");

  const brief = page.locator(".city-brief");
  await expect(brief).toBeVisible();
  await expect(brief).toHaveAttribute("data-district", "offer-forge");
  await expect(brief.locator(".city-brief__name")).toHaveText("Offer Forge");
  // And the camera went there too.
  await expect(page.locator('.city-jump button[data-district="offer-forge"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("the briefing says what the city shows and what to do about it", async ({ page }) => {
  await open(page, "struggling");
  await clickMarker(page, "commerce-core");

  const brief = page.locator(".city-brief");
  await expect(brief.locator(".city-brief__reading")).not.toBeEmpty();
  await expect(brief.locator(".city-brief__stake")).not.toBeEmpty();
  expect(await brief.locator(".city-move__mark").count()).toBeGreaterThan(0);

  // Moves are instructions, not claims about data City has never seen.
  const detail = (await brief.locator(".city-move__detail").first().textContent()) ?? "";
  expect(detail.length).toBeGreaterThan(40);
  expect(detail).not.toMatch(/\d/);
});

test("the queue and the world select the same thing", async ({ page }) => {
  await open(page, "struggling");

  await page.click('.city-queue__item[data-district="creator-quarter"]');
  await expect(page.locator(".city-brief")).toHaveAttribute("data-district", "creator-quarter");

  await clickMarker(page, "offer-forge");
  await expect(page.locator(".city-brief")).toHaveAttribute("data-district", "offer-forge");
});

// ------------------------------------------------------- review and progress

test("marking moves advances the district and then resolves it", async ({ page }) => {
  await open(page, "struggling");
  await clickMarker(page, "creator-quarter");

  const progress = page.locator("[data-testid=district-progress]");
  const moves = page.locator(".city-move__mark");
  const total = await moves.count();
  expect(total).toBeGreaterThan(0);

  await expect(progress).toHaveText(`0 of ${total}`);
  await expect(
    page.locator('.city-progress__pip[data-district="creator-quarter"]'),
  ).toHaveAttribute("data-filled", "false");

  for (let i = 0; i < total; i++) {
    await moves.nth(i).click();
    await expect(progress).toHaveText(`${i + 1} of ${total}`);
    await expect(moves.nth(i)).toHaveAttribute("aria-pressed", "true");
  }

  // Resolved: the queue stops asking and the progression pip fills.
  await expect(
    page.locator('.city-queue__item[data-district="creator-quarter"]'),
  ).toHaveAttribute("data-resolved", "true");
  await expect(
    page.locator('.city-queue__item[data-district="creator-quarter"] .city-queue__status'),
  ).toHaveText("Reviewed");
  await expect(
    page.locator('.city-progress__pip[data-district="creator-quarter"]'),
  ).toHaveAttribute("data-filled", "true");
});

test("a review can be undone", async ({ page }) => {
  await open(page, "struggling");
  await clickMarker(page, "creator-quarter");

  const first = page.locator(".city-move__mark").first();
  await first.click();
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await first.click();
  await expect(first).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("[data-testid=district-progress]")).toContainText("0 of");
});

test("reviews survive a reload", async ({ page }) => {
  await open(page, "struggling");
  await clickMarker(page, "creator-quarter");
  await page.locator(".city-move__mark").first().click();
  await expect(page.locator(".city-move__mark").first()).toHaveAttribute("aria-pressed", "true");

  await open(page, "struggling");
  await clickMarker(page, "creator-quarter");
  await expect(page.locator(".city-move__mark").first()).toHaveAttribute("aria-pressed", "true");
});

test("the briefing says so when the district has moved on since it was reviewed", async ({
  page,
}) => {
  // Review Commerce Core while it is shuttered...
  await open(page, "struggling");
  await clickMarker(page, "commerce-core");
  await page.locator(".city-move__mark").first().click();
  await expect(page.locator(".city-brief__changed")).toHaveCount(0);

  // ...then come back to a city that reads differently.
  await open(page, "thriving");
  await clickMarker(page, "commerce-core");
  await expect(page.locator(".city-brief__changed")).toBeVisible();
  // And it does not claim the review caused it.
  await expect(page.locator(".city-brief__changed")).toContainText("cannot tell you why");
});

test("review state is described as local, at the point of the click", async ({ page }) => {
  await open(page, "struggling");
  await clickMarker(page, "commerce-core");
  const local = page.locator(".city-brief__local");
  await expect(local).toBeVisible();
  await expect(local).toContainText("Not sent to Whop");
});

// ---------------------------------------------------------------- keyboard

test("the loop is operable from the keyboard", async ({ page }) => {
  await open(page, "struggling");

  await page.keyboard.press("1");
  await expect(page.locator(".city-brief")).toHaveAttribute("data-district", "commerce-core");

  await page.keyboard.press("2");
  await expect(page.locator(".city-brief")).toHaveAttribute("data-district", "offer-forge");

  await page.keyboard.press("Escape");
  await expect(page.locator(".city-brief")).toHaveCount(0);

  // F goes to the most pressing district still asking.
  await page.keyboard.press("f");
  await expect(page.locator(".city-brief")).toHaveAttribute("data-district", "commerce-core");
});

test("selecting a district moves focus to its briefing", async ({ page }) => {
  await open(page, "struggling");
  await page.keyboard.press("1");
  await expect(page.locator(".city-brief")).toBeFocused();
});

test("every control is reachable and labelled", async ({ page }) => {
  await open(page, "struggling");

  for (const selector of [
    ".city-queue__item",
    ".city-jump button",
    ".city-camera button",
  ]) {
    const controls = page.locator(selector);
    const count = await controls.count();
    expect(count, `${selector} has no controls`).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const control = controls.nth(i);
      const label = ((await control.getAttribute("aria-label")) ?? (await control.innerText())).trim();
      expect(label, `${selector} #${i} has no accessible name`).not.toBe("");
    }
  }

  await expect(page.locator(".city-live")).toHaveAttribute("aria-live", "polite");
});

// -------------------------------------------------------------- no reading

test("an unreadable city offers no moves to make", async ({ page }) => {
  await open(page, "unavailable");

  await expect(page.locator(".city-queue__title")).toHaveText("The business could not be read");
  expect(await queueOrder(page)).toEqual([
    "commerce-core:unknown",
    "offer-forge:unknown",
    "creator-quarter:unknown",
  ]);

  await clickMarker(page, "commerce-core");
  await expect(page.locator(".city-brief")).toBeVisible();
  await expect(page.locator(".city-move__mark")).toHaveCount(0);
  await expect(page.locator(".city-brief__local")).toContainText("acting on nothing");

  // No progression to show when there is nothing to progress through.
  await expect(page.locator(".city-progress")).toHaveCount(0);
});

// --------------------------------------------------- when the world will not draw

test("the briefing still works without WebGL", async ({ page }) => {
  // Refuse every WebGL context before any app code runs. This is the old
  // machine, the locked-down browser, the blocked canvas.
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (typeof type === "string" && type.includes("webgl")) return null;
      // eslint-disable-next-line prefer-spread
      return original.apply(this, [type, ...rest] as never);
    } as typeof original;
  });

  await page.goto("/?scenario=struggling", { waitUntil: "load" });

  const fallback = page.locator("[data-testid=city-fallback]");
  await expect(fallback).toBeVisible({ timeout: 60_000 });
  await expect(fallback).toContainText("could not start WebGL");

  // The queue is still ranked, and the briefing still opens.
  expect(
    await page
      .locator(".city-flat__district")
      .evaluateAll((items) => items.map((item) => (item as HTMLElement).dataset.district)),
  ).toEqual(["commerce-core", "offer-forge", "creator-quarter"]);

  await page.click('.city-flat__head[data-district-open="offer-forge"]');
  const moves = page.locator('.city-flat__district[data-district="offer-forge"] .city-move__mark');
  expect(await moves.count()).toBeGreaterThan(0);

  // And a move can still be reviewed.
  await moves.first().click();
  await expect(moves.first()).toHaveAttribute("aria-pressed", "true");
});
