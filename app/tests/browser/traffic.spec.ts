import { expect, test } from "@playwright/test";

/**
 * Traffic and pedestrians, checked by stepping the clock rather than by
 * looking at a screenshot.
 *
 * A still cannot tell you whether a car turned the corner or was teleported
 * across the junction, and it certainly cannot tell you whether it switched
 * itself off halfway over the bridge — which is exactly what the first pass
 * did. These assertions are about continuity: everything that moves has to
 * stay on the map, keep going, and get back to where it started without a
 * single jump.
 */

const READY = { timeout: 180_000 };

async function open(page: import("@playwright/test").Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?scenario=thriving&ss=1&capture=1", { waitUntil: "load" });
  await page.waitForFunction(() => Boolean(window.__city?.ready), null, READY);
  await page.waitForFunction(() => (window.__city?.info().parcels ?? 0) > 0, null, READY);
}

/** Positions of everything on the terrain that moves, at time `t`. */
async function actorsAt(page: import("@playwright/test").Page, t: number) {
  return page.evaluate((time) => window.__city!.actors(time), t);
}

/** The same, sampled across a whole stretch of time in one round trip. */
async function track(page: import("@playwright/test").Page, until: number, step: number) {
  return page.evaluate(
    ([end, dt]) => {
      const frames: Array<Array<{ name: string; visible: boolean; x: number; y: number; z: number }>> =
        [];
      for (let t = 0; t <= end; t += dt) frames.push(window.__city!.actors(t));
      return frames;
    },
    [until, step] as const,
  );
}

test.describe("moving parts", () => {
  test("the streets are actually occupied", async ({ page }) => {
    await open(page);
    const actors = await actorsAt(page, 4);
    const vehicles = actors.filter((a) => a.name.startsWith("vehicle-"));
    const people = actors.filter((a) => a.name === "person");
    expect(vehicles.length).toBeGreaterThanOrEqual(8);
    expect(people.length).toBeGreaterThanOrEqual(4);
  });

  test("nothing is ever switched off to hide a hole in the road", async ({ page }) => {
    await open(page);
    for (const t of [0, 3, 9, 21, 44, 80]) {
      const actors = await actorsAt(page, t);
      const hidden = actors.filter((a) => !a.visible);
      expect(hidden, `hidden at t=${t}`).toEqual([]);
    }
  });

  test("nothing teleports", async ({ page }) => {
    await open(page);
    const frames = await track(page, 300, 0.25);
    let worst = 0;
    let worstName = "";
    for (let f = 1; f < frames.length; f++) {
      frames[f].forEach((actor, index) => {
        const before = frames[f - 1][index];
        const moved = Math.hypot(actor.x - before.x, actor.y - before.y, actor.z - before.z);
        if (moved > worst) {
          worst = moved;
          worstName = `${actor.name} at t=${(f * 0.25).toFixed(2)}`;
        }
      });
    }
    // A quarter second at the fastest authored speed is under three metres.
    // The old loop snapped back the length of a street, fifty times this, and
    // the ferry — which legitimately turns round — is not on this group.
    expect(worst, `worst jump was ${worstName}`).toBeLessThan(3.5);
  });

  test("traffic comes back round instead of running off the map", async ({ page }) => {
    await open(page);
    const frames = await track(page, 600, 2);
    let furthest = 0;
    for (const frame of frames) {
      for (const actor of frame) furthest = Math.max(furthest, Math.hypot(actor.x, actor.z));
    }
    // Everything stays inside the town and its ring road. A vehicle that
    // escaped down a highway would be hundreds of units out.
    expect(furthest).toBeLessThan(220);

    // And within ten minutes, everything has been back where it started.
    const start = frames[0];
    const home = start.map((s, index) =>
      frames.some((frame) => Math.hypot(frame[index].x - s.x, frame[index].z - s.z) < 4),
    );
    expect(home.filter(Boolean).length).toBe(start.length);
  });

  test("the bridge is driven over, not through", async ({ page }) => {
    await open(page);
    // The canal runs between x=32 and x=42 at the quay road, z=-84. Anything
    // on that carriageway has to be up on the deck.
    const frames = await track(page, 600, 0.5);
    let crossings = 0;
    let lowest = Infinity;
    for (const frame of frames) {
      for (const actor of frame) {
        if (!actor.name.startsWith("vehicle-")) continue;
        if (actor.x < 33 || actor.x > 41) continue;
        if (Math.abs(actor.z + 84) > 6) continue;
        crossings++;
        lowest = Math.min(lowest, actor.y);
      }
    }
    expect(crossings).toBeGreaterThan(0);
    expect(lowest).toBeGreaterThan(0.4);
  });
});
