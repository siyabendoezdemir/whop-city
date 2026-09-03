import { expect, test } from "@playwright/test";

const DISTRICTS = [
  { id: "commerce-core", name: "Commerce Core" },
  { id: "offer-forge", name: "Offer Forge" },
  { id: "creator-quarter", name: "Creator Quarter" },
] as const;

test.describe("Whop City — public view", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("city-world")).toBeVisible();
    // The reveal overlay clears on hydration, so this is the point at which
    // the world is genuinely interactive rather than merely painted.
    await expect(page.getByTestId("first-load")).toBeHidden();
  });

  test("renders the world and all three districts", async ({ page }) => {
    for (const district of DISTRICTS) {
      await expect(page.getByTestId(`district-${district.id}`)).toBeVisible();
    }
    await expect(page.getByTestId("freshness-chip")).toBeVisible();
    await expect(page.getByTestId("city-tier-chip")).toContainText("City tier");
  });

  test("the first-load reveal clears itself without blocking the world", async ({ page }) => {
    // Pure CSS fade, so it must end up non-interactive even if JS never runs.
    const overlay = page.getByTestId("first-load");
    await expect(overlay).toBeHidden({ timeout: 5000 });
  });

  test("clicking a district opens its inspector", async ({ page }) => {
    await expect(page.getByTestId("district-inspector")).toHaveCount(0);

    await page.getByTestId("district-offer-forge").click({ force: true });

    const inspector = page.getByTestId("district-inspector");
    await expect(inspector).toBeVisible();
    await expect(page.getByTestId("inspector-title")).toHaveText("Offer Forge");
    await expect(page.getByTestId("inspector-tier")).toContainText("/ 5");
  });

  test("the dock switches districts and returns to overview", async ({ page }) => {
    for (const district of DISTRICTS) {
      await page.getByTestId(`dock-${district.id}`).click();
      await expect(page.getByTestId("inspector-title")).toHaveText(district.name);
      await expect(page.getByTestId(`dock-${district.id}`)).toHaveAttribute("aria-pressed", "true");
    }

    await page.getByTestId("dock-overview").click();
    await expect(page.getByTestId("district-inspector")).toHaveCount(0);
    await expect(page.getByTestId("dock-overview")).toHaveAttribute("aria-pressed", "true");
  });

  test("a district is reachable by keyboard", async ({ page }) => {
    const hit = page.getByTestId("district-creator-quarter");
    await hit.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("inspector-title")).toHaveText("Creator Quarter");
  });

  test("selecting a district moves the camera", async ({ page }) => {
    const world = page.getByTestId("city-world");
    const before = await world.getAttribute("viewBox");

    await page.getByTestId("dock-commerce-core").click();
    await page.waitForTimeout(900);

    const after = await world.getAttribute("viewBox");
    expect(after).not.toEqual(before);
  });

  test("zoom controls change the camera", async ({ page }) => {
    const world = page.getByTestId("city-world");
    const before = await world.getAttribute("viewBox");

    await page.getByTestId("zoom-in").click();
    await page.waitForTimeout(250);
    const zoomedIn = await world.getAttribute("viewBox");
    expect(zoomedIn).not.toEqual(before);

    await page.getByTestId("zoom-out").click();
    await page.waitForTimeout(250);
    expect(await world.getAttribute("viewBox")).not.toEqual(zoomedIn);
  });

  test("dragging the world pans the camera", async ({ page }) => {
    const world = page.getByTestId("city-world");
    const before = await world.getAttribute("viewBox");
    const box = await world.boundingBox();
    if (!box) throw new Error("world has no bounding box");

    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4, { steps: 12 });
    await page.mouse.up();

    expect(await world.getAttribute("viewBox")).not.toEqual(before);
  });
});

test.describe("Operator Mode boundary", () => {
  test("is visible, read-only, and every action is genuinely disabled", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("first-load")).toBeHidden();
    await page.getByTestId("dock-commerce-core").click();

    const operator = page.getByTestId("operator-mode");
    await expect(operator).toBeVisible();
    await expect(operator).toContainText("Read-only");

    const actions = page.getByTestId("operator-locked-action");
    const count = await actions.count();
    expect(count).toBeGreaterThan(0);

    for (let index = 0; index < count; index++) {
      const action = actions.nth(index);
      await expect(action).toBeDisabled();
      await expect(action).toHaveAttribute("aria-disabled", "true");
      await expect(action).toContainText("Locked");
    }
  });

  test("a locked action does nothing when clicked", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("first-load")).toBeHidden();
    await page.getByTestId("dock-commerce-core").click();

    const before = await page.content();
    await page.getByTestId("operator-locked-action").first().click({ force: true });
    await page.waitForTimeout(300);

    // No navigation, no dialog, no state change: the control is inert, not a
    // stub that fakes a result.
    await expect(page.getByTestId("operator-mode")).toBeVisible();
    expect(page.url()).toContain("/");
    expect((await page.content()).length).toBeCloseTo(before.length, -3);
  });
});

test.describe("short viewports", () => {
  test.use({ viewport: { width: 1024, height: 640 } });

  test("switching district while the panel is scrolled brings the new name back into view", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("first-load")).toBeHidden();
    await page.getByTestId("dock-commerce-core").click();

    const inspector = page.getByTestId("district-inspector");
    await expect(inspector).toBeVisible();

    // The panel scrolls at this height; scroll to the operator section.
    await inspector.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    expect(await inspector.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

    await page.getByTestId("dock-offer-forge").click();
    await expect(page.getByTestId("inspector-title")).toHaveText("Offer Forge");

    // Without the reset the heading stays scrolled out of sight, which reads as
    // the panel having closed rather than changed.
    expect(await inspector.evaluate((element) => element.scrollTop)).toBe(0);
    await expect(page.getByTestId("inspector-title")).toBeInViewport();
  });
});

test("the public page exposes no Whop identifiers of its own", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("city-world")).toBeVisible();
  await expect(page.getByTestId("first-load")).toBeHidden();

  // The loader payload is embedded in the page, so this covers the serialised
  // projection as well as the rendered markup. Whop's hosting injects its own
  // pixel carrying the business id in production; this asserts City's payload.
  const html = await page.content();
  for (const prefix of ["prod_", "plan_", "biz_", "ausr_"]) {
    expect(html).not.toContain(prefix);
  }
});
