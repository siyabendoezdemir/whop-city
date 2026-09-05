import { describe, expect, it } from "vitest";

import { ZERO_METRICS, type CityMetrics } from "../src/city/projection";
import {
  BUILDINGS,
  MAX_LEVEL,
  RESOURCES,
  buildingById,
  earnedLevel,
  nextTier,
  tierFor,
} from "../src/game/buildings";
import { claim, claimAll, changesSince, markSeen, newCity, readyCount, totalLevels, viewOf } from "../src/game/city";

/**
 * The one rule the whole game rests on: the city can never be further along
 * than the business is. Everything else here is arithmetic in service of that.
 */

const metrics = (over: Partial<CityMetrics> = {}): CityMetrics => ({
  ...ZERO_METRICS,
  source: "owner",
  ...over,
});

const city = () => newCity("a7f3c1e90b6d84fa", 0);
const grand = buildingById("core-landmark")!;

describe("the ladder is made of real numbers", () => {
  it("gives every building five rungs that only go up", () => {
    for (const building of BUILDINGS) {
      expect(building.ladder).toHaveLength(MAX_LEVEL);
      for (let step = 1; step < building.ladder.length; step++) {
        expect(building.ladder[step], `${building.id} rung ${step}`).toBeGreaterThan(
          building.ladder[step - 1],
        );
      }
      expect(RESOURCES).toContain(building.resource);
    }
  });

  it("puts the first rung within reach of a business that just opened", () => {
    // Nothing should be unreachable on day one across the whole city, or the
    // first session is a wall.
    const openable = BUILDINGS.filter((building) => building.ladder[0] <= 5);
    expect(openable.length).toBeGreaterThanOrEqual(BUILDINGS.length / 2);
  });

  it("spreads the city across more than one number", () => {
    // A business that only adds products should still see most of its city
    // standing still. That is the nudge.
    const used = new Set(BUILDINGS.map((building) => building.resource));
    expect(used.size).toBeGreaterThanOrEqual(4);
  });

  it("earns a level exactly when the business reaches the rung", () => {
    expect(earnedLevel(grand, metrics({ customers: 0 }))).toBe(0);
    expect(earnedLevel(grand, metrics({ customers: grand.ladder[0] - 1 }))).toBe(0);
    expect(earnedLevel(grand, metrics({ customers: grand.ladder[0] }))).toBe(1);
    expect(earnedLevel(grand, metrics({ customers: grand.ladder[2] }))).toBe(3);
    expect(earnedLevel(grand, metrics({ customers: 9_999_999 }))).toBe(MAX_LEVEL);
  });
});

describe("a building reads its own progress", () => {
  it("says what it needs and how far off it is", () => {
    const view = viewOf(grand, city(), metrics({ customers: 4 }));
    expect(view.level).toBe(0);
    expect(view.need).toBe(grand.ladder[0]);
    expect(view.has).toBe(4);
    expect(view.short).toBe(Math.max(0, grand.ladder[0] - 4));
  });

  it("fills from the previous rung, not from zero", () => {
    // Halfway between rung one and rung two should read as halfway, not as
    // most of the way there because the bar started at nothing.
    const [one, two] = grand.ladder;
    const half = Math.round(one + (two - one) / 2);
    const state = claim(city(), grand.id, metrics({ customers: half }));
    const view = viewOf(grand, state, metrics({ customers: half }));
    expect(view.level).toBe(1);
    expect(view.progress).toBeGreaterThan(0.4);
    expect(view.progress).toBeLessThan(0.6);
  });

  it("is finished at the top and asks for nothing more", () => {
    let state = city();
    const rich = metrics({ customers: 9_999_999 });
    for (let step = 0; step < MAX_LEVEL; step++) state = claim(state, grand.id, rich);
    const view = viewOf(grand, state, rich);
    expect(view.maxed).toBe(true);
    expect(view.need).toBeNull();
    expect(view.ready).toBe(0);
    expect(view.progress).toBe(1);
  });
});

