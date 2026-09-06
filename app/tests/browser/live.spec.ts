import { expect, test, type Page } from "@playwright/test";

/**
 * The live layer, in a browser.
 *
 * A sale is a transient thing and the interesting question is what the whole
 * page does when one arrives, so these tests intercept the live endpoint and
 * hand the page a payment it has not seen. Everything downstream of that runs
 * for real: the dedupe, the feed merge, the figure that moves, and — the one
 * that matters — whether a building that the sale just paid for offers itself
 * to be built.
 *
 * Every scenario here is a **fixture** business, and this suite only runs
 * against a fixtures build.
 */

const READY = { timeout: 120_000 };

type Injection = { sales?: unknown[]; gold?: number; members?: number };

/**
 * Opens the city with the live endpoint under our control.
 *
 * Returns a setter: whatever it is given is folded into the next poll reply.
 * Nothing is stubbed above the network, so the page cannot tell the difference
 * between this and a real payment landing.
 */
async function open(page: Page, scenario = "thriving") {
  let injection: Injection = {};

  await page.route("**/api/city/live*", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (body.live) {
      if (injection.sales) body.sales = [...injection.sales, ...(body.sales ?? [])];
      if (injection.gold) body.metrics = { ...body.metrics, gold: injection.gold };
      if (injection.members) body.metrics = { ...body.metrics, citizens: injection.members };
    }
    await route.fulfill({ response, json: body });
  });

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/?scenario=${scenario}&ss=1`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__city?.ready === true, null, READY);
  await page.waitForFunction(() => (window.__city?.info().parcels ?? 0) > 0, null, READY);

  return (next: Injection) => {
    injection = next;
  };
}

function payment(over: Record<string, unknown> = {}) {
  return {
    key: `test-${Math.random().toString(36).slice(2)}`,
    cents: 12_900,
    at: Date.now(),
    kind: "first",
    product: "Annual pass",
    ...over,
  };
}

test("the roll shows what the business has been doing", async ({ page }) => {
  await open(page);
  await page.click('[data-testid="feed-toggle"]', { force: true });
  const rows = page.locator('[data-testid="feed-roll"] .feed__row');
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(3);
});

test("a quiet business gets a quiet feed rather than filler", async ({ page }) => {
  await open(page, "blank");
  await page.click('[data-testid="feed-toggle"]', { force: true });
  await expect(page.locator('[data-testid="feed-roll"]')).toContainText("Nothing has happened");
  expect(await page.locator('[data-testid="feed-roll"] .feed__row').count()).toBe(0);
});

test("history is not announced as though it just happened", async ({ page }) => {
  await open(page);
  // The fixture business has a day of sales behind it. None of them are new.
  await expect(page.locator('[data-testid="sale-pops"]')).toHaveCount(0);
});

test("a sale that lands throws a card and moves the figure", async ({ page }) => {
  const inject = await open(page);
  const before = await page.locator('[data-testid="res-gold"]').textContent();

  inject({ sales: [payment({ cents: 250_000 })], gold: 51_500 });

  await expect(page.locator('[data-testid="sale-pops"]')).toBeVisible({ timeout: 40_000 });
  await expect(page.locator('.pop__figure')).toContainText("$2.5k");
  await expect(page.locator('[data-testid="res-gold"]')).not.toHaveText(before ?? "", {
    timeout: 20_000,
  });
});

test("the same sale is never announced twice", async ({ page }) => {
  const inject = await open(page);
  const fixed = payment({ key: "stable-key" });
  inject({ sales: [fixed] });

  await expect(page.locator('[data-testid="sale-pops"]')).toBeVisible({ timeout: 40_000 });
  await page.click('[data-testid="feed-toggle"]', { force: true });
  const before = await page.locator('[data-testid="feed-roll"] .feed__row').count();

  // Two more polls carrying exactly the same payment.
  await page.waitForTimeout(34_000);
  const after = await page.locator('[data-testid="feed-roll"] .feed__row').count();
  expect(after).toBe(before);
});

test("a sale that pays for a level offers the building in the same beat", async ({ page }) => {
  // A business just short of the next rung on the downtown ladder, which is
  // revenue. Nothing is ready to build when the page opens.
  const inject = await open(page, "balanced");
  await expect(page.locator('[data-testid="ready-bar"]')).toHaveCount(0);

  // Revenue crosses $25,000, which is level four of The Treasury.
  inject({ sales: [payment({ cents: 2_500_000 })], gold: 26_400 });

  await expect(page.locator('[data-testid="ready-bar"]')).toBeVisible({ timeout: 40_000 });
});

test("a visitor sees no feed at all", async ({ page }) => {
  // The unavailable fixture withholds the figures, which is the state a public
  // visitor is in. Nothing about the business's takings may appear.
  await open(page, "unavailable");
  await expect(page.locator('[data-testid="feed-toggle"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="sale-pops"]')).toHaveCount(0);
});
