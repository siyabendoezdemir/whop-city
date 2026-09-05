import { expect, test, type Page } from "@playwright/test";

/**
 * The operator loop, end to end in a real browser against the built app.
 *
 *   signal → focus → work → plan → return
 *
 * Run against a fixtures build (`pnpm build:fixtures`), because the loop needs
 * districts in known states to be worth testing. Everything exercised is the
 * same code a live deployment runs; only the source of the states differs.
 */

async function open(page: Page, scenario?: string, { orient = true } = {}) {
  const params = new URLSearchParams();
  if (scenario) params.set("scenario", scenario);
  await page.goto(`/?${params}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__city?.ready === true, null, { timeout: 120_000 });
  await page.waitForFunction(() => (window.__city?.info().parcels ?? 0) > 0, null, { timeout: 120_000 });
  if (orient) {
    const go = page.locator('[data-action="orient-done"]');
    if (await go.count()) await go.click({ force: true });
  }
}

/**
 * Select a district by clicking it in the world.
 *
 * Returns to the wide view first, because selecting a district glides the
 * camera into it and every other marker moves — sometimes off screen.
 *
 * The camera is then snapped with the render hook rather than waited on. Under
 * software WebGL this page renders at a fraction of a frame per second, so
 * "wait for the glide to finish" can mean waiting half a minute for one frame,
 * and a click aimed at where a marker will be misses where it still is. The
 * click itself is a real click on the real canvas, and picking is exercised
 * exactly as a person would exercise it.
 */
async function clickDistrict(page: Page, districtId: string) {
  await page.click('.city-jump button[data-district="city"]');
  await page.evaluate(() => window.__city!.frame("city", 6));

  const point = await page.evaluate((id) => window.__city!.markerPoint(id), districtId);
  expect(point, `no marker on screen for ${districtId}`).not.toBeNull();

  const view = page.viewportSize()!;
  const where = `${districtId} at ${JSON.stringify(point)} in ${JSON.stringify(view)}`;
  expect(point!.x, where).toBeGreaterThan(0);
  expect(point!.x, where).toBeLessThan(view.width);
  expect(point!.y, where).toBeGreaterThan(0);
  expect(point!.y, where).toBeLessThan(view.height);

  await page.mouse.click(point!.x, point!.y);
  await expect(page.locator(`.city-brief[data-district="${districtId}"]`)).toBeVisible();
}

/**
 * Click a control without waiting for the page to hold still.
 *
 * Playwright waits for an element's box to be unchanged across two animation
 * frames before acting. This page runs a WebGL render loop that costs seconds
 * per frame under software rasterisation, so that probe can outlast its own
 * timeout on a control that has been sitting motionless the whole time. The
 * element is still asserted visible first; only the stability check is skipped.
 */
async function tap(page: Page, selector: string) {
  const control = page.locator(selector).first();
  await expect(control).toBeVisible();
  await control.click({ force: true });
}

/** Answer the current prompt with the first option of the given intent. */
async function answerCurrent(page: Page, prefer: string[]) {
  const answers = page.locator(".prompt__answers .answer");
  await expect(answers.first()).toBeVisible();
  for (const wanted of prefer) {
    const button = page.locator(`.prompt__answers .answer[data-answer="${wanted}"]`);
    if (await button.count()) {
      await button.first().click({ force: true });
      return wanted;
    }
  }
  await answers.first().click({ force: true });
  return (await answers.first().getAttribute("data-answer")) ?? "";
}

/** Walk a district's activity to the end. */
async function completeDistrict(page: Page, prefer = ["confirmed", "will-do"]) {
  // Fail loudly rather than passing quietly: a panel with no prompt in it means
  // the district was never selected, which is exactly the bug this helper hid.
  await expect(page.locator(".prompt")).toBeVisible();
  for (let guard = 0; guard < 12; guard++) {
    if ((await page.locator(".prompt").count()) === 0) return;
    await answerCurrent(page, prefer);
    await page.waitForTimeout(150);
  }
  throw new Error("activity did not finish");
}

// ------------------------------------------------------------- orientation

test("a first visit explains what the city is and whose it is", async ({ page }) => {
  await open(page, "struggling", { orient: false });

  const orient = page.locator(".orient");
  await expect(orient).toBeVisible();
  await expect(orient).toContainText("business that deployed this site");
  await expect(orient).toContainText("nothing you do here operates their business");
  // The three authorities are named up front.
  await expect(orient.locator('.prov[data-provenance="observed"]')).toBeVisible();
  await expect(orient.locator('.prov[data-provenance="reported"]')).toBeVisible();
  await expect(orient.locator('.prov[data-provenance="local"]')).toBeVisible();

  await tap(page, '[data-action="orient-done"]');
  await expect(orient).toHaveCount(0);
  // It takes you to the work rather than dumping you back at the wide view.
  await expect(page.locator(".city-brief")).toBeVisible();
});

test("orientation is not shown again, and can be reopened", async ({ page }) => {
  await open(page, "struggling");
  await open(page, "struggling", { orient: false });
  await expect(page.locator(".orient")).toHaveCount(0);

  await tap(page, '[data-action="orient"]');
  await expect(page.locator(".orient")).toBeVisible();
});

// ------------------------------------------------------------------ signal

test("the session is named after what the city is showing", async ({ page }) => {
  await open(page, "struggling");
  await expect(page.locator(".session__title")).toHaveText(/not adding up|quiet/i);

  await open(page, "thriving");
  await expect(page.locator(".session__title")).toHaveText(/maintenance/i);
});

test("business condition and player progress are separate in the queue", async ({ page }) => {
  await open(page, "struggling");

  const item = page.locator('.city-queue__item[data-district="creator-quarter"]');
  await expect(item).toHaveAttribute("data-condition", "nothing");
  await expect(item).toHaveAttribute("data-progress", "none");
  await expect(item.locator(".chip--observed")).toHaveText("Unbuilt");
  await expect(item.locator(".chip--local")).toHaveCount(0);
});

test("each condition draws a different thing in the world", async ({ page }) => {
  await open(page, "struggling");
  // struggling -> hazard sign; dormant -> survey stakes; no overlap.
  const marks = await page.evaluate(() => {
    const markers = window.__city!.scene.getObjectByName("markers")!;
    const out: Record<string, string[]> = {};
    for (const marker of markers.children) {
      const condition = marker.children.find((child) => child.name === "condition");
      const visible: string[] = [];
      condition?.traverse((child: { visible: boolean; type: string; geometry?: { type: string } }) => {
        if (child.visible && child.geometry) visible.push(child.geometry.type);
      });
      out[marker.name] = visible;
    }
    return out;
  });

  // Commerce Core reads wrong: a cone (the hazard chevron) is up.
  expect(marks["marker:commerce-core"]).toContain("ConeGeometry");
  // Creator Quarter was never built on: stakes, and no hazard chevron.
  expect(marks["marker:creator-quarter"]).not.toContain("ConeGeometry");
});

// ------------------------------------------------------------------- focus

test("clicking the world selects a district and opens its work", async ({ page }) => {
  await open(page, "struggling");
  await page.keyboard.press("Escape");
  await expect(page.locator(".city-brief")).toHaveCount(0);

  await clickDistrict(page, "offer-forge");
  const panel = page.locator(".city-brief");
  await expect(panel).toHaveAttribute("data-district", "offer-forge");
  await expect(panel.locator(".panel__activityTitle")).not.toBeEmpty();
});

test("the reading says what Whop reported and where City's knowledge stops", async ({ page }) => {
  await open(page, "struggling");
  await clickDistrict(page, "commerce-core");

  const reading = page.locator(".panel__reading");
  await expect(reading.locator(".prov")).toHaveText("From Whop");
  await expect(reading.locator(".panel__observed")).toContainText("Whop reports");
  // The state is ambiguous, and the reading says so rather than picking one.
  await expect(reading.locator(".panel__ambiguity")).toContainText(/either|cannot tell/i);
  await expect(reading.locator(".panel__limit")).toContainText("does not open your storefront");
});

// -------------------------------------------------------------------- work

test("districts have different mechanics, not the same checklist", async ({ page }) => {
  await open(page, "blank");

  await clickDistrict(page, "commerce-core");
  const commerce = await page.locator(".prompt").getAttribute("data-kind");

  await clickDistrict(page, "creator-quarter");
  const quarter = await page.locator(".prompt").getAttribute("data-kind");

  // A guided commitment in one, a branching question in the other.
  expect(new Set([commerce, quarter]).size).toBeGreaterThan(1);
});

test("a branching answer changes what comes next", async ({ page }) => {
  await open(page, "blank");
  await clickDistrict(page, "offer-forge");

  await expect(page.locator(".prompt")).toHaveAttribute("data-prompt", "shape");
  await tap(page, '.answer[data-answer="ongoing"]');
  await expect(page.locator(".prompt")).toHaveAttribute("data-prompt", "ongoing-term");

  // Change the branch: the old continuation is gone, not stranded.
  await tap(page, '[data-action="undo"]');
  await expect(page.locator(".prompt")).toHaveAttribute("data-prompt", "shape");
  await tap(page, '.answer[data-answer="once"]');
  await expect(page.locator(".prompt")).toHaveAttribute("data-prompt", "once-price");
});

test("finding a problem leaves an action behind, and a pass leaves a record", async ({ page }) => {
  await open(page, "struggling");
  await clickDistrict(page, "commerce-core");

  await tap(page, '.answer[data-answer="problem"]');
  await expect(page.locator('.planlist__item[data-kind="action"]').first()).toBeVisible();

  await tap(page, '.answer[data-answer="confirmed"]');
  await expect(page.locator('.planlist__item[data-kind="clear"]').first()).toBeVisible();
});

test("deciding against something is a valid outcome, not a skipped task", async ({ page }) => {
  await open(page, "struggling");
  await clickDistrict(page, "creator-quarter");

  await tap(page, '.answer[data-answer="no"]');

  await expect(page.locator('[data-testid="district-done"]')).toContainText("deliberately not");
  const item = page.locator('.city-queue__item[data-district="creator-quarter"]');
  await expect(item).toHaveAttribute("data-progress", "declined");
  await expect(item.locator(".chip--local")).toHaveText("You decided against");
  // And the observed condition is untouched by that decision.
  await expect(item).toHaveAttribute("data-condition", "nothing");
});

// -------------------------------------------------- progress never overwrites

test("working a struggling district does not make it look healthy", async ({ page }) => {
  await open(page, "struggling");
  await clickDistrict(page, "commerce-core");
  await completeDistrict(page);

  const item = page.locator('.city-queue__item[data-district="commerce-core"]');
  // Progress recorded...
  await expect(item).toHaveAttribute("data-progress", "worked");
  await expect(item.locator(".chip--local")).toHaveText("You worked here");
  // ...and the business condition unchanged, in the chip and in the world.
  await expect(item).toHaveAttribute("data-condition", "mixed");
  await expect(item.locator(".chip--observed")).toHaveText("Needs attention");

  const stillHazard = await page.evaluate(() => {
    const marker = window.__city!.scene.getObjectByName("marker:commerce-core")!;
    const condition = marker.children.find((child) => child.name === "condition")!;
    let cone = false;
    condition.traverse((child: { visible: boolean; geometry?: { type: string } }) => {
      if (child.visible && child.geometry?.type === "ConeGeometry") cone = true;
    });
    return cone;
  });
  expect(stillHazard, "the hazard mark disappeared when the player worked here").toBe(true);
});

// -------------------------------------------------------------- the payoff

test("finishing every district opens a plan you can take away", async ({ page }) => {
  await open(page, "thriving");

  for (const id of ["commerce-core", "offer-forge", "creator-quarter"]) {
    await clickDistrict(page, id);
    await completeDistrict(page, ["confirmed", "keep", "fine", "will-do"]);
  }

  const plan = page.locator('[data-testid="plan"]');
  await expect(plan).toBeVisible();
  await expect(plan).toContainText("Nothing about the business changed because of it");
  await expect(plan.locator(".planblock")).not.toHaveCount(0);
  await expect(plan.locator('[data-testid="rounds"]')).toHaveText("1");
  await expect(plan).toContainText("Not sent to Whop");
});

test("progress survives a reload and undo puts it back", async ({ page }) => {
  await open(page, "struggling");
  await clickDistrict(page, "commerce-core");
  await tap(page, '.answer[data-answer="problem"]');
  const before = await page.locator(".planlist__item").count();
  expect(before).toBe(1);

  await open(page, "struggling");
  await clickDistrict(page, "commerce-core");
  await expect(page.locator(".planlist__item")).toHaveCount(1);

  await tap(page, '[data-action="restart"]');
  await expect(page.locator(".planlist__item")).toHaveCount(0);
});

test("a changed reading is surfaced without claiming the work caused it", async ({ page }) => {
  await open(page, "struggling");
  await clickDistrict(page, "commerce-core");
  await tap(page, '.answer[data-answer="confirmed"]');

  await open(page, "thriving");
  await clickDistrict(page, "commerce-core");

  const changed = page.locator(".panel__changed");
  await expect(changed).toBeVisible();
  await expect(changed).toContainText("cannot tell you what changed or why");
  await expect(page.locator('.city-queue__item[data-district="commerce-core"]')).toHaveAttribute(
    "data-progress",
    "changed",
  );
});

// ---------------------------------------------------------------- keyboard

test("the loop is operable from the keyboard", async ({ page }) => {
  await open(page, "struggling");

  await page.keyboard.press("2");
  await expect(page.locator(".city-brief")).toHaveAttribute("data-district", "offer-forge");
  await page.keyboard.press("Escape");
  await expect(page.locator(".city-brief")).toHaveCount(0);
  await page.keyboard.press("f");
  await expect(page.locator(".city-brief")).toBeVisible();
  await page.keyboard.press("p");
  await expect(page.locator('[data-testid="plan"]')).toBeVisible();
});

test("every control has an accessible name", async ({ page }) => {
  await open(page, "struggling");
  await clickDistrict(page, "commerce-core");

  const controls = page.locator("main.city button");
  const count = await controls.count();
  expect(count).toBeGreaterThan(6);
  for (let i = 0; i < count; i++) {
    const control = controls.nth(i);
    const label = ((await control.getAttribute("aria-label")) ?? (await control.innerText())).trim();
    expect(label, `button ${i} has no accessible name`).not.toBe("");
  }
});

// -------------------------------------------------------------- no reading

test("an unreadable city proposes no work at all", async ({ page }) => {
  await open(page, "unavailable");

  await expect(page.locator(".session__title")).toHaveText(/nothing to work on/i);
  await clickDistrict(page, "commerce-core");
  await expect(page.locator(".panel__blocked")).toContainText("invented from nothing");
  await expect(page.locator(".prompt")).toHaveCount(0);
  await expect(page.locator(".city-progress")).toHaveCount(0);
});

// -------------------------------------------------------------- no WebGL

test("the whole session runs without WebGL", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (typeof type === "string" && type.includes("webgl")) return null;
      return original.apply(this, [type, ...rest] as never);
    } as typeof original;
  });

  await page.goto("/?scenario=struggling", { waitUntil: "load" });
  const go = page.locator('[data-action="orient-done"]');
  await expect(go).toBeVisible({ timeout: 60_000 });
  await go.click({ force: true });

  const fallback = page.locator("[data-testid=city-fallback]");
  await expect(fallback).toBeVisible();
  await expect(fallback).toContainText("could not start WebGL");

  const head = page.locator('.city-flat__head[data-district-open="commerce-core"]');
  // Orientation lands on the most pressing district, which may be this one.
  if ((await head.getAttribute("aria-expanded")) !== "true") await head.click({ force: true });
  await expect(page.locator(".city-flat__prompt")).toBeVisible();
  await tap(page, '.city-flat__prompt .answer[data-answer="problem"]');
  await expect(page.locator(".planlist__item")).not.toHaveCount(0);
});

// ------------------------------------------------------------ small screens

test("the session works on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 780 });
  await open(page, "struggling");

  await expect(page.locator(".city-queue")).toBeVisible();
  await tap(page, '.city-queue__item[data-district="commerce-core"]');
  await expect(page.locator(".city-brief")).toBeVisible();
  await tap(page, '.answer[data-answer="problem"]');
  await expect(page.locator(".planlist__item").first()).toBeVisible();
});

test("a brand new business gets a different journey from an established one", async ({ page }) => {
  await open(page, "blank");
  // Nothing exists yet, so the session is about deciding what goes here rather
  // than about finding a fault.
  await expect(page.locator(".session__title")).toHaveText(/build/i);
  await clickDistrict(page, "commerce-core");
  await expect(page.locator(".panel__observed")).toContainText("no products");
  await expect(page.locator(".prompt")).toHaveAttribute("data-kind", "commit");

  await open(page, "thriving");
  await expect(page.locator(".session__title")).toHaveText(/maintenance/i);
  await clickDistrict(page, "commerce-core");
  await expect(page.locator(".prompt")).toHaveAttribute("data-kind", "check");
});
