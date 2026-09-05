import { expect, test, type Page } from "@playwright/test";

/**
 * The round, played end to end in a real browser against the built app.
 *
 *   arrive → see where to act → enter a district → work → plan → return
 *
 * Run against a fixtures build (`pnpm build:fixtures`), because the loop needs
 * districts in known states to be worth testing. Everything exercised is the
 * same code a live deployment runs; only the source of the states differs.
 */

async function open(page: Page, scenario?: string) {
  const params = new URLSearchParams();
  if (scenario) params.set("scenario", scenario);
  await page.goto(`/?${params}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__city?.ready === true, null, { timeout: 120_000 });
  await page.waitForFunction(() => (window.__city?.info().parcels ?? 0) > 0, null, { timeout: 120_000 });
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

/**
 * Select a district by clicking it in the world.
 *
 * Returns to the wide view first, because entering a district moves the camera
 * and every other marker moves with it. The camera is then snapped with the
 * render hook rather than waited on: under software WebGL this page renders at
 * a fraction of a frame per second, so a click aimed at where a marker will be
 * misses where it still is. The click itself is a real click on the canvas.
 */
async function clickDistrict(page: Page, districtId: string) {
  const back = page.locator(".bar__back");
  if (await back.count()) await back.click({ force: true });
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
  await expect(page.locator(`.dossier[data-district="${districtId}"]`)).toBeVisible();
}

/** Answer the step in front of you, preferring one of the given intents. */
async function answerCurrent(page: Page, prefer: string[]) {
  const answers = page.locator(".answers .answer, .fork__options .plate");
  await expect(answers.first()).toBeVisible();
  for (const wanted of prefer) {
    const button = page.locator(`[data-answer="${wanted}"]`);
    if (await button.count()) {
      await button.first().click({ force: true });
      return wanted;
    }
  }
  await answers.first().click({ force: true });
  return (await answers.first().getAttribute("data-answer")) ?? "";
}

async function completeDistrict(page: Page, prefer = ["confirmed", "will-do"]) {
  // Fail loudly rather than passing quietly: no step on screen means the
  // district was never entered.
  await expect(page.locator(".act[data-prompt]")).toBeVisible();
  for (let guard = 0; guard < 12; guard++) {
    if ((await page.locator(".act[data-prompt]").count()) === 0) return;
    await answerCurrent(page, prefer);
    await page.waitForTimeout(150);
  }
  throw new Error("activity did not finish");
}

// ------------------------------------------------------------------- arrive

test("the resting city carries three things and no more", async ({ page }) => {
  await open(page, "struggling");

  // Identity, one control, camera. That is the whole HUD at rest.
  await expect(page.locator(".seal")).toBeVisible();
  await expect(page.locator(".bar")).toBeVisible();
  await expect(page.locator(".camera")).toBeVisible();
  await expect(page.locator(".dossier")).toHaveCount(0);
  await expect(page.locator(".sheet")).toHaveCount(0);

  // One primary control, named for what it does.
  const primary = page.locator(".btn--primary");
  await expect(primary).toHaveCount(1);
  await expect(primary).toHaveText(/begin round/i);

  // The district list exists once, as the studs, and is not duplicated.
  await expect(page.locator(".stud")).toHaveCount(3);
  await expect(page.locator("nav")).toHaveCount(0);
});

test("what this is lives behind About rather than in front of the city", async ({ page }) => {
  await open(page, "struggling");
  await expect(page.locator(".about")).toHaveCount(0);

  await tap(page, '[data-action="about"]');
  const about = page.locator(".about");
  await expect(about).toBeVisible();
  await expect(about).toContainText("business that deployed this site");
  await expect(about).toContainText("nothing here operates it");
  await expect(about).toContainText("public and read-only");
  // All three authorities named once, in one place.
  await expect(about.locator(".source")).toHaveCount(3);

  await tap(page, '[data-action="about-done"]');
  await expect(page.locator(".about")).toHaveCount(0);
});

test("the round is named after what the city is showing", async ({ page }) => {
  await open(page, "struggling");
  await expect(page.locator(".bar__title")).toHaveText(/not adding up|quiet/i);

  await open(page, "thriving");
  await expect(page.locator(".bar__title")).toHaveText(/maintenance/i);
});

test("the primary control takes you to the work", async ({ page }) => {
  await open(page, "struggling");
  await tap(page, '[data-action="primary"]');
  await expect(page.locator(".dossier")).toBeVisible();
  // And the bar becomes the way back out.
  await expect(page.locator(".bar__back")).toBeVisible();
  await tap(page, ".bar__back");
  await expect(page.locator(".dossier")).toHaveCount(0);
});

// ------------------------------------------------------------------- signal

test("condition and player progress are separate, and only one is loud", async ({ page }) => {
  await open(page, "struggling");

  const stud = page.locator('.stud[data-district="creator-quarter"]');
  await expect(stud).toHaveAttribute("data-condition", "nothing");
  await expect(stud).toHaveAttribute("data-progress", "none");
  await expect(stud).toHaveAttribute("data-tone", "open");
  await expect(stud).toHaveAccessibleName(/Creator Quarter: Unbuilt/);
});

test("each condition draws a different thing in the world", async ({ page }) => {
  await open(page, "struggling");
  const marks = await page.evaluate(() => {
    const markers = window.__city!.scene.getObjectByName("markers")!;
    const out: Record<string, string[]> = {};
    for (const marker of markers.children) {
      const condition = marker.children.find((child) => child.name === "condition");
      const visible: string[] = [];
      condition?.traverse((child: { visible: boolean; geometry?: { type: string } }) => {
        if (child.visible && child.geometry) visible.push(child.geometry.type);
      });
      out[marker.name] = visible;
    }
    return out;
  });

  expect(marks["marker:commerce-core"]).toContain("ConeGeometry");
  expect(marks["marker:creator-quarter"]).not.toContain("ConeGeometry");
});

// ------------------------------------------------------------------- enter

test("clicking the world enters that district", async ({ page }) => {
  await open(page, "struggling");
  await clickDistrict(page, "offer-forge");

  const dossier = page.locator(".dossier");
  await expect(dossier.locator(".dossier__name")).toHaveText("Offer Forge");
  await expect(dossier.locator(".cond")).toBeVisible();
  await expect(dossier.locator(".act__title")).not.toBeEmpty();
  // The stud shows where you are, without a second navigation appearing.
  await expect(page.locator('.stud[data-district="offer-forge"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("the evidence is one click away, not four lines in front of the work", async ({ page }) => {
  await open(page, "struggling");
  await clickDistrict(page, "commerce-core");

  // The surface carries the condition, in words that do not diagnose.
  await expect(page.locator(".state .cond")).toHaveText(/Not adding up/);
  await expect(page.locator(".why__observed")).toBeHidden();

  await tap(page, ".why__summary");
  await expect(page.locator(".why__observed")).toContainText("Whop reports");
  // The ambiguity survives the redesign: City still cannot say which it is.
  await expect(page.locator(".why__ambiguity")).toContainText(/either|cannot tell/i);
  await expect(page.locator(".why__limit")).toContainText("does not open your storefront");
});

// -------------------------------------------------------------------- work

test("the three activities are composed differently", async ({ page }) => {
  await open(page, "blank");

  await clickDistrict(page, "commerce-core");
  await expect(page.locator(".act")).toHaveAttribute("data-kind", "commit");
  await expect(page.locator(".resolve")).toBeVisible();

  await clickDistrict(page, "offer-forge");
  await expect(page.locator(".act")).toHaveAttribute("data-kind", "choice");
  await expect(page.locator(".fork__options .plate")).toHaveCount(3);

  await open(page, "struggling");
  await clickDistrict(page, "commerce-core");
  await expect(page.locator(".act")).toHaveAttribute("data-kind", "check");
  await expect(page.locator(".ledger")).toBeVisible();
});

test("a survey collapses what you answered behind you", async ({ page }) => {
  await open(page, "struggling");
  await clickDistrict(page, "commerce-core");

  await expect(page.locator(".ledger__row")).toHaveCount(0);
  await tap(page, '[data-answer="problem"]');
  // The answered step becomes one line carrying what you said.
  const row = page.locator(".ledger__row");
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute("data-outcome", "flagged");
  await expect(row).toContainText("Found a problem");
});

test("a branching answer changes what comes next", async ({ page }) => {
  await open(page, "blank");
  await clickDistrict(page, "offer-forge");

  await expect(page.locator(".act")).toHaveAttribute("data-prompt", "shape");
  await tap(page, '.plate[data-answer="ongoing"]');
  await expect(page.locator(".act")).toHaveAttribute("data-prompt", "ongoing-term");

  await tap(page, '[data-action="undo"]');
  await expect(page.locator(".act")).toHaveAttribute("data-prompt", "shape");
  await tap(page, '.plate[data-answer="once"]');
  await expect(page.locator(".act")).toHaveAttribute("data-prompt", "once-price");
});

test("finding a problem leaves an action, and a pass leaves a record", async ({ page }) => {
  await open(page, "struggling");
  await clickDistrict(page, "commerce-core");

  await tap(page, '[data-answer="problem"]');
  await expect(page.locator('.note[data-kind="action"]').first()).toBeVisible();

  await tap(page, '[data-answer="confirmed"]');
  await expect(page.locator('.note[data-kind="clear"]').first()).toBeVisible();
});

test("deciding against something is an outcome, not a skipped task", async ({ page }) => {
  await open(page, "struggling");
  await clickDistrict(page, "creator-quarter");

  await tap(page, '.plate[data-answer="no"]');

  await expect(page.locator(".dossier__aside")).toContainText("Set aside deliberately");
  const stud = page.locator('.stud[data-district="creator-quarter"]');
  await expect(stud).toHaveAttribute("data-done", "true");
  await expect(stud).toHaveAttribute("data-condition", "nothing");
});

// -------------------------------------------------- progress never overwrites

test("working a struggling district does not make it look healthy", async ({ page }) => {
  await open(page, "struggling");
  await clickDistrict(page, "commerce-core");
  await completeDistrict(page);

  const stud = page.locator('.stud[data-district="commerce-core"]');
  await expect(stud).toHaveAttribute("data-done", "true");
  // The condition is untouched, in the stud and in its accessible name.
  await expect(stud).toHaveAttribute("data-condition", "mixed");
  await expect(stud).toHaveAttribute("data-tone", "alert");
  await expect(stud).toHaveAccessibleName(/Not adding up/);

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
  await expect(plan.locator(".entry")).toHaveCount(3);
  // Each entry keeps the two authorities apart: Whop's condition, your items.
  await expect(plan.locator(".entry").first().locator(".cond")).toBeVisible();
  await expect(plan).toContainText("not sent to Whop");
  await expect(plan.locator('[data-action="copy-plan"]')).toBeVisible();
  await expect(plan.locator('[data-action="download-plan"]')).toBeVisible();
});

test("progress survives a reload and starting over clears it", async ({ page }) => {
  await open(page, "struggling");
  await clickDistrict(page, "commerce-core");
  await tap(page, '[data-answer="problem"]');
  await expect(page.locator(".note")).toHaveCount(1);

  await open(page, "struggling");
  await clickDistrict(page, "commerce-core");
  await expect(page.locator(".note")).toHaveCount(1);

  await tap(page, '[data-action="restart"]');
  await expect(page.locator(".note")).toHaveCount(0);
});

test("a changed reading is surfaced without claiming the work caused it", async ({ page }) => {
  await open(page, "struggling");
  await clickDistrict(page, "commerce-core");
  await tap(page, '[data-answer="confirmed"]');

  await open(page, "thriving");
  await clickDistrict(page, "commerce-core");

  const changed = page.locator(".state__changed");
  await expect(changed).toBeVisible();
  await expect(changed).toContainText("cannot say what changed, or why");
  await expect(page.locator('.stud[data-district="commerce-core"]')).toHaveAttribute(
    "data-progress",
    "changed",
  );
});

test("a brand new business gets a different journey from an established one", async ({ page }) => {
  await open(page, "blank");
  await expect(page.locator(".bar__title")).toHaveText(/build/i);
  await clickDistrict(page, "commerce-core");
  await expect(page.locator(".state .cond")).toHaveText(/Unbuilt/);
  await expect(page.locator(".act")).toHaveAttribute("data-kind", "commit");

  await open(page, "thriving");
  await expect(page.locator(".bar__title")).toHaveText(/maintenance/i);
  await clickDistrict(page, "commerce-core");
  await expect(page.locator(".state .cond")).toHaveText(/Steady/);
  await expect(page.locator(".act")).toHaveAttribute("data-kind", "check");
});

// ---------------------------------------------------------------- keyboard

test("the round is operable from the keyboard", async ({ page }) => {
  await open(page, "struggling");

  await page.keyboard.press("2");
  await expect(page.locator(".dossier")).toHaveAttribute("data-district", "offer-forge");
  await page.keyboard.press("Escape");
  await expect(page.locator(".dossier")).toHaveCount(0);
  await page.keyboard.press("f");
  await expect(page.locator(".dossier")).toBeVisible();
  await page.keyboard.press("p");
  await expect(page.locator('[data-testid="plan"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-testid="plan"]')).toHaveCount(0);
});

test("every control has an accessible name and a comfortable target", async ({ page }) => {
  await open(page, "struggling");
  await clickDistrict(page, "commerce-core");

  const controls = page.locator("main.city button");
  const count = await controls.count();
  expect(count).toBeGreaterThan(6);
  for (let i = 0; i < count; i++) {
    const control = controls.nth(i);
    const label = ((await control.getAttribute("aria-label")) ?? (await control.innerText())).trim();
    expect(label, `button ${i} has no accessible name`).not.toBe("");
    const box = await control.boundingBox();
    // Subtle must not mean tiny. The camera cluster is the smallest thing here.
    if (box) expect(box.height, `button "${label}" is ${box.height}px tall`).toBeGreaterThanOrEqual(24);
  }
});

// -------------------------------------------------------------- no reading

test("an unreadable city proposes no work at all", async ({ page }) => {
  await open(page, "unavailable");

  await expect(page.locator(".bar__title")).toHaveText(/nothing to work on/i);
  await clickDistrict(page, "commerce-core");
  await expect(page.locator(".state .cond")).toHaveText(/No reading/);
  await expect(page.locator(".act--blocked")).toContainText("invented from nothing");
  await expect(page.locator(".act[data-prompt]")).toHaveCount(0);
});

// -------------------------------------------------------------- no WebGL

test("the whole round runs without WebGL", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (typeof type === "string" && type.includes("webgl")) return null;
      return original.apply(this, [type, ...rest] as never);
    } as typeof original;
  });

  await page.goto("/?scenario=struggling", { waitUntil: "load" });
  const fallback = page.locator("[data-testid=city-fallback]");
  await expect(fallback).toBeVisible({ timeout: 60_000 });
  await expect(fallback).toContainText("could not start WebGL");
  // The same vocabulary, without the world to draw it.
  await expect(fallback.locator(".cond").first()).toBeVisible();

  const head = page.locator('.flat__head[data-district-open="commerce-core"]');
  if ((await head.getAttribute("aria-expanded")) !== "true") await head.click({ force: true });
  await expect(page.locator(".flat__prompt")).toBeVisible();
  await tap(page, '.flat__prompt [data-answer="problem"]');
  await expect(page.locator(".note")).not.toHaveCount(0);
});

// ------------------------------------------------------------ small screens

test("a phone keeps the city visible instead of being all panel", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await open(page, "struggling");

  // The canvas fills the window rather than letterboxing into black bars.
  const canvas = await page.locator("canvas").boundingBox();
  expect(canvas!.height).toBeGreaterThan(700);

  await expect(page.locator(".bar")).toBeVisible();
  await tap(page, '.stud[data-district="commerce-core"]');
  const dossier = page.locator(".dossier");
  await expect(dossier).toBeVisible();

  // The sheet takes the lower part; the city keeps the top.
  const box = (await dossier.boundingBox())!;
  expect(box.y, "the sheet covers the whole phone").toBeGreaterThan(200);

  // And the bar stays reachable above it.
  const bar = (await page.locator(".bar").boundingBox())!;
  expect(bar.y + bar.height).toBeLessThanOrEqual(780);

  await tap(page, '[data-answer="problem"]');
  await expect(page.locator(".note").first()).toBeVisible();
});

// ------------------------------------------------------- notes and recovery

test("the operator's own line reaches the plan", async ({ page }) => {
  await open(page, "struggling");
  await clickDistrict(page, "commerce-core");

  const note = page.locator('[data-testid="note"]');
  await note.fill("Two products went hidden after the migration. Check both before Friday.");
  await note.blur();

  await expect(page.locator('.note[data-kind="note"]')).toContainText("after the migration");

  // And it is still there after a reload, on the district it was written on.
  await open(page, "struggling");
  await clickDistrict(page, "commerce-core");
  await expect(page.locator('[data-testid="note"]')).toHaveValue(/after the migration/);
  await clickDistrict(page, "offer-forge");
  await expect(page.locator('[data-testid="note"]')).toHaveValue("");
});

test("an answered step can be answered again", async ({ page }) => {
  await open(page, "struggling");
  await clickDistrict(page, "commerce-core");

  await tap(page, '[data-answer="confirmed"]');
  await tap(page, '[data-answer="confirmed"]');
  await expect(page.locator(".ledger__row")).toHaveCount(2);
  await expect(page.locator(".act")).toHaveAttribute("data-prompt", "members");

  // Re-open the first step: it comes back, and the step that followed it goes,
  // because that answer was given on the strength of this one.
  await tap(page, '[data-reopen="visible"]');
  await expect(page.locator(".act")).toHaveAttribute("data-prompt", "visible");
  await expect(page.locator(".ledger__row")).toHaveCount(0);

  await tap(page, '[data-answer="problem"]');
  await expect(page.locator('.note[data-kind="action"]')).toHaveCount(1);
});

// ------------------------------------------------------- the round lifecycle

test("finishing files the round instead of erasing it", async ({ page }) => {
  await open(page, "thriving");
  for (const id of ["commerce-core", "offer-forge", "creator-quarter"]) {
    await clickDistrict(page, id);
    await completeDistrict(page, ["confirmed", "keep", "fine", "will-do"]);
  }

  const plan = page.locator('[data-testid="plan"]');
  await expect(plan).toBeVisible();
  await expect(plan.locator(".entry")).toHaveCount(3);

  await tap(page, '[data-action="new-round"]');

  // A new round is open, and the one just finished is kept rather than gone.
  await expect(page.locator('[data-testid="plan"]')).toHaveCount(0);
  await expect(page.locator(".bar__go")).toHaveText(/begin round/i);
  await expect(page.locator(".stud[data-done='true']")).toHaveCount(0);

  await page.keyboard.press("p");
  const filed = page.locator(".filed");
  await expect(filed).toBeVisible();
  await filed.locator(".filed__summary").click({ force: true });
  await expect(filed.locator(".filed__round")).toHaveCount(1);
  await expect(filed.locator('[data-action="copy-filed"]')).toBeVisible();

  // And it survives a reload, which is the point of filing it.
  await open(page, "thriving");
  await page.keyboard.press("p");
  await expect(page.locator(".filed__round")).toHaveCount(1);
});

test("discarding a round asks first, and spares what was filed", async ({ page }) => {
  await open(page, "thriving");
  for (const id of ["commerce-core", "offer-forge", "creator-quarter"]) {
    await clickDistrict(page, id);
    await completeDistrict(page, ["confirmed", "keep", "fine", "will-do"]);
  }
  await tap(page, '[data-action="new-round"]');

  await clickDistrict(page, "commerce-core");
  await tap(page, '[data-answer="confirmed"]');
  await page.keyboard.press("p");

  // Nothing is destroyed on the first click.
  await tap(page, '[data-action="discard"]');
  await expect(page.locator(".confirm__ask")).toBeVisible();
  await tap(page, '[data-action="discard-no"]');
  await expect(page.locator(".entry")).toHaveCount(1);

  await tap(page, '[data-action="discard"]');
  await tap(page, '[data-action="discard-yes"]');
  await page.keyboard.press("p");
  await expect(page.locator(".entry")).toHaveCount(0);
  // The filed round is untouched by discarding the one in progress.
  await expect(page.locator(".filed__round")).toHaveCount(1);
});

test("the plan can be copied and downloaded", async ({ page }) => {
  await open(page, "struggling");
  await clickDistrict(page, "commerce-core");
  await tap(page, '[data-answer="problem"]');
  await page.keyboard.press("p");

  // Copy reports what actually happened rather than always claiming success.
  await tap(page, '[data-action="copy-plan"]');
  await expect(page.locator('[data-action="copy-plan"]')).toHaveText(/copied|copy failed/i);

  const download = page.waitForEvent("download");
  await tap(page, '[data-action="download-plan"]');
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^whop-city-\d{4}-\d{2}-\d{2}-.*\.md$/);

  const path = await file.path();
  const text = await (await import("node:fs/promises")).readFile(path!, "utf8");
  // The export is a checklist someone can act on, and says where it came from.
  expect(text).toContain("# Whop City");
  expect(text).toContain("Whop reported: Not adding up");
  expect(text).toMatch(/^- \[ ] /m);
  expect(text).toContain("Not sent to Whop");
});

test("copy that cannot work says so instead of claiming success", async ({ page }) => {
  await page.addInitScript(() => {
    // Both routes refused, which is what an insecure origin or a restrictive
    // permissions policy looks like from the page's side.
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    document.execCommand = () => false;
  });
  await open(page, "struggling");
  await clickDistrict(page, "commerce-core");
  await tap(page, '[data-answer="problem"]');
  await page.keyboard.press("p");

  await tap(page, '[data-action="copy-plan"]');
  await expect(page.locator('[data-action="copy-plan"]')).toHaveText(/copy failed/i);
  // And the text is put on screen to be taken by hand.
  await expect(page.locator('[data-testid="plan-text"]')).toBeVisible();
  await expect(page.locator('[data-testid="plan-text"]')).toHaveValue(/Whop City/);
});

test("a phone can reach the bottom of a district and type in it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await open(page, "struggling");
  await tap(page, '.stud[data-district="commerce-core"]');
  await tap(page, '[data-answer="problem"]');

  const note = page.locator('[data-testid="note"]');
  await note.fill("a reminder");
  await note.blur();

  // The last line of the sheet must clear the pinned bar rather than sit under it.
  const clear = await page.evaluate(() => {
    const sheet = document.querySelector(".dossier")!;
    sheet.scrollTop = sheet.scrollHeight;
    const last = document.querySelector(".notes__where")!.getBoundingClientRect();
    const bar = document.querySelector(".bar")!.getBoundingClientRect();
    return { lastBottom: last.bottom, barTop: bar.top };
  });
  expect(clear.lastBottom, "the last line is under the command bar").toBeLessThan(clear.barTop);
});