describe("claiming", () => {
  it("refuses a level the business has not earned", () => {
    const poor = metrics({ customers: 0 });
    expect(claim(city(), grand.id, poor).claimed[grand.id]).toBeUndefined();
    expect(totalLevels(claim(city(), grand.id, poor), poor)).toBe(0);
  });

  it("takes one level at a time, and only up to what was earned", () => {
    const enough = metrics({ customers: grand.ladder[1] });
    let state = claim(city(), grand.id, enough);
    expect(state.claimed[grand.id]).toBe(1);
    state = claim(state, grand.id, enough);
    expect(state.claimed[grand.id]).toBe(2);
    // Earned two, so the third is refused until the business moves again.
    state = claim(state, grand.id, enough);
    expect(state.claimed[grand.id]).toBe(2);
  });

  it("cannot be cheated by editing the save", () => {
    // A hand-edited level is capped by what the numbers back, everywhere it is
    // read — the claim map is not the source of truth, the business is.
    const forged = { ...city(), claimed: { [grand.id]: MAX_LEVEL } };
    const poor = metrics({ customers: 0 });
    expect(viewOf(grand, forged, poor).level).toBe(0);
    expect(totalLevels(forged, poor)).toBe(0);

    const earned = metrics({ customers: grand.ladder[0] });
    expect(viewOf(grand, forged, earned).level).toBe(1);
  });

  it("counts what is waiting, and can take it all at once", () => {
    const busy = metrics({ customers: 60, products: 4, waysToBuy: 4, affiliates: 3, bestRate: 22 });
    const waiting = readyCount(city(), busy);
    expect(waiting).toBeGreaterThan(0);

    const after = claimAll(city(), busy);
    expect(readyCount(after, busy)).toBe(0);
    expect(totalLevels(after, busy)).toBe(waiting);
  });

  it("holds nothing back when the business is empty", () => {
    expect(readyCount(city(), metrics())).toBe(0);
    expect(totalLevels(city(), metrics())).toBe(0);
  });
});

describe("the skyline grows with the city", () => {
  it("starts at the bottom and has somewhere to go", () => {
    expect(tierFor(0).name).toBe("Landing");
    expect(nextTier(0)).not.toBeNull();
    expect(tierFor(999).name).toBe("Metropolis");
    expect(nextTier(999)).toBeNull();
  });

  it("climbs only as levels are actually taken", () => {
    const huge = metrics({ customers: 9_999_999, products: 99, waysToBuy: 99, affiliates: 99, bestRate: 90 });
    // Earned but unclaimed is not a bigger city: you have to press the button.
    expect(tierFor(totalLevels(city(), huge)).level).toBe(1);
    expect(tierFor(totalLevels(claimAll(city(), huge), huge)).level).toBeGreaterThan(1);
  });
});

describe("coming back", () => {
  it("reports what moved in the business since you last looked", () => {
    const before = metrics({ customers: 3, products: 1 });
    const state = markSeen(city(), before, 1_000);
    const after = metrics({ customers: 9, products: 1, affiliates: 2 });

    const changes = changesSince(state, after);
    expect(changes).toContainEqual({ resource: "customers", from: 3, to: 9 });
    expect(changes).toContainEqual({ resource: "affiliates", from: 0, to: 2 });
    expect(changes.find((change) => change.resource === "products")).toBeUndefined();
  });

  it("says nothing on a first visit rather than inventing a baseline", () => {
    expect(changesSince(city(), metrics({ customers: 100 }))).toEqual([]);
  });
});

describe("the game holds no business data", () => {
  it("saves nothing but building ids and the levels taken", () => {
    const busy = metrics({ customers: 60, products: 4, waysToBuy: 4, affiliates: 3, bestRate: 22 });
    const state = markSeen(claimAll(city(), busy), busy, 1);
    const saved = JSON.stringify({ ...state, lastSeen: null });
    expect(saved).not.toMatch(/revenue|title|email|prod_|plan_|biz_/i);
    for (const key of Object.keys(state.claimed)) expect(buildingById(key)).not.toBeNull();
  });
});
