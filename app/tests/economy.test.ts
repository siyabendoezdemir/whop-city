import { describe, expect, it } from "vitest";

import { DISTRICT_IDS, type DistrictState, type PublicCityProjection } from "../src/city/projection";
import type { Trade } from "../src/game/catalog";
import {
  BASE_CAPACITY,
  HARBOUR_DUE,
  MAX_OFFLINE_TICKS,
  RANKS,
  STARTING_CREDITS,
  TRADE,
  rankFor,
  upgradeCost,
} from "../src/game/catalog";
import {
  advance,
  build,
  buyWork,
  clear,
  foundCity,
  read,
  repair,
  ticksDue,
  type GameState,
} from "../src/game/state";

/**
 * The economy, on its own.
 *
 * Every rule the player is asked to reason about is asserted here rather than
 * through the interface: a city that quietly stops obeying its own arithmetic
 * is not a game, and no amount of button-clicking tests would notice.
 */

const PLOTS = {
  "commerce-core": ["core-a", "core-b", "core-c", "core-d"],
  "offer-forge": ["forge-a", "forge-b", "forge-c"],
  "creator-quarter": ["creator-a", "creator-b", "creator-c", "creator-d"],
} as const;

function projection(states: Partial<Record<(typeof DISTRICT_IDS)[number], DistrictState>> = {}, parcels = 0): PublicCityProjection {
  return {
    schema: "whop-city.public.v2",
    freshness: "live",
    seed: "a7f3c1e90b6d84fa",
    districts: DISTRICT_IDS.map((id) => ({
      id,
      state: states[id] ?? "dormant",
      direction: "steady",
      signal: "quiet",
      parcels,
      variant: 0,
    })),
  };
}

const found = (states = {}, parcels = 0) => foundCity(projection(states, parcels), PLOTS, 0);

/** Force credits, so a test can set up a position without playing to it. */
const rich = (state: GameState, credits = 5_000): GameState => ({ ...state, credits });

type Placement = [id: string, trade: Trade, level: number];

/**
 * Put a city directly into a position.
 *
 * Setting plots rather than playing to them: several of these positions are
 * behind rank gates that are themselves under test, and reaching them by
 * legitimate play would make the arrangement of the test the thing being
 * asserted rather than the rule.
 */
function city(placements: Placement[], credits = 5_000): GameState {
  const base = found();
  let order = 0;
  const plots = base.plots.map((plot) => {
    const placed = placements.find(([id]) => id === plot.id);
    if (!placed) return { ...plot, level: 0, trade: null, derelict: false, offline: null, built: 0 };
    order += 1;
    return { ...plot, level: placed[2], trade: placed[1], derelict: false, offline: null, built: order };
  });
  return { ...base, credits, plots };
}

/** Unwrap an action, failing the test with the game's own reason. */
function must(result: ReturnType<typeof build>): GameState {
  if (!result.ok) throw new Error(result.why);
  return result.state;
}

/** Build a plot up to `level` through the real rules. */
function raise(state: GameState, id: string, trade: Trade, level: number): GameState {
  let current = rich(state);
  for (let step = 0; step < level; step++) {
    const result = build(current, id, trade);
    if (!result.ok) throw new Error(`${id} -> ${level}: ${result.why}`);
    current = result.state;
  }
  return { ...current, credits: state.credits };
}

describe("founding", () => {
  it("starts an unread business a playable city rather than nothing", () => {
    // City must work without any private capability, and an unreadable
    // projection is the case where the least is known.
    const dark = projection();
    const unreadable: PublicCityProjection = {
      ...dark,
      freshness: "unavailable",
      districts: dark.districts.map((district) => ({ ...district, signal: "unreadable" as const })),
    };
    const state = foundCity(unreadable, PLOTS, 0);
    expect(state.credits).toBe(STARTING_CREDITS);
    expect(state.plots.filter((plot) => plot.level > 0)).toHaveLength(3);
    expect(state.plots.some((plot) => plot.derelict)).toBe(false);
  });

  it("hands a hard reading a harder city, not a smaller one", () => {
    const struggling = found({ "commerce-core": "struggling" }, 2);
    const core = struggling.plots.filter((plot) => plot.district === "commerce-core");
    expect(core.filter((plot) => plot.derelict)).toHaveLength(2);
    // Derelict plots stand there producing nothing until they are put right.
    expect(read(struggling).income).toBe(0);
  });

  it("hands a steady reading a going concern", () => {
    const healthy = found({ "creator-quarter": "healthy" }, 2);
    const quarter = healthy.plots.filter((plot) => plot.district === "creator-quarter");
    expect(quarter.filter((plot) => plot.level === 2)).toHaveLength(2);
    expect(read(healthy).footfallSupply).toBeGreaterThan(0);
  });

  it("never seeds more plots than the district has", () => {
    const state = found({}, 99);
    for (const district of DISTRICT_IDS) {
      const owned = state.plots.filter((plot) => plot.district === district);
      expect(owned).toHaveLength(PLOTS[district].length);
    }
  });
});

