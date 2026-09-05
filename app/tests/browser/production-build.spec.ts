import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

/**
 * What a deployable build actually is.
 *
 * Everything here runs against `pnpm build` output — the artefact
 * `whop apps deploy` uploads — and not against `pnpm build:fixtures`. Run it
 * with `pnpm test:browser:production` after a production build.
 *
 * The point is that fixtures are a build-time capability rather than a runtime
 * flag. `.dev.vars` not being uploaded is a convention; this is the boundary.
 * `.dev.vars` still carries `CITY_FIXTURES=1` in the local worker, so these
 * tests are the case where the binding *is* present and must be ignored anyway.
 */

const SERVER_DIR = resolve(process.cwd(), "dist/server");

/** Every module the worker would run, concatenated. */
function workerSource(): string {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".js")) files.push(readFileSync(path, "utf8"));
    }
  };
  walk(SERVER_DIR);
  return files.join("\n");
}

test("the deployable bundle contains no fixture data at all", () => {
  const source = workerSource();

  // The invented business the fixtures describe. If any of this survived, the
  // guard did not eliminate the branch and a hosted CITY_FIXTURES could reach
  // it.
  for (const trace of [
    "fixture_account_",
    "fixture_product_",
    "fixture_plan_",
    "Fixture product",
  ]) {
    expect(source, `deployable bundle carries "${trace}"`).not.toContain(trace);
  }

  // Sanity: this really is the worker and not an empty read.
  expect(source).toContain("/api/city/snapshot");
  expect(source.length).toBeGreaterThan(10_000);
});

test("the fixture guard compiled to false", () => {
  const source = workerSource();
  // The identifier is replaced at build time. Its survival would mean the
  // define did not apply and the decision was left to runtime.
  expect(source).not.toContain("__CITY_FIXTURES_BUILD__");
});

test("a hosted CITY_FIXTURES cannot produce a live city", async ({ request, baseURL }) => {
  // `.dev.vars` sets CITY_FIXTURES=1 for the local worker, so the binding is
  // genuinely present here — this is the misconfigured-hosted case, not an
  // absence of configuration.
  const response = await request.get(`${baseURL}/api/city/snapshot`);
  expect(response.status()).toBe(200);

  const body = await response.json();
  expect(body.freshness, "a production build served fixtures").toBe("unavailable");
  expect(body.freshness).not.toBe("live");
  expect(body.seed).toBe("0000000000000000");

  for (const district of body.districts) {
    expect(district.state).toBe("dormant");
    expect(district.signal).toBe("unreadable");
  }
});

test("the fixture scenario parameter does nothing on a production build", async ({
  request,
  baseURL,
}) => {
  for (const scenario of ["thriving", "balanced", "launch", "struggling"]) {
    const response = await request.get(`${baseURL}/api/city/snapshot?scenario=${scenario}`);
    const body = await response.json();
    expect(body.freshness, `scenario=${scenario} produced a non-unavailable city`).toBe(
      "unavailable",
    );
    expect(body.districts.every((d: { state: string }) => d.state === "dormant")).toBe(true);
  }
});

test("the rendered city is the unavailable one, and still safe", async ({ page }) => {
  await page.goto("/", { waitUntil: "load" });
  await page.waitForFunction(() => window.__city?.ready === true, null, { timeout: 120_000 });
  await page.waitForFunction(() => (window.__city?.info().parcels ?? 0) > 0, null, {
    timeout: 120_000,
  });

  // The world builds, so the page is not simply broken.
  const info = await page.evaluate(() => window.__city!.info());
  expect(info.parcels).toBeGreaterThan(0);
  expect(info.drawCalls).toBeGreaterThan(0);

  // Nobody has proved they run this business, so every figure reads zero and
  // the interface says why rather than pretending the business is empty.
  await expect(page.locator(".public-note")).toContainText("public view");
  for (const resource of ["gold", "citizens", "traffic", "recurring"]) {
    await expect(page.locator(`[data-testid="res-${resource}"]`)).toHaveText(/^\$?0$/);
  }

  // With nothing earned there is nothing to claim: no upgrade is on offer.
  await expect(page.locator(".ready")).toHaveCount(0);
  await expect(page.locator(".nudge")).toBeVisible();
});
