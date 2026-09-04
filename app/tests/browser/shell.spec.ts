import { expect, test, type Page } from "@playwright/test";

/**
 * The read-only product surface.
 *
 * Selecting a district must explain the place and offer moves the operator can
 * make themselves. It must not become a dashboard, must not show a measurement,
 * and must not offer to change anything in Whop.
 */

const DISTRICTS = [
  ["commerce-core", "Commerce Core"],
  ["offer-forge", "Offer Forge"],
  ["creator-quarter", "Creator Quarter"],
] as const;

async function open(page: Page, scenario?: string) {
  const params = new URLSearchParams();
  if (scenario) params.set("scenario", scenario);
  await page.goto(`/?${params}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__city?.ready === true, null, { timeout: 120_000 });
  await page.waitForFunction(() => (window.__city?.info().parcels ?? 0) > 0, null, {
    timeout: 120_000,
  });
}

test("nothing is selected until a district is chosen", async ({ page }) => {
  await open(page);
  await expect(page.locator(".city-brief")).toHaveCount(0);
  await expect(page.locator(".city-jump button[data-district='city']")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("selecting a district opens a briefing for the place", async ({ page }) => {
  await open(page);

  for (const [id, name] of DISTRICTS) {
    await page.click(`.city-jump button[data-district="${id}"]`);
    const brief = page.locator(`.city-brief[data-district="${id}"]`);
    await expect(brief).toBeVisible();
    await expect(brief.locator(".city-brief__name")).toHaveText(name);

    const reading = (await brief.locator(".city-brief__reading").textContent()) ?? "";
    expect(reading.length).toBeGreaterThan(30);
    // And no measurement of any kind.
    expect(reading).not.toMatch(/\d/);
    expect(reading.toLowerCase()).not.toMatch(/revenue|member|customer|\$|%|price/);
  }
});

test("the briefing follows the projection's state", async ({ page }) => {
  await open(page, "struggling");
  await page.click('.city-jump button[data-district="commerce-core"]');
  await expect(page.locator(".city-brief")).toHaveAttribute("data-state", "struggling");
  await expect(page.locator(".city-brief")).toHaveAttribute("data-level", "urgent");

  await open(page, "thriving");
  await page.click('.city-jump button[data-district="commerce-core"]');
  await expect(page.locator(".city-brief")).toHaveAttribute("data-state", "healthy");
  await expect(page.locator(".city-brief")).toHaveAttribute("data-level", "steady");
});

test("no number in the shell comes from the business", async ({ page }) => {
  await open(page);
  await page.click('.city-jump button[data-district="offer-forge"]');

  // Digits are allowed in exactly one place: the operator's own review count,
  // which is a fact about their clicking and is marked as local. Everything
  // else the shell renders is derived from the projection, and the projection
  // carries no numbers for it to show.
  const businessText = await page.evaluate(() => {
    const root = document.querySelector("main.city")!.cloneNode(true) as HTMLElement;
    for (const local of root.querySelectorAll("[data-local='true']")) local.remove();
    return root.innerText;
  });

  expect(businessText.replace(/[+−⌂]/g, "")).not.toMatch(/\d/);

  // And the local counter really is the only exception.
  const localText = await page.locator("[data-local='true']").allInnerTexts();
  expect(localText.join(" ")).toMatch(/\d/);

  // No dashboard furniture. The header/footer check is scoped to page level:
  // a <header> inside the briefing panel is the right element for a panel
  // title, and forbidding it outright would be forbidding correct semantics
  // rather than the SaaS chrome this is guarding against.
  for (const selector of ["table", "svg.chart", ".metric", ".card", ".kpi", "nav.tabs"]) {
    await expect(page.locator(selector)).toHaveCount(0);
  }
  await expect(page.locator("main.city > header")).toHaveCount(0);
  await expect(page.locator("main.city > footer")).toHaveCount(0);
});

test("there is no write affordance and no operator mode", async ({ page }) => {
  await open(page);
  await page.click('.city-jump button[data-district="offer-forge"]');

  // Every control moves a camera or ticks a local note. Nothing submits.
  await expect(page.locator("form")).toHaveCount(0);
  await expect(page.locator("input, textarea, select")).toHaveCount(0);

  const labels = await page.locator("main.city button").allInnerTexts();
  for (const label of labels) {
    expect(label.toLowerCase()).not.toMatch(/\bsave\b|\bclaim\b|\bdeploy\b|\bsign in\b|\blog in\b/);
  }

  await expect(page.locator("main.city")).toContainText("read-only");
});

test("the city stands unbuilt when the business cannot be read", async ({ page }) => {
  await open(page, "unavailable");

  await expect(page.locator(".city-crest__state")).toHaveAttribute("data-freshness", "unavailable");
  await page.click('.city-jump button[data-district="commerce-core"]');
  await expect(page.locator(".city-brief")).toHaveAttribute("data-state", "dormant");
  await expect(page.locator(".city-brief")).toHaveAttribute("data-level", "unknown");
  await expect(page.locator(".city-brief__reading")).toContainText("could not be read");
});