describe("the three resources hold each other up", () => {
  it("a city of shops and nobody to sell to earns nothing", () => {
    const state = must(build(rich(found()), "core-a", "market"));
    const reading = read(state);
    expect(reading.footfallDemand).toBeGreaterThan(0);
    expect(reading.footfallSupply).toBe(0);
    expect(reading.shortOfFootfall).toBe(true);
    expect(reading.income).toBe(0);
  });

  it("collects the harbour due whatever it is doing, so it can never be stuck", () => {
    const empty = read(found());
    expect(empty.income).toBe(0);
    expect(empty.harbour).toBe(HARBOUR_DUE);
    expect(empty.net).toBe(HARBOUR_DUE);
  });

  it("a city of crowds and nothing to sell earns nothing either", () => {
    const state = must(build(rich(found()), "creator-a", "signal"));
    const reading = read(state);
    expect(reading.footfallSupply).toBeGreaterThan(0);
    expect(reading.income).toBe(0);
  });

  it("pairs them and the city earns", () => {
    const state = must(build(must(build(rich(found()), "creator-a", "signal")), "core-a", "market"));
    const reading = read(state);
    expect(reading.shortOfFootfall).toBe(false);
    expect(reading.income).toBeGreaterThan(0);
    expect(reading.net).toBeGreaterThan(reading.harbour);
  });

  it("serves a partial crowd partially, rather than all or nothing", () => {
    // One signal (4 footfall) against an arcade (8 draw) is exactly half fed.
    const reading = read(city([["creator-a", "signal", 1], ["core-a", "arcade", 1], ["forge-a", "foundry", 1]]));
    expect(reading.footfallSupply).toBe(4);
    expect(reading.footfallDemand).toBe(8);
    expect(reading.income).toBeCloseTo(TRADE.arcade.credits * 0.5, 1);
  });
});

describe("capacity is a real ceiling", () => {
  it("starts with headroom for a first move and no more", () => {
    expect(read(found()).capacitySupply).toBe(BASE_CAPACITY);
  });

  it("shuts the newest plots down when the city outgrows its headroom", () => {
    let state = rich(found());
    for (const id of ["creator-a", "creator-b", "creator-c"]) {
      state = raise(state, id, "signal", 1);
      state = rich(state);
    }
    // Three signals want six capacity, which is exactly the base. A fourth
    // pushes past it, and the city has built no foundry to cover it.
    state = raise(state, "creator-d", "signal", 1);
    state = rich(state);
    const after = advance(state, 1, 0).state;

    expect(read(after).capacityUsed).toBeLessThanOrEqual(read(after).capacitySupply);
    const dark = after.plots.filter((plot) => plot.offline !== null);
    expect(dark).toHaveLength(1);
    // The newest one, so the fix is obvious.
    expect(dark[0].id).toBe("creator-d");
    expect(dark[0].offline).toBe("capacity");
  });

  it("a foundry buys the headroom back and the lights come on", () => {
    let state = rich(found());
    for (const id of ["creator-a", "creator-b", "creator-c", "creator-d"]) {
      state = raise(state, id, "signal", 1);
      state = rich(state);
    }
    state = advance(state, 1, 0).state;
    expect(state.plots.some((plot) => plot.offline !== null)).toBe(true);

    state = raise(rich(state), "forge-a", "foundry", 1);
    state = advance(rich(state), 1, 0).state;
    expect(state.plots.some((plot) => plot.offline !== null)).toBe(false);
  });

  it("never shuts down the thing that supplies the headroom", () => {
    let state = rich(found());
    state = raise(state, "forge-a", "foundry", 1);
    for (const id of ["creator-a", "creator-b", "creator-c", "creator-d"]) {
      state = raise(rich(state), id, "signal", 1);
    }
    state = advance(rich(state), 3, 0).state;
    const foundry = state.plots.find((plot) => plot.id === "forge-a")!;
    expect(foundry.offline).toBeNull();
  });
});

