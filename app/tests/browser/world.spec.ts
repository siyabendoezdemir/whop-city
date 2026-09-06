import { expect, test } from "@playwright/test";

/**
 * Does the projection actually change the world?
 *
 * Not "does the panel text change" — that would pass with a static city behind
 * it. These compare the built scene: the geometry the renderer produced, the
 * draw calls it costs, and the pixels on the canvas.
 */

type Info = {
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  parcels: number;
  propInstances: number;
};

const BUDGET = { drawCalls: 220, triangles: 250_000 };

async function open(page: import("@playwright/test").Page, scenario?: string) {
  // Reduced motion, which is how the product itself skips the founding sweep.
  // Without it these would sample a city that is still going up, and a world
  // measured halfway through being built is not a world.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const params = new URLSearchParams({ capture: "1", ss: "1" });
  if (scenario) params.set("scenario", scenario);
  await page.goto(`/?${params}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__city?.ready === true, null, { timeout: 120_000 });
  await page.waitForFunction(() => (window.__city?.info().parcels ?? 0) > 0, null, { timeout: 120_000 });
  await page.evaluate(() => window.__city!.frame("city", 6));
}

async function info(page: import("@playwright/test").Page): Promise<Info> {
  return page.evaluate(() => window.__city!.info());
}

/** A cheap fingerprint of what was actually built, independent of the camera. */
async function worldFingerprint(page: import("@playwright/test").Page): Promise<string> {
  return page.evaluate(() => {
    let meshes = 0;
    let vertices = 0;
    const names: string[] = [];
    window.__city!.scene.traverse((child: { type: string; name?: string; geometry?: { attributes?: { position?: { count: number } } } }) => {
      if (!child.geometry?.attributes?.position) return;
      meshes += 1;
      vertices += child.geometry.attributes.position.count;
      if (child.name) names.push(child.name);
    });
    return `${meshes}:${vertices}:${names.sort().join(",")}`;
  });
}

/** Vertices in the built scene, out of the fingerprint. */
const vertexCount = (fingerprint: string) => Number(fingerprint.split(":")[1]);

test("each projection state builds a different world", async ({ page }) => {
  const seen = new Map<string, { fingerprint: string; info: Info }>();

  for (const scenario of ["balanced", "launch", "thriving", "struggling", "unavailable"]) {
    await open(page, scenario);
    seen.set(scenario, { fingerprint: await worldFingerprint(page), info: await info(page) });
  }

  // Every scenario produced a distinct world, not the same city relabelled.
  const fingerprints = [...seen.values()].map((entry) => entry.fingerprint);
  expect(new Set(fingerprints).size, "two scenarios built the identical world").toBe(
    fingerprints.length,
  );

  // And the difference is real geometry, not a rounding artefact. Vertices
  // rather than triangles, because a taller building is not reliably more
  // triangles: past six storeys the glazing runs in bands instead of hundreds
  // of punched openings, so a bigger city can be a cheaper one.
  expect(vertexCount(seen.get("thriving")!.fingerprint)).toBeGreaterThan(
    vertexCount(seen.get("struggling")!.fingerprint) * 1.15,
  );
  expect(vertexCount(seen.get("struggling")!.fingerprint)).toBeGreaterThan(
    vertexCount(seen.get("unavailable")!.fingerprint) * 1.15,
  );
});

/**
 * A coarse luma grid of the rendered frame.
 *
 * Read out of the canvas rather than from an encoded screenshot: comparing PNG
 * byte lengths measures how well the image compressed, which is only loosely
 * related to how much of it changed.
 */
async function pixelSignature(page: import("@playwright/test").Page): Promise<number[]> {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas") as HTMLCanvasElement;
    const cols = 64;
    const rows = 40;
    const scratch = document.createElement("canvas");
    scratch.width = cols;
    scratch.height = rows;
    const ctx = scratch.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(canvas, 0, 0, cols, rows);
    const { data } = ctx.getImageData(0, 0, cols, rows);
    const out: number[] = [];
    for (let i = 0; i < cols * rows; i++) {
      out.push(0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]);
    }
    return out;
  });
}

test("a state change rebuilds the pixels, not just the text", async ({ page }) => {
  await open(page, "thriving");
  const healthy = await pixelSignature(page);

  await open(page, "struggling");
  const struggling = await pixelSignature(page);

  // How much of the frame actually changed, and by how much.
  const changed = healthy.filter((value, i) => Math.abs(value - struggling[i]) > 8).length;
  const share = changed / healthy.length;
  const meanDelta =
    healthy.reduce((sum, value, i) => sum + Math.abs(value - struggling[i]), 0) / healthy.length;

  expect(share, `only ${(share * 100).toFixed(1)}% of the frame changed`).toBeGreaterThan(0.15);
  expect(meanDelta).toBeGreaterThan(4);
});

test("the same projection always builds the same world", async ({ page }) => {
  await open(page, "balanced");
  const first = await worldFingerprint(page);
  const firstPixels = await page.locator("canvas").screenshot();

  await open(page, "balanced");
  expect(await worldFingerprint(page)).toBe(first);
  expect((await page.locator("canvas").screenshot()).equals(firstPixels)).toBe(true);
});

test("every state stays inside the render budget", async ({ page }) => {
  for (const scenario of ["balanced", "launch", "thriving", "struggling", "unavailable"]) {
    await open(page, scenario);
    const measured = await info(page);
    expect(measured.drawCalls, `${scenario} draw calls`).toBeLessThanOrEqual(BUDGET.drawCalls);
    expect(measured.triangles, `${scenario} triangles`).toBeLessThanOrEqual(BUDGET.triangles);
  }
});

test("rebuilding does not leak GPU resources", async ({ page }) => {
  await open(page, "balanced");
  const baseline = await info(page);

  // Cycle through every state and back. Textures are shared and pooled, so the
  // count has to return to where it started rather than climbing.
  for (const scenario of ["launch", "thriving", "struggling", "unavailable", "balanced"]) {
    await open(page, scenario);
  }

  const after = await info(page);
  expect(after.textures).toBeLessThanOrEqual(baseline.textures);
  expect(after.geometries).toBeLessThanOrEqual(Math.ceil(baseline.geometries * 1.05));
});

test("the shadow rig never moves while the camera does", async ({ page }) => {
  await open(page);

  const table = await page.evaluate(() => window.__city!.framingTable());
  const rigs: number[][] = [];

  for (const framing of table) {
    for (const zoom of [1, 0.7, 1.3]) {
      await page.evaluate(
        ([focus, height]) => window.__city!.frameAt(focus as [number, number, number], height as number, 6),
        [framing.focus, framing.height * zoom],
      );
      rigs.push(await page.evaluate(() => window.__city!.shadowRig()));
    }
  }

  // Sun position, sun target and the six shadow-camera planes must be identical
  // at every framing. Anything that varies here remaps every shadow texel to a
  // different patch of world and makes the whole map shimmer under a dolly.
  const distinct = new Set(rigs.map((rig) => rig.join("|")));
  expect(distinct.size, `shadow rig took ${distinct.size} states across the fly path`).toBe(1);
});
