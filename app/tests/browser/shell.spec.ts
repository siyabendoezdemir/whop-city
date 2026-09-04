import { expect, test } from "@playwright/test";

/**
 * The read-only product surface.
 *
 * Selecting a district must open an explanation of the place and nothing else:
 * no metric, no chart, no operator affordance, no write.
 */

const DISTRICTS = [
  ["commerce-core", "Commerce Core"],
  ["offer-forge", "Offer Forge"],
  ["creator-quarter", "Creator Quarter"],
] as const;

async function open(page: import("@playwright/test").Page, scenario?: string) {
  const params = new URLSearchParams();
  if (scenario) params.set("scenario", scenario);
  await page.goto(`/?${params}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__city?.ready === true, null, { timeout: 120_000 });
  await page.waitForFunction(() => (window.__city?.info().parcels ?? 0) > 0, null, { timeout: 120_000 });
}

test("nothing is selected until a district is chosen", async ({ page }) => {
  await open(page);
  await expect(page.locator(".city-place")).toHaveCount(0);
  await expect(page.locator(".city-jump button[data-district='city']")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("selecting a district opens an explanation of the place", async ({ page }) => {
  await open(page);

  for (const [id, name] of DISTRICTS) {
    await page.click(`.city-jump button[data-district="${id}"]`);
    const panel = page.locator(`.city-place[data-district="${id}"]`);
    await expect(panel).toBeVisible();
    await expect(panel.locator(".city-place__name")).toHaveText(name);

    const explanation = (await panel.locator(".city-place__explain").textContent()) ?? "";
    // A sentence about the place, naming its state.
    expect(explanation).toContain(name);
    expect(explanation.length).toBeGreaterThan(40);
    // And no measurement of any kind.
    expect(explanation).not.toMatch(/\d/);
    expect(explanation.toLowerCase()).not.toMatch(/revenue|member|customer|\$|%|price/);
  }
});

test("the explanation follows the projection's state", async ({ page }) => {
  await open(page, "struggling");
  await page.click('.city-jump button[data-district="commerce-core"]');

  const panel = page.locator(".city-place");
  await expect(panel).toHaveAttribute("data-state", "struggling");
  await expect(panel.locator(".city-place__explain")).toContainText("struggling");

  await open(page, "thriving");
  await page.click('.city-jump button[data-district="commerce-core"]');
  await expect(page.locator(".city-place")).toHaveAttribute("data-state", "healthy");
});

test("there is no dashboard, no chart, and no number anywhere in the shell", async ({ page }) => {
  await open(page);
  await page.click('.city-jump button[data-district="offer-forge"]');

  // Everything the shell renders as text.
  const text = (await page.locator("main.city").innerText()).replace(/[+−⌂]/g, "");
  expect(text).not.toMatch(/\d/);

  for (const selector of ["table", "svg.chart", ".metric", ".card", ".kpi", "header", "nav.tabs"]) {
    await expect(page.locator(selector)).toHaveCount(0);
  }
});

test("there is no write affordance and no operator mode", async ({ page }) => {
  await open(page);

  // Every control is a button that moves a camera. Nothing submits.
  await expect(page.locator("form")).toHaveCount(0);
  await expect(page.locator("input, textarea, select")).toHaveCount(0);

  const labels = await page.locator("main.city button").allInnerTexts();
  for (const label of labels) {
    expect(label.toLowerCase()).not.toMatch(/save|edit|claim|publish|deploy|connect|sign in|log in/);
  }

  await expect(page.locator("main.city")).toContainText("read-only");
});

test("the city renders honestly dark when the business cannot be read", async ({ page }) => {
  await open(page, "unavailable");

  await expect(page.locator(".city-crest__state")).toHaveAttribute("data-freshness", "unavailable");
  await page.click('.city-jump button[data-district="commerce-core"]');
  await expect(page.locator(".city-place")).toHaveAttribute("data-state", "dormant");
  await expect(page.locator(".city-place__explain")).toContainText("dormant");
});
