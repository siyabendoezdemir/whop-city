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
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => window.__city?.ready === true, null, { timeout: 180_000 });
  }
  await dismiss(page);
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
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.__city?.ready === true, null, { timeout: 180_000 });
}

/** Put the save into an exact position, so a rule can be shown on demand. */
async function setCity(page: Page, mutate: string) {
  await page.evaluate((source) => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("whop-city.sim.v1"))!;
    const save = JSON.parse(localStorage.getItem(key)!);
    // eslint-disable-next-line no-new-func
    new Function("state", source)(save.state);
    localStorage.setItem(key, JSON.stringify(save));
  }, mutate);
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.__city?.ready === true, null, { timeout: 180_000 });
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
  await setCity(page, "state.credits = 2;");
  await selectPlot(page, "creator-quarter", '.plotchip[data-level="0"]');

  const offer = page.locator('.offer[data-trade="signal"]');
  await expect(offer).toBeDisabled();
  await expect(offer.locator(".offer__locked")).toHaveText(/not enough credits/i);
});

test("later trades are locked until the city grows into them", async ({ page }) => {
  await open(page);
  await setCity(page, "state.plots = state.plots.map((p) => ({ ...p, level: 0, trade: null, derelict: false }));");
  await selectPlot(page, "creator-quarter", '.plotchip[data-level="0"]');

  await expect(page.locator('.offer[data-trade="stage"]')).toBeDisabled();
  await expect(page.locator('.offer[data-trade="stage"] .offer__locked')).toHaveText(/unlocks at rank/i);
});

// ---------------------------------------------------------------- constraints

test("running out of headroom is visible in the panel and in the world", async ({ page }) => {
  await open(page);
  // Four signal towers want eight capacity; the city has six and no foundry.
  await setCity(
    page,
    `const creator = state.plots.filter((p) => p.district === "creator-quarter");
     state.plots = state.plots.map((p) => {
       const at = creator.indexOf(p);
       if (at < 0) return { ...p, level: 0, trade: null, derelict: false, offline: null };
       return { ...p, level: 1, trade: "signal", derelict: false, offline: null, built: at + 1 };
     });
     state.credits = 500;`,
  );
  await passTime(page, 15);
  await dismiss(page);

  await expect(page.locator('[data-gauge="capacity"]')).toHaveAttribute("data-short", "true");
  await expect(page.locator('[data-testid="city-status"]')).toHaveText(/headroom/i);

  // A plot is dark for it, and the world says so too.
  await tap(page, '.stud[data-district="creator-quarter"]');
  await expect(page.locator('.plotchip[data-dark="capacity"]').first()).toBeVisible();
});

test("a foundry gives the headroom back and the lights come on", async ({ page }) => {
  await open(page);
  await setCity(
    page,
    `const creator = state.plots.filter((p) => p.district === "creator-quarter");
     state.plots = state.plots.map((p) => {
       const at = creator.indexOf(p);
       if (at < 0) return { ...p, level: 0, trade: null, derelict: false, offline: null };
       return { ...p, level: 1, trade: "signal", derelict: false, offline: null, built: at + 1 };
     });
     state.credits = 500;`,
  );
  await passTime(page, 15);
  await dismiss(page);
  await expect(page.locator('[data-gauge="capacity"]')).toHaveAttribute("data-short", "true");

  await selectPlot(page, "offer-forge", '.plotchip[data-level="0"]');
  await tap(page, '.offer[data-trade="foundry"]');
  await passTime(page, 15);
  await dismiss(page);

  await expect(page.locator('[data-gauge="capacity"]')).toHaveAttribute("data-short", "false");
  await tap(page, '.stud[data-district="creator-quarter"]');
  await expect(page.locator('.plotchip[data-dark="capacity"]')).toHaveCount(0);
});

test("a city that cannot pay for itself goes dark, and says so", async ({ page }) => {
  await open(page);
  // A stage costs five a tick, brings a crowd nothing is selling to, and the
  // city has almost nothing in the bank.
  await setCity(
    page,
    `state.plots = state.plots.map((p, i) => {
       if (p.district === "creator-quarter" && i === state.plots.findIndex((q) => q.district === "creator-quarter")) {
         return { ...p, level: 1, trade: "stage", derelict: false, offline: null, built: 1 };
       }
       return { ...p, level: 0, trade: null, derelict: false, offline: null, built: 0 };
     });
     state.credits = 2;`,
  );
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
  await setCity(page, "state.plots = state.plots.map((p) => ({ ...p, level: 0, trade: null, derelict: false }));");
  await selectPlot(page, "creator-quarter", '.plotchip[data-level="0"]');
  await tap(page, '.offer[data-trade="signal"]');
  // A Landing builds no higher than level one.
  await expect(page.locator(".moves__capped")).toHaveText(/builds no higher/i);

  await setCity(
    page,
    `state.plots = state.plots.map((p, i) => ({ ...p, level: i < 6 ? 1 : 0,
       trade: i < 6 ? (p.district === "commerce-core" ? "market" : p.district === "offer-forge" ? "foundry" : "signal") : null,
       derelict: false, offline: null, built: i + 1 }));
     state.credits = 900;`,
  );
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

  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.__city?.ready === true, null, { timeout: 180_000 });
  await dismiss(page);
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
  await setCity(
    page,
    `state.plots = state.plots.map((p, i) => ({ ...p, level: 3,
       trade: p.district === "commerce-core" ? "market" : p.district === "offer-forge" ? "foundry" : "signal",
       derelict: false, offline: null, built: i + 1 }));
     state.credits = 9999;`,
  );

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
  const offer = page.locator('.offer[data-trade="signal"]');
  const box = (await offer.boundingBox())!;
  expect(box.height, "the build target is too small for a thumb").toBeGreaterThanOrEqual(44);
  await offer.click({ force: true });
  await expect(page.locator(".moves__title")).toHaveText(/signal tower/i);
});
