import { expect, test, type Page } from "@playwright/test";

/**
 * The promises the interface makes whatever the player is doing.
 *
 * `operator.spec.ts` covers the round. This covers the shape: that it is not a
 * dashboard, that no number in it came from the business, and that it cannot
 * change anything.
 */

async function open(page: Page, scenario?: string) {
  const params = new URLSearchParams();
  if (scenario) params.set("scenario", scenario);
  await page.goto(`/?${params}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__city?.ready === true, null, { timeout: 120_000 });
  await page.waitForFunction(() => (window.__city?.info().parcels ?? 0) > 0, null, { timeout: 120_000 });
}

async function enter(page: Page, districtId: string) {
  await page.locator(`.stud[data-district="${districtId}"]`).click({ force: true });
  await expect(page.locator(`.dossier[data-district="${districtId}"]`)).toBeVisible();
  // The advisory round is a disclosure inside the district panel now.
  const summary = page.locator(".fieldnotes__summary");
  if ((await summary.count()) > 0 && (await page.locator(".fieldnotes").getAttribute("open")) === null) {
    await summary.click({ force: true });
  }
}

test("every district reads as itself, in words attributed to Whop", async ({ page }) => {
  await open(page, "struggling");

  for (const [id, name] of [
    ["commerce-core", "Commerce Core"],
    ["offer-forge", "Offer Forge"],
    ["creator-quarter", "Creator Quarter"],
  ] as const) {
    await enter(page, id);
    await expect(page.locator(".dossier__name")).toHaveText(name);

    await page.locator(".why__summary").click({ force: true });
    const observed = (await page.locator(".why__observed").textContent()) ?? "";
    expect(observed).toMatch(/^Whop reports/);
    expect(observed).not.toMatch(/\d/);
    expect(observed.toLowerCase()).not.toMatch(/revenue|customer|\$|%|price/);
  }
});

test("no number in the interface comes from the business", async ({ page }) => {
  await open(page, "struggling");
  await enter(page, "offer-forge");

  // Digits are allowed in exactly one place: counts of the operator's own
  // progress, which are marked local. Everything else is derived from the
  // projection, and the projection carries no numbers for it to show.
  const businessText = await page.evaluate(() => {
    const root = document.querySelector("main.city")!.cloneNode(true) as HTMLElement;
    for (const local of root.querySelectorAll("[data-local='true']")) local.remove();
    return root.innerText;
  });
  expect(businessText.replace(/[+−⌂i]/g, "")).not.toMatch(/\d/);

  const localText = await page.locator("[data-local='true']").allInnerTexts();
  expect(localText.join(" ")).toMatch(/\d/);

  for (const selector of ["table", "svg.chart", ".metric", ".card", ".kpi", "nav"]) {
    await expect(page.locator(selector)).toHaveCount(0);
  }
  await expect(page.locator("main.city > header")).toHaveCount(0);
  await expect(page.locator("main.city > footer")).toHaveCount(0);
});

test("nothing here submits, and the one field that exists never leaves the browser", async ({ page }) => {
  await open(page, "struggling");
  await enter(page, "offer-forge");

  await expect(page.locator("form")).toHaveCount(0);
  // Exactly one field in the whole product: the operator's own line.
  await expect(page.locator("input, textarea, select")).toHaveCount(1);
  await expect(page.locator('[data-testid="note"]')).toBeVisible();

  // Typing in it must not reach the network by any route.
  const requests: string[] = [];
  page.on("request", (request) => requests.push(`${request.method()} ${request.url()}`));
  await page.locator('[data-testid="note"]').fill("a private reminder to myself");
  await page.locator('[data-testid="note"]').blur();
  await page.waitForTimeout(600);
  expect(requests.filter((entry) => !entry.includes(".js") && !entry.includes(".css"))).toEqual([]);

  // It is in this browser, and nowhere else.
  const stored = await page.evaluate(() => Object.values(localStorage).join(""));
  expect(stored).toContain("a private reminder to myself");

  // The read-only nature is discoverable without being repeated everywhere.
  await page.locator('[data-action="about"]').click({ force: true });
  await expect(page.locator(".about")).toContainText("public and read-only");
});

test("the storage boundary is stated where the notes are, once", async ({ page }) => {
  await open(page, "struggling");
  await enter(page, "commerce-core");
  await page.locator('[data-answer="problem"]').first().click({ force: true });

  await expect(page.locator(".notes__where")).toContainText("this browser");
  await expect(page.locator(".notes__where")).toContainText("Not sent to Whop");
  // Said once in the panel, not under every question.
  await expect(page.locator(".notes__where")).toHaveCount(1);
});

test("the city stands unbuilt when the business cannot be read", async ({ page }) => {
  await open(page, "unavailable");

  await expect(page.locator(".seal__state")).toHaveAttribute("data-freshness", "unavailable");
  await expect(page.locator(".seal__state")).toHaveText(/could not be read/i);
  await enter(page, "commerce-core");
  await expect(page.locator(".state .cond")).toHaveText(/No reading/);
  await expect(page.locator(".act[data-prompt]")).toHaveCount(0);
});

test("reduced motion removes the entrances rather than the interface", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, "struggling");
  await enter(page, "commerce-core");

  const duration = await page.evaluate(
    () => getComputedStyle(document.querySelector(".dossier")!).animationDuration,
  );
  expect(parseFloat(duration)).toBeLessThan(0.01);
  await expect(page.locator(".dossier")).toBeVisible();
  await expect(page.locator(".act")).toBeVisible();
});
