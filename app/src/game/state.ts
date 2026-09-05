/**
 * The city simulation.
 *
 * Pure functions over a plain state object: no clock of its own, no storage, no
 * rendering. Time is passed in, so a session, a test and four hours of catching
 * up on return all run through exactly the same code.
 *
 * The boundary that matters: **none of this is the business.** The Whop reading
 * seeds the opening position — which plots start developed, and whether any
 * start derelict — and after that every credit, every building and every rank
 * is simulated and local. The reading is never changed by play, and nothing
 * here is ever presented as business performance.
 */

import type { DistrictId, PublicCityProjection, PublicDistrict } from "../city/projection";
import {
  BASE_CAPACITY,
  HARBOUR_DUE,
  DEPOT_RELIEF,
  DEPOT_RELIEF_FLOOR,
  MAX_OFFLINE_TICKS,
  STARTING_CREDITS,
  TRADE,
  WORK,
  demolitionRefund,
  rankFor,
  upgradeCost,
  type Trade,
  type Work,
} from "./catalog";

export type Plot = {
  readonly id: string;
  readonly district: DistrictId;
  /** 0 is bare ground. */
  readonly level: number;
  readonly trade: Trade | null;
  /**
   * Seeded derelict: standing, but producing nothing until it is repaired.
   *
   * This is how a district Whop reads as "not adding up" starts. It is a
   * setback the player inherits rather than causes, and it is cleared by
   * paying to put the plot right.
   */
  readonly derelict: boolean;
  /**
   * Why this plot is dark, if it is.
   *
   * `capacity` is derived fresh every tick: build the headroom and the lights
   * come straight back on. `funds` is sticky, and one plot at a time is
   * brought back only when the city can genuinely sustain it — otherwise a
   * broke city flickers, turning everything on the moment it can afford one
   * tick of it and off again immediately after.
   */
  readonly offline: null | "capacity" | "funds";
  /** Order the player developed it in. Keeps shutdowns deterministic. */
  readonly built: number;
};

export type CityEvent = {
  readonly at: number;
  readonly kind: "built" | "upgraded" | "cleared" | "repaired" | "shutdown" | "restored" | "rank" | "work";
  readonly text: string;
};

export type GameState = {
  readonly seed: string;
  readonly credits: number;
  readonly plots: readonly Plot[];
  readonly works: readonly Work[];
  /** Ticks simulated since the city was founded. */
  readonly ticks: number;
  /** Wall clock of the last tick, so time away can be caught up. */
  readonly lastTickAt: number;
  readonly events: readonly CityEvent[];
};

/** Everything derived from a state. Recomputed, never stored. */
export type Reading = {
  readonly capacitySupply: number;
  readonly capacityUsed: number;
  readonly footfallSupply: number;
  readonly footfallDemand: number;
  /** Credits produced by the city's own trades, at the current footfall. */
  readonly income: number;
  /** The standing due, collected whatever the city is doing. */
  readonly harbour: number;
  readonly upkeep: number;
  readonly net: number;
  readonly totalLevels: number;
  readonly developed: number;
  readonly overCapacity: boolean;
  readonly shortOfFootfall: boolean;
  /** Plots standing dark because the city could not pay for them. */
  readonly darkForFunds: number;
  readonly inArrears: boolean;
};

const EVENT_LIMIT = 24;

function note(state: GameState, kind: CityEvent["kind"], text: string): CityEvent[] {
  return [{ at: state.ticks, kind, text }, ...state.events].slice(0, EVENT_LIMIT);
}

// ---------------------------------------------------------------------------
// Opening position
// ---------------------------------------------------------------------------

/**
 * How a district's reading seeds its plots.
 *
 * The point is that the city you inherit is not the same city everyone else
 * inherits, and that a hard reading is a harder start rather than a smaller
 * one. It is a starting position, not a score: nothing here is read again
 * after the founding, and nothing the player does feeds back into it.
 */
function seedPlots(district: PublicDistrict, ids: readonly string[]): Plot[] {
  const unreadable = district.signal === "unreadable";
  const developed = unreadable ? 1 : Math.min(district.parcels, ids.length);
  const offset = ids.length === 0 ? 0 : district.variant % ids.length;
  const first = tradesOfDistrict(district.id)[0];

  return ids.map((id, index) => {
    const slot = (index - offset + ids.length) % ids.length;
    const seeded = slot < developed;
    if (!seeded) {
      return { id, district: district.id, level: 0, trade: null, derelict: false, offline: null, built: 0 };
    }

    // A reading of "not adding up" hands over something standing but dead.
    // "Steady" hands over a going concern. Anything else, a modest start.
    const derelict = !unreadable && district.state === "struggling";
    const level = unreadable ? 1 : district.state === "healthy" ? 2 : 1;

    return {
      id,
      district: district.id,
      level,
      trade: first,
      derelict,
      offline: null,
      built: slot + 1,
    };
  });
}

