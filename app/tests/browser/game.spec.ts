import { expect, test, type Page } from "@playwright/test";

/**
 * The game, played in a real browser against the built app.
 *
 * The economy's own rules are asserted in `tests/economy.test.ts`, where they
 * can be set up exactly. This is about the parts only a browser can prove: that
 * clicking the world builds something, that the world changes when it does,
 * that the constraint is legible when it bites, and that the city is still
 * there tomorrow.
 */

async function open(page: Page, scenario = "blank", { fresh = true } = {}) {
  await page.goto(`/?scenario=${scenario}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__city?.ready === true, null, { timeout: 180_000 });
  if (fresh) {
    await page.evaluate(() => {
      for (const key of Object.keys(localStorage)) if (key.startsWith("whop-city.sim")) localStorage.removeItem(key);
    });
    await reload(page);
  }
  await dismiss(page);
}

/**
 * Reload, retrying an aborted navigation.
 *
 * Reloading while the previous load is still settling a WebGL city under
 * software rasterisation can come back ERR_ABORTED; the page is fine, the
 * navigation just lost a race.
 */
async function reload(page: Page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.reload({ waitUntil: "load", timeout: 240_000 });
      break;
    } catch (error) {
      if (attempt === 2) throw error;
      await page.waitForTimeout(2_000);
    }
  }
  await page.waitForFunction(() => window.__city?.ready === true, null, { timeout: 240_000 });
}

async function dismiss(page: Page) {
  for (const action of ["away-done", "dismiss-hint"]) {
    const control = page.locator(`[data-action="${action}"]`);
    if (await control.count()) await control.click({ force: true });
  }
}

async function tap(page: Page, selector: string) {
  const control = page.locator(selector).first();
  await expect(control).toBeVisible();
  await control.click({ force: true });
}

/** Open a district and select one of its plots from the plot row. */
async function selectPlot(page: Page, district: string, chooser: string): Promise<string> {
  await tap(page, `.stud[data-district="${district}"]`);
  await expect(page.locator(`.dossier[data-district="${district}"]`)).toBeVisible();
  const chip = page.locator(chooser).first();
  await expect(chip).toBeVisible();
  const id = (await chip.getAttribute("data-plot"))!;
  await chip.click({ force: true });
  await expect(page.locator(`.moves[data-plot="${id}"]`)).toBeVisible();
  return id;
}

/** Rewind the save's clock so simulated time passes, then reload into it. */
async function passTime(page: Page, seconds: number) {
  await page.evaluate((sec) => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("whop-city.sim.v1"))!;
    const save = JSON.parse(localStorage.getItem(key)!);
    save.state.lastTickAt -= sec * 1000;
    localStorage.setItem(key, JSON.stringify(save));
  }, seconds);
  await reload(page);
}

type Position = {
  /** Plot ids to develop, in build order, with their trade and level. */
  readonly built?: ReadonlyArray<{ district: string; trade: string; level: number; count: number }>;
  readonly credits?: number;
  /** Wipe everything first. Defaults to true. */
  readonly bareFirst?: boolean;
};

/**
 * Put the save into an exact position, so a rule can be shown on demand.
 *
 * Data, not source: the page runs without `unsafe-eval`, so an earlier version
 * that shipped a function body across and rebuilt it with `new Function` threw
 * inside the browser and took seven tests with it.
 */
async function setCity(page: Page, position: Position) {
  await page.evaluate((want) => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("whop-city.sim.v1"))!;
    const save = JSON.parse(localStorage.getItem(key)!);

    type Saved = { id: string; district: string; level: number; trade: string | null; derelict: boolean; offline: string | null; built: number };
    let plots: Saved[] = save.state.plots.map((plot: Saved) =>
      want.bareFirst === false
        ? plot
        : { ...plot, level: 0, trade: null, derelict: false, offline: null, built: 0 },
    );

    let order = 0;
    for (const group of want.built ?? []) {
      let placed = 0;
      plots = plots.map((plot) => {
        if (plot.district !== group.district || placed >= group.count || plot.level > 0) return plot;
        placed += 1;
        order += 1;
        return { ...plot, level: group.level, trade: group.trade, derelict: false, offline: null, built: order };
      });
    }

    save.state.plots = plots;
    if (want.credits !== undefined) save.state.credits = want.credits;
    localStorage.setItem(key, JSON.stringify(save));
  }, position);

  await reload(page);
  await dismiss(page);
}

// ------------------------------------------------------------------ arriving

test("a new city has money, bare ground, and something to do", async ({ page }) => {
  await open(page);

  await expect(page.locator('[data-testid="credits"]')).toHaveText(/\d+/);
  await expect(page.locator(".vitals__sim")).toHaveText(/simulated/i);
  await expect(page.locator('[data-testid="city-status"]')).not.toBeEmpty();
  await expect(page.locator('[data-action="primary"]')).toHaveText(/build/i);

  // Gauges are constraints, and they are on screen from the first second.
  await expect(page.locator('[data-gauge="footfall"]')).toBeVisible();
  await expect(page.locator('[data-gauge="capacity"]')).toBeVisible();
});

test("the primary control takes you to ground worth building on", async ({ page }) => {
  await open(page);
  await tap(page, '[data-action="primary"]');
  await expect(page.locator(".moves")).toBeVisible();
  await expect(page.locator(".dossier")).toBeVisible();
});

// ------------------------------------------------------------------ building

test("clicking the ground in the world selects that plot", async ({ page }) => {
  await open(page);

  const id = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("whop-city.sim.v1"))!;
    const save = JSON.parse(localStorage.getItem(key)!);
    return save.state.plots.find((plot: { level: number }) => plot.level === 0).id as string;
  });

  const point = await page.evaluate((plotId) => window.__city!.plotPoint(plotId), id);
  expect(point, `no plot ${id} on screen`).not.toBeNull();
  await page.mouse.click(point!.x, point!.y);

  await expect(page.locator(`.moves[data-plot="${id}"]`)).toBeVisible();
  await expect(page.locator(".moves__title")).toHaveText(/bare ground/i);
});

test("building costs credits and puts something in the world", async ({ page }) => {
  await open(page);
  await selectPlot(page, "creator-quarter", '.plotchip[data-level="0"]');

  const before = Number(await page.locator('[data-testid="credits"]').innerText());
  const posts = await page.evaluate(
    () => (window.__city!.scene.getObjectByName("works:posts") as unknown as { count: number } | undefined)?.count ?? 0,
  );
  expect(posts, "the works layer is not in the scene").toBeGreaterThan(0);

  await tap(page, '.offer[data-trade="signal"]');

  // Money left the balance.
  await expect
    .poll(async () => Number(await page.locator('[data-testid="credits"]').innerText()))
    .toBeLessThan(before);

  // And the plot is standing: its chip shows a level, and the panel now offers
  // to raise it rather than to choose a trade.
  await expect(page.locator(".plotchip[data-level='1']").first()).toBeVisible();
  await expect(page.locator(".moves__title")).toHaveText(/signal tower/i);
});

test("a district's trades are its own", async ({ page }) => {
  await open(page);

  await selectPlot(page, "offer-forge", '.plotchip[data-level="0"]');
  await expect(page.locator('.offer[data-trade="foundry"]')).toBeVisible();
  await expect(page.locator('.offer[data-trade="market"]')).toHaveCount(0);

  await selectPlot(page, "commerce-core", '.plotchip[data-level="0"]');
  await expect(page.locator('.offer[data-trade="market"]')).toBeVisible();
  await expect(page.locator('.offer[data-trade="signal"]')).toHaveCount(0);
});

test("what cannot be afforded cannot be clicked, and says why", async ({ page }) => {
  await open(page);
  await setCity(page, { credits: 2 });
  await selectPlot(page, "creator-quarter", '.plotchip[data-level="0"]');

  const offer = page.locator('.offer[data-trade="signal"]');
  await expect(offer).toBeDisabled();
  await expect(offer.locator(".offer__locked")).toHaveText(/not enough credits/i);
});

test("later trades are locked until the city grows into them", async ({ page }) => {
  await open(page);
  await setCity(page, { credits: 900 });
  await selectPlot(page, "creator-quarter", '.plotchip[data-level="0"]');

  await expect(page.locator('.offer[data-trade="stage"]')).toBeDisabled();
  await expect(page.locator('.offer[data-trade="stage"] .offer__locked')).toHaveText(/unlocks at rank/i);
});

// ---------------------------------------------------------------- constraints

test("running out of headroom is visible in the panel and in the world", async ({ page }) => {
  await open(page);
  // Four signal towers want eight capacity; the city has six and no foundry.
  await setCity(page, {
    credits: 500,
    built: [{ district: "creator-quarter", trade: "signal", level: 1, count: 4 }],
  });
  await passTime(page, 15);
  await dismiss(page);

  // The gauge reads level again once the city has settled, because settling is
  // what shutting a plot down *does*. The evidence of the ceiling is the plot
  // standing dark for it, which is also what the player sees in the street.
  await tap(page, '.stud[data-district="creator-quarter"]');
  await expect(page.locator('.plotchip[data-dark="capacity"]').first()).toBeVisible();
  await tap(page, '.plotchip[data-dark="capacity"]');
  await expect(page.locator(".moves__note")).toHaveText(/no headroom/i);
});

test("a foundry gives the headroom back and the lights come on", async ({ page }) => {
  await open(page);
  await setCity(page, {
    credits: 500,
    built: [{ district: "creator-quarter", trade: "signal", level: 1, count: 4 }],
  });
  await passTime(page, 15);
  await dismiss(page);
  await tap(page, '.stud[data-district="creator-quarter"]');
  await expect(page.locator('.plotchip[data-dark="capacity"]').first()).toBeVisible();

  await selectPlot(page, "offer-forge", '.plotchip[data-level="0"]');
  await tap(page, '.offer[data-trade="foundry"]');
  await passTime(page, 15);
  await dismiss(page);

  await tap(page, '.stud[data-district="creator-quarter"]');
  await expect(page.locator('.plotchip[data-dark="capacity"]')).toHaveCount(0);
});

test("a city that cannot pay for itself goes dark, and says so", async ({ page }) => {
  await open(page);
  // A stage costs five a tick, brings a crowd nothing is selling to, and the
  // city has almost nothing in the bank.
  await setCity(page, {
    credits: 2,
    built: [{ district: "creator-quarter", trade: "stage", level: 1, count: 1 }],
  });
  await passTime(page, 40);
  await dismiss(page);

  await expect(page.locator(".vitals__alarm")).toContainText(/dark/i);
  await expect(page.locator('[data-testid="city-status"]')).toHaveText(/cannot pay/i);
  // And never below zero, whatever happens.
  await expect
    .poll(async () => Number(await page.locator('[data-testid="credits"]').innerText()))
    .toBeGreaterThanOrEqual(0);
});

// ---------------------------------------------------------------- progression

test("a bigger city unlocks a higher ceiling", async ({ page }) => {
  await open(page);
  await setCity(page, { credits: 900 });
  await selectPlot(page, "creator-quarter", '.plotchip[data-level="0"]');
  await tap(page, '.offer[data-trade="signal"]');
  // A Landing builds no higher than level one.
  await expect(page.locator(".moves__capped")).toHaveText(/builds no higher/i);

  await setCity(page, {
    credits: 900,
    built: [
      { district: "commerce-core", trade: "market", level: 1, count: 2 },
      { district: "offer-forge", trade: "foundry", level: 1, count: 2 },
      { district: "creator-quarter", trade: "signal", level: 1, count: 2 },
    ],
  });
  await expect(page.locator(".vitals__rank")).toHaveText(/township/i);
  await selectPlot(page, "creator-quarter", '.plotchip:not([data-level="0"])');
  await expect(page.locator('[data-action="upgrade"]')).toBeEnabled();
});

// ---------------------------------------------------------------- persistence

test("the city is still there after a reload, and keeps its own time", async ({ page }) => {
  await open(page);
  await selectPlot(page, "creator-quarter", '.plotchip[data-level="0"]');
  await tap(page, '.offer[data-trade="signal"]');
  const after = Number(await page.locator('[data-testid="credits"]').innerText());

  await reload(page);
  await dismiss(page);
  // Nothing is selected after a reload, so the district has to be opened
  // before its plots are on screen at all.
  await tap(page, '.stud[data-district="creator-quarter"]');
  await expect(page.locator(".plotchip[data-level='1']").first()).toBeVisible();

  // Away long enough and the city reports what it did while the tab was shut.
  await passTime(page, 900);
  const card = page.locator(".away");
  await expect(card).toBeVisible();
  await expect(page.locator('[data-testid="away-ticks"]')).toHaveText(/\d+/);
  await expect(card).toContainText(/nothing about the business changed/i);
  await tap(page, '[data-action="away-done"]');

  await expect
    .poll(async () => Number(await page.locator('[data-testid="credits"]').innerText()))
    .toBeGreaterThan(after);
});

// -------------------------------------------------------------- the boundary

test("the simulation never claims to be the business", async ({ page }) => {
  await open(page);
  await selectPlot(page, "commerce-core", '.plotchip[data-level="0"]');

  // Whop's reading is present, collapsed, and marked as the founding position.
  const seeded = page.locator(".seeded");
  await expect(seeded).toBeVisible();
  await expect(seeded.locator(".seeded__tag")).toHaveText(/as Whop found it/i);
  await seeded.locator(".seeded__summary").click({ force: true });
  await expect(seeded).toContainText(/not affected by anything you build/i);

  // Nothing simulated is stored under the business's own log, and nothing
  // about the business is stored under the city's save.
  const saved = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("whop-city.sim.v1"))!;
    return localStorage.getItem(key)!;
  });
  expect(saved).not.toMatch(/revenue|customer|member|price|product|plan_|biz_/i);
});

test("the renderer stays inside its budget with a city built out", async ({ page }) => {
  await open(page);
  await setCity(page, {
    credits: 9999,
    built: [
      { district: "commerce-core", trade: "market", level: 3, count: 9 },
      { district: "offer-forge", trade: "foundry", level: 3, count: 9 },
      { district: "creator-quarter", trade: "signal", level: 3, count: 9 },
    ],
  });

  const info = await page.evaluate(() => window.__city!.info());
  expect(info.drawCalls, `draw calls: ${info.drawCalls}`).toBeLessThanOrEqual(220);
  expect(info.triangles, `triangles: ${info.triangles}`).toBeLessThanOrEqual(250_000);
});

// ------------------------------------------------------------ small screens

test("a phone can build", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await open(page);

  await expect(page.locator(".vitals")).toBeVisible();
  await selectPlot(page, "creator-quarter", '.plotchip[data-level="0"]');
  // Scoped to this district's panel: an unscoped match can resolve against
  // whatever panel a stray tap left open on a narrow screen.
  const offer = page.locator('.dossier[data-district="creator-quarter"] .offer[data-trade="signal"]');
  await expect(offer).toBeVisible();
  const box = (await offer.boundingBox())!;
  expect(box.height, "the build target is too small for a thumb").toBeGreaterThanOrEqual(44);
  // A forced click is dispatched at the element's centre whether or not that
  // point is on screen, and on a phone the offer starts below the fold — the
  // event landed on the canvas behind the sheet and selected a different plot.
  await offer.scrollIntoViewIfNeeded();
  await offer.click({ force: true });
  await expect(page.locator('.dossier[data-district="creator-quarter"] .moves')).toContainText(
    /signal tower/i,
  );
});