describe("running out of money is a setback you can read and undo", () => {
  // A stage costs five credits a tick and brings a crowd nothing is selling to.
  const brokeCity = () => city([["forge-a", "foundry", 1], ["creator-a", "stage", 1]], 3);

  it("takes the most expensive thing offline rather than going negative", () => {
    const after = advance(brokeCity(), 4, 0).state;
    expect(after.credits).toBeGreaterThanOrEqual(0);
    expect(read(after).inArrears).toBe(true);
    expect(after.plots.find((plot) => plot.trade === "stage")!.offline).toBe("funds");
    expect(after.events.some((event) => event.kind === "shutdown")).toBe(true);
  });

  it("stops shutting things down once the books balance", () => {
    let state = advance(brokeCity(), 6, 0).state;
    const dark = state.plots.filter((plot) => plot.offline !== null).length;
    state = advance(state, 10, 0).state;
    // Nothing further goes dark once income covers what is left running.
    expect(state.plots.filter((plot) => plot.offline !== null).length).toBe(dark);
  });

  it("can be dug out of: clear the cause, build an earner, and the city recovers", () => {
    let state = advance(brokeCity(), 4, 0).state;
    expect(read(state).inArrears).toBe(true);

    // Clearing the stage gets some money back, but the foundry is still dark
    // and the city is still earning nothing — not out of trouble yet.
    const stage = state.plots.find((plot) => plot.trade === "stage")!;
    const cleared = clear(state, stage.id);
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(read(cleared.state).income).toBe(0);
    expect(read(cleared.state).inArrears).toBe(true);

    // The harbour due keeps coming in, so waiting is always a way back — slow,
    // but never a dead end. Clearing the dark foundry for its refund is the
    // faster route, and the player has both.
    const waited = advance(cleared.state, 60, 0).state;
    expect(waited.credits).toBeGreaterThan(cleared.state.credits);

    // Pairing a crowd with somewhere to spend gets it out properly.
    const recovering = build(waited, "creator-a", "signal");
    expect(recovering.ok).toBe(true);
    if (!recovering.ok) return;
    const earner = build(recovering.state, "core-a", "market");
    expect(earner.ok).toBe(true);
    if (!earner.ok) return;

    state = advance(earner.state, 12, 0).state;
    expect(read(state).net).toBeGreaterThan(0);
    expect(read(state).inArrears).toBe(false);
    expect(state.credits).toBeGreaterThan(0);
    // And the lights come back on by themselves once it can sustain them.
    expect(state.events.some((event) => event.kind === "restored")).toBe(true);
  });

  it("credits never go negative, however long it runs", () => {
    const after = advance(brokeCity(), 500, 0).state;
    expect(after.credits).toBeGreaterThanOrEqual(0);
  });
});

describe("building", () => {
  it("costs what the catalogue says and takes it from the balance", () => {
    const state = found();
    const before = state.credits;
    const result = build(state, "core-a", "market");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.credits).toBe(before - upgradeCost("market", 0));
  });

  it("refuses what cannot be paid for, and says the number", () => {
    const broke = { ...found(), credits: 1 };
    const result = build(broke, "core-a", "market");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.why).toMatch(/\d+ credits/);
  });

  it("refuses a trade that belongs to another district", () => {
    const result = build(rich(found()), "core-a", "foundry");
    expect(result.ok).toBe(false);
  });

  it("refuses to change a plot's trade without clearing it", () => {
    const state = city([["core-a", "market", 1]]);
    const result = build(state, "core-a", "arcade");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.why).toMatch(/clear/i);
  });

  it("gives back some of what was spent when a plot is cleared, never all", () => {
    const state = raise(rich(found()), "core-a", "market", 1);
    const spent = upgradeCost("market", 0);
    const cleared = clear(state, "core-a");
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    const back = cleared.state.credits - state.credits;
    expect(back).toBeGreaterThan(0);
    expect(back).toBeLessThan(spent);
    expect(cleared.state.plots.find((plot) => plot.id === "core-a")!.level).toBe(0);
  });

  it("repairs a derelict plot for less than rebuilding it", () => {
    const state = rich(found({ "commerce-core": "struggling" }, 1));
    const derelict = state.plots.find((plot) => plot.derelict)!;
    expect(build(state, derelict.id, "market").ok).toBe(false);

    const fixed = repair(state, derelict.id);
    expect(fixed.ok).toBe(true);
    if (!fixed.ok) return;
    expect(state.credits - fixed.state.credits).toBeLessThan(upgradeCost("market", 0));
    expect(fixed.state.plots.find((plot) => plot.id === derelict.id)!.derelict).toBe(false);
  });
});