function tradesOfDistrict(district: DistrictId): Trade[] {
  return (Object.keys(TRADE) as Trade[]).filter((trade) => TRADE[trade].district === district);
}

export function foundCity(
  projection: PublicCityProjection,
  plotIds: Record<DistrictId, readonly string[]>,
  now: number,
): GameState {
  const plots = projection.districts.flatMap((district) =>
    seedPlots(district, plotIds[district.id] ?? []),
  );

  const derelict = plots.filter((plot) => plot.derelict).length;
  const events: CityEvent[] = [
    {
      at: 0,
      kind: "rank",
      text:
        derelict > 0
          ? "The city is founded. Some of what you inherited is standing but dead — repair it, or clear it."
          : "The city is founded. Build something that brings people in, then something that sells to them.",
    },
  ];

  return {
    seed: projection.seed,
    credits: STARTING_CREDITS,
    plots,
    works: [],
    ticks: 0,
    lastTickAt: now,
    events,
  };
}

// ---------------------------------------------------------------------------
// Reading the city
// ---------------------------------------------------------------------------

function worksMultiplier(works: readonly Work[], key: keyof typeof WORK.latetrading.effect): number {
  let total = 1;
  for (const work of works) total += WORK[work].effect[key] ?? 0;
  return total;
}

/** A plot contributes nothing, and costs nothing, while it is dark. */
function running(plot: Plot): boolean {
  return plot.level > 0 && plot.trade !== null && !plot.derelict && plot.offline === null;
}

