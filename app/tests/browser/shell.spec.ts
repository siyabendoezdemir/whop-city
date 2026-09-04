import { expect, test, type Page } from "@playwright/test";

/**
 * The shape of the product, as distinct from the loop inside it.
 *
 * `operator.spec.ts` covers the game. This covers the promises the interface
 * makes whatever the player is doing: that it is not a dashboard, that no
 * number in it came from the business, and that it cannot change anything.
 */

async function open(page: Page, scenario?: string) {
  const params = new URLSearchParams();
  if (scenario) params.set("scenario", scenario);
  await page.goto(`/?${params}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__city?.ready === true, null, { timeout: 120_000 });
  await page.waitForFunction(() => (window.__city?.info().parcels ?? 0) > 0, null, { timeout: 120_000 });
  const go = page.locator('[data-action="orient-done"]');
  if (await go.count()) await go.click();
}

test("selecting a district opens a reading attributed to Whop", async ({ page }) => {
  await open(page, "struggling");

  for (const [id, name] of [
    ["commerce-core", "Commerce Core"],
    ["offer-forge", "Offer Forge"],
    ["creator-quarter", "Creator Quarter"],
  ] as const) {
    await page.click(`.city-jump button[data-district="${id}"]`);
    const panel = page.locator(`.city-brief[data-district="${id}"]`);
    await expect(panel).toBeVisible();
    await expect(panel.locator(".panel__name")).toHaveText(name);

    const observed = (await panel.locator(".panel__observed").textContent()) ?? "";
    expect(observed).toMatch(/^Whop reports/);
    expect(observed).not.toMatch(/\d/);
    expect(observed.toLowerCase()).not.toMatch(/revenue|customer|\$|%|price/);
  }
});

test("no number in the shell comes from the business", async ({ page }) => {
  await open(page, "struggling");
  await page.click('.city-jump button[data-district="offer-forge"]');

  // Digits are allowed in exactly one place: counts of the operator's own
  // progress, which are marked local. Everything else is derived from the
  // projection, and the projection carries no numbers for it to show.
  const businessText = await page.evaluate(() => {
    const root = document.querySelector("main.city")!.cloneNode(true) as HTMLElement;
    for (const local of root.querySelectorAll("[data-local='true']")) local.remove();
    return root.innerText;
  });
  expect(businessText.replace(/[+−⌂]/g, "")).not.toMatch(/\d/);

  const localText = await page.locator("[data-local='true']").allInnerTexts();
  expect(localText.join(" ")).toMatch(/\d/);

  for (const selector of ["table", "svg.chart", ".metric", ".card", ".kpi", "nav.tabs"]) {
    await expect(page.locator(selector)).toHaveCount(0);
  }
  await expect(page.locator("main.city > header")).toHaveCount(0);
  await expect(page.locator("main.city > footer")).toHaveCount(0);
});

test("the interface says what it is and cannot change anything", async ({ page }) => {
  await open(page, "struggling");
  await page.click('.city-jump button[data-district="offer-forge"]');

  // Nothing submits, and nothing collects.
  await expect(page.locator("form")).toHaveCount(0);
  await expect(page.locator("input, textarea, select")).toHaveCount(0);

  await expect(page.locator("main.city")).toContainText("read-only");
  await expect(page.locator(".city-crest__mode")).toContainText("business that deployed it");
  // Every answer says whose it is, at the point of the click.
  await expect(page.locator(".prompt__note")).toContainText("does not send it anywhere");
});

test("what City cannot see is stated next to what it can", async ({ page }) => {
  await open(page, "struggling");
  await page.click('.city-jump button[data-district="commerce-core"]');

  const reading = page.locator(".panel__reading");
  await expect(reading.locator(".prov")).toHaveText("From Whop");
  await expect(reading.locator(".panel__limit")).toContainText("does not open your storefront");
  await expect(reading.locator(".panel__limit")).toContainText("try a purchase");
});

test("the city stands unbuilt when the business cannot be read", async ({ page }) => {
  await open(page, "unavailable");

  await expect(page.locator(".city-crest__state")).toHaveAttribute("data-freshness", "unavailable");
  await page.click('.city-jump button[data-district="commerce-core"]');
  await expect(page.locator(".city-brief")).toHaveAttribute("data-condition", "unread");
  await expect(page.locator(".panel__observed")).toContainText("could not read this district");
  await expect(page.locator(".prompt")).toHaveCount(0);
});