describe("progression opens the city up", () => {
  it("locks the later trades behind a rank", () => {
    const state = rich(found());
    expect(read(state).totalLevels).toBeLessThan(RANKS[1].at);
    const early = build(state, "core-a", "arcade");
    expect(early.ok).toBe(false);
    if (early.ok) return;
    expect(early.why).toMatch(/unlocks later/i);
  });

  it("caps how high a plot can go until the city grows", () => {
    const state = raise(rich(found()), "core-a", "market", 1);
    const second = build(rich(state), "core-a", "market");
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.why).toMatch(/level 1/);
  });

  it("raises the cap and unlocks the trades as the city grows", () => {
    const state = city([
      ["core-a", "market", 1],
      ["core-b", "market", 1],
      ["creator-a", "signal", 1],
      ["creator-b", "signal", 1],
      ["forge-a", "foundry", 1],
    ]);
    const rank = rankFor(read(state).totalLevels);
    expect(rank.level).toBeGreaterThanOrEqual(2);
    expect(rank.levelCap).toBeGreaterThanOrEqual(2);
    expect(build(rich(state), "core-c", "arcade").ok).toBe(true);
  });

  it("gates civic works behind a rank and charges for them", () => {
    const early = buyWork(rich(found()), "latetrading");
    expect(early.ok).toBe(false);

    // A Borough can buy them; the effect shows up in the reading.
    let state = rich(found({ "commerce-core": "healthy", "creator-quarter": "healthy", "offer-forge": "healthy" }, 4));
    expect(rankFor(read(state).totalLevels).level).toBeGreaterThanOrEqual(3);
    const before = read(state).capacitySupply;
    const bought = buyWork(state, "shiftwork");
    expect(bought.ok).toBe(true);
    if (!bought.ok) return;
    expect(read(bought.state).capacitySupply).toBeGreaterThan(before);
    expect(buyWork(bought.state, "shiftwork").ok).toBe(false);
  });
});

describe("time", () => {
  const working = () => city([["creator-a", "signal", 1], ["core-a", "market", 1]], 100);

  it("is deterministic: the same city and the same ticks give the same city", () => {
    const state = working();

    const a = advance(state, 40, 1_000).state;
    const b = advance(state, 40, 1_000).state;
    expect(a.credits).toBe(b.credits);
    expect(a.ticks).toBe(b.ticks);
    expect(a.plots).toEqual(b.plots);
  });

  it("catching up in one go matches having been there the whole time", () => {
    const state = working();

    let stepped = state;
    for (let i = 0; i < 30; i++) stepped = advance(stepped, 1, 0).state;
    const jumped = advance(state, 30, 0).state;
    expect(jumped.credits).toBe(stepped.credits);
  });

  it("caps how much time away is carried forward", () => {
    const state = rich(found());
    const outcome = advance(state, MAX_OFFLINE_TICKS * 10, 0);
    expect(outcome.ticks).toBe(MAX_OFFLINE_TICKS);
  });

  it("counts whole ticks owed since the last one", () => {
    const state = { ...found(), lastTickAt: 100_000 };
    expect(ticksDue(state, 100_000)).toBe(0);
    expect(ticksDue(state, 104_999)).toBe(0);
    expect(ticksDue(state, 117_500)).toBe(3);
    expect(ticksDue(state, 50_000)).toBe(0);
  });

  it("an empty city collects only the due, and never spends what it has not got", () => {
    const outcome = advance(found(), 100, 0);
    expect(outcome.state.credits).toBe(STARTING_CREDITS + 100 * HARBOUR_DUE);
    expect(read(outcome.state).income).toBe(0);
  });
});

describe("the simulation never claims to be the business", () => {
  it("holds no business data at all", () => {
    const state = raise(rich(found({ "commerce-core": "healthy" }, 2)), "core-c", "market", 1);
    const serialised = JSON.stringify(state);
    // The seed is the projection's opaque hex, which is already public.
    expect(serialised).not.toMatch(/revenue|customer|member|price|product|plan_|biz_/i);
  });

  it("cannot be changed by anything but the player's own moves", () => {
    // No function here takes a projection after founding: the reading seeds the
    // opening position and is never consulted again.
    const state = raise(rich(found()), "core-a", "market", 1);
    const later = advance(state, 100, 0).state;
    expect(later.plots.map((plot) => plot.id)).toEqual(state.plots.map((plot) => plot.id));
  });
});