export function read(state: GameState): Reading {
  const works = state.works;
  let capacitySupply = BASE_CAPACITY;
  let capacityUsed = 0;
  let footfallSupply = 0;
  let footfallDemand = 0;
  let grossCredits = 0;
  let upkeep = 0;
  let depotLevels = 0;
  let totalLevels = 0;
  let developed = 0;
  let darkForFunds = 0;

  for (const plot of state.plots) {
    totalLevels += plot.level;
    if (plot.level > 0) developed += 1;
    if (plot.offline === "funds") darkForFunds += 1;
    if (!plot.trade || plot.level === 0) continue;

    if (!running(plot)) continue;

    // A dark plot occupies nothing and costs nothing. Anything else and
    // shutting a plot down could never relieve the thing that shut it down.
    const spec = TRADE[plot.trade];
    capacityUsed += spec.load * plot.level;
    upkeep += spec.upkeep * plot.level;
    capacitySupply += spec.capacity * plot.level;
    footfallSupply += spec.footfall * plot.level;
    footfallDemand += spec.draw * plot.level;
    grossCredits += spec.credits * plot.level;
    if (plot.trade === "depot") depotLevels += plot.level;
  }

  capacitySupply = Math.round(capacitySupply * worksMultiplier(works, "capacity"));
  footfallSupply = Math.round(footfallSupply * worksMultiplier(works, "footfall"));

  // Short of footfall, the shops still open — they just take less.
  const served = footfallDemand === 0 ? 1 : Math.min(1, footfallSupply / footfallDemand);
  const income = Math.round(grossCredits * served * worksMultiplier(works, "credits") * 10) / 10;

  const relief = Math.max(DEPOT_RELIEF_FLOOR, 1 - depotLevels * DEPOT_RELIEF);
  const paid = Math.round(upkeep * relief * worksMultiplier(works, "upkeep") * 10) / 10;

  return {
    capacitySupply,
    capacityUsed,
    footfallSupply,
    footfallDemand,
    income,
    harbour: HARBOUR_DUE,
    upkeep: paid,
    net: Math.round((income + HARBOUR_DUE - paid) * 10) / 10,
    totalLevels,
    developed,
    overCapacity: capacityUsed > capacitySupply,
    shortOfFootfall: footfallDemand > footfallSupply,
    // Derived rather than counted: the city is in trouble exactly while
    // something is standing dark for want of money, which is also the thing
    // the player can see and act on.
    darkForFunds,
    inArrears: darkForFunds > 0,
  };
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/**
 * Work out which plots can actually run.
 *
 * Two rules, applied in order, one shutdown per tick from the second so the
 * player can see it happen and act:
 *
 *   capacity  the city cannot run more than it has headroom for. The newest
 *             plots go dark first — the ones just added are the ones most
 *             obviously undone — and a foundry brings them straight back.
 *
 *   funds     the city cannot spend money it does not have. The most expensive
 *             thing running stops, which is usually the thing that caused it.
 *             It comes back only when the city can sustain it, one at a time.
 */
function settle(state: GameState): { plots: Plot[]; darkened: Plot | null; lit: Plot | null } {
  // Capacity shutdowns are re-derived; money shutdowns are sticky.
  let plots: Plot[] = state.plots.map((plot) => ({
    ...plot,
    offline: plot.offline === "funds" ? "funds" : null,
  }));

  const standing = (list: Plot[]) =>
    list.filter((plot) => plot.level > 0 && plot.trade !== null && !plot.derelict);

  // --- capacity, newest first ------------------------------------------------
  for (let guard = 0; guard < plots.length; guard++) {
    if (!read({ ...state, plots }).overCapacity) break;
    const candidate = standing(plots)
      .filter((plot) => plot.offline === null && TRADE[plot.trade!].capacity === 0)
      .sort((a, b) => b.built - a.built)[0];
    if (!candidate) break;
    plots = plots.map((plot) => (plot.id === candidate.id ? { ...plot, offline: "capacity" as const } : plot));
  }

  // --- money -----------------------------------------------------------------
  const reading = read({ ...state, plots });
  let darkened: Plot | null = null;
  let lit: Plot | null = null;

  if (reading.net < 0 && state.credits + reading.net < 0) {
    const costliest = standing(plots)
      .filter((plot) => plot.offline === null && TRADE[plot.trade!].upkeep > 0)
      .sort((a, b) => TRADE[b.trade!].upkeep * b.level - TRADE[a.trade!].upkeep * a.level)[0];
    if (costliest) {
      darkened = costliest;
      plots = plots.map((plot) => (plot.id === costliest.id ? { ...plot, offline: "funds" as const } : plot));
    }
  } else {
    // Room to breathe: try one plot back on, oldest first, and only if the
    // city stays solvent with it running.
    const waiting = standing(plots)
      .filter((plot) => plot.offline === "funds")
      .sort((a, b) => a.built - b.built)[0];
    if (waiting) {
      const trial = plots.map((plot) => (plot.id === waiting.id ? { ...plot, offline: null } : plot));
      const after = read({ ...state, plots: trial });
      if (!after.overCapacity && after.net >= 0) {
        lit = waiting;
        plots = trial;
      }
    }
  }

  return { plots, darkened, lit };
}

export type TickOutcome = {
  readonly state: GameState;
  /** Credits earned across the whole span, for a summary on return. */
  readonly earned: number;
  readonly ticks: number;
};

/**
 * Run the city forward.
 *
 * Deterministic and side-effect free: the same state and the same number of
 * ticks always give the same city back. That is what makes the economy
 * testable and what makes catching up on return honest — it is the same
 * arithmetic that would have run had the tab stayed open.
 */
export function advance(state: GameState, ticks: number, now: number): TickOutcome {
  const steps = Math.max(0, Math.min(Math.floor(ticks), MAX_OFFLINE_TICKS));
  if (steps === 0) return { state: { ...state, lastTickAt: now }, earned: 0, ticks: 0 };

  let current = state;
  let earned = 0;

  for (let step = 0; step < steps; step++) {
    const { plots, darkened, lit } = settle(current);
    current = { ...current, plots };

    const reading = read(current);
    const credits = Math.max(0, Math.round((current.credits + reading.net) * 10) / 10);
    earned += Math.max(0, reading.net);

    let events = current.events;
    if (darkened) {
      events = [
        {
          at: current.ticks,
          kind: "shutdown" as const,
          text: `${TRADE[darkened.trade!].name} went dark — the city could not cover its upkeep.`,
        },
        ...events,
      ].slice(0, EVENT_LIMIT);
    }
    if (lit) {
      events = [
        { at: current.ticks, kind: "restored" as const, text: `${TRADE[lit.trade!].name} is running again.` },
        ...events,
      ].slice(0, EVENT_LIMIT);
    }

    current = { ...current, credits, events, ticks: current.ticks + 1 };
  }

  return { state: { ...current, lastTickAt: now }, earned: Math.round(earned * 10) / 10, ticks: steps };
}

/** How many whole ticks are owed since the last one ran. */
export function ticksDue(state: GameState, now: number): number {
  return Math.max(0, Math.floor((now - state.lastTickAt) / 5_000));
}

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------

export type ActionResult = { ok: true; state: GameState } | { ok: false; why: string };

function plotOf(state: GameState, id: string): Plot | null {
  return state.plots.find((plot) => plot.id === id) ?? null;
}

function withPlot(state: GameState, id: string, next: Partial<Plot>): Plot[] {
  return state.plots.map((plot) => (plot.id === id ? { ...plot, ...next } : plot));
}

export function canAfford(state: GameState, cost: number): boolean {
  return state.credits >= cost;
}

/** Raise a plot by one level, choosing its trade the first time. */
export function build(state: GameState, id: string, trade: Trade): ActionResult {
  const plot = plotOf(state, id);
  if (!plot) return { ok: false, why: "No such plot." };
  if (plot.derelict) return { ok: false, why: "This plot has to be repaired first." };
  if (TRADE[trade].district !== plot.district) return { ok: false, why: "Not a trade for this district." };

  if (plot.level > 0 && plot.trade !== trade) return { ok: false, why: "Clear the plot to change its trade." };

  const rank = rankFor(read(state).totalLevels);
  if (TRADE[trade].unlockAt > rank.level) return { ok: false, why: `${TRADE[trade].name} unlocks later.` };
  if (plot.level >= rank.levelCap) {
    return { ok: false, why: `A ${rank.name} builds no higher than level ${rank.levelCap}.` };
  }

  const cost = upgradeCost(trade, plot.level);
  if (!canAfford(state, cost)) return { ok: false, why: `Needs ${cost} credits.` };

  const level = plot.level + 1;
  const built = plot.built || Math.max(0, ...state.plots.map((entry) => entry.built)) + 1;
  const next: GameState = {
    ...state,
    credits: Math.round((state.credits - cost) * 10) / 10,
    plots: withPlot(state, id, { level, trade, built, offline: null }),
  };

  return {
    ok: true,
    state: {
      ...next,
      events: note(
        next,
        plot.level === 0 ? "built" : "upgraded",
        plot.level === 0
          ? `${TRADE[trade].name} opened.`
          : `${TRADE[trade].name} raised to level ${level}.`,
      ),
    },
  };
}

/** Put a derelict plot right. Cheaper than building it from nothing. */
export function repair(state: GameState, id: string): ActionResult {
  const plot = plotOf(state, id);
  if (!plot) return { ok: false, why: "No such plot." };
  if (!plot.derelict) return { ok: false, why: "Nothing to repair here." };

  const cost = Math.round(upgradeCost(plot.trade ?? "market", 0) * 0.6);
  if (!canAfford(state, cost)) return { ok: false, why: `Needs ${cost} credits.` };

  const next: GameState = {
    ...state,
    credits: Math.round((state.credits - cost) * 10) / 10,
    plots: withPlot(state, id, { derelict: false, offline: null }),
  };
  return { ok: true, state: { ...next, events: note(next, "repaired", "A dead plot is working again.") } };
}

/** Clear a plot back to ground, for some of the money back. */
export function clear(state: GameState, id: string): ActionResult {
  const plot = plotOf(state, id);
  if (!plot) return { ok: false, why: "No such plot." };
  if (plot.level === 0) return { ok: false, why: "Already bare ground." };

  const refund = plot.trade ? demolitionRefund(plot.trade, plot.level) : 0;
  const next: GameState = {
    ...state,
    credits: Math.round((state.credits + refund) * 10) / 10,
    plots: withPlot(state, id, { level: 0, trade: null, derelict: false, offline: null, built: 0 }),
  };
  return {
    ok: true,
    state: { ...next, events: note(next, "cleared", `Plot cleared. ${refund} credits back.`) },
  };
}

export function buyWork(state: GameState, work: Work): ActionResult {
  if (state.works.includes(work)) return { ok: false, why: "Already built." };
  const rank = rankFor(read(state).totalLevels);
  if (WORK[work].unlockAt > rank.level) return { ok: false, why: `${WORK[work].name} unlocks later.` };
  if (!canAfford(state, WORK[work].cost)) return { ok: false, why: `Needs ${WORK[work].cost} credits.` };

  const next: GameState = {
    ...state,
    credits: Math.round((state.credits - WORK[work].cost) * 10) / 10,
    works: [...state.works, work],
  };
  return { ok: true, state: { ...next, events: note(next, "work", `${WORK[work].name} built.`) } };
}
