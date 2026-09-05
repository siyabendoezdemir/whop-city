/**
 * What can be built, what it costs, and what it does.
 *
 * All the numbers of the game live here so balancing is one file rather than a
 * hunt. Nothing in this module knows about React, Three, or Whop.
 *
 * The shape of the economy, which is the reason the districts matter:
 *
 *   Creator Quarter makes **footfall**   — people coming to the city
 *   Commerce Core   spends footfall for **credits**
 *   Offer Forge     supplies **capacity** — the headroom everything else runs in
 *
 * So a city of nothing but shops starves for want of anyone to sell to, a city
 * of nothing but stages earns nothing, and a city that overbuilds either runs
 * out of capacity and starts going dark. You cannot win by building one thing.
 *
 * Credits are the only stock. Footfall and capacity are rates, shown as
 * supply against demand, because a gauge reads as a constraint and a number
 * reads as a score.
 */

import type { DistrictId } from "../city/projection";

export const TRADES = ["market", "arcade", "signal", "stage", "foundry", "depot"] as const;
export type Trade = (typeof TRADES)[number];

export const MAX_LEVEL = 3;

/**
 * Capacity the city has before anything is built.
 *
 * Deliberately tight: it covers a signal tower and a market hall and very
 * little else, so the third building is already a choice between another
 * earner and the foundry that would let you run it. Capacity has to bite in
 * the first minute or it is not a constraint, it is a formality.
 */
export const BASE_CAPACITY = 6;

/** Credits a new city starts with. Enough for two builds and a mistake. */
export const STARTING_CREDITS = 60;

/**
 * The harbour due: credits the city collects every tick whatever else happens.
 *
 * Small enough to be irrelevant to a working city, and the reason no city can
 * ever be permanently stuck. Without it a player who overbuilds, goes dark and
 * clears the wrong plot can end up short of the cheapest building with no way
 * of ever earning the difference, which is a dead end rather than a setback.
 */
export const HARBOUR_DUE = 1;

/** One tick of simulated time, in real milliseconds. */
export const TICK_MS = 5_000;

/**
 * How much time away is carried forward on return.
 *
 * Long enough that coming back tomorrow is worth it, short enough that the
 * city is never simply finished while nobody was looking.
 */
export const MAX_OFFLINE_TICKS = 2_880; // four hours

export type TradeSpec = {
  readonly id: Trade;
  readonly district: DistrictId;
  readonly name: string;
  /** One line, in the language of the city rather than of a spreadsheet. */
  readonly blurb: string;
  /** Credits to raise a plot to level 1 with this trade. */
  readonly cost: number;
  /** Per level: credits produced, before the footfall it needs is checked. */
  readonly credits: number;
  /** Per level: footfall produced. */
  readonly footfall: number;
  /** Per level: footfall required to run at full output. */
  readonly draw: number;
  /** Per level: capacity supplied. */
  readonly capacity: number;
  /** Per level: capacity occupied. */
  readonly load: number;
  /** Per level: credits per tick to keep running. */
  readonly upkeep: number;
  /** City level at which this becomes available. */
  readonly unlockAt: number;
};

export const TRADE: Record<Trade, TradeSpec> = {
  // ------------------------------------------------------------- Commerce
  market: {
    id: "market",
    district: "commerce-core",
    name: "Market hall",
    blurb: "Turns people passing through into takings. Steady, and cheap to run.",
    cost: 30,
    credits: 5,
    footfall: 0,
    draw: 3,
    capacity: 0,
    load: 3,
    upkeep: 1,
    unlockAt: 1,
  },
  arcade: {
    id: "arcade",
    district: "commerce-core",
    name: "Arcade",
    blurb: "Earns far more per head, and needs a crowd to do it. Expensive when quiet.",
    cost: 55,
    credits: 11,
    footfall: 0,
    draw: 8,
    capacity: 0,
    load: 5,
    upkeep: 4,
    unlockAt: 2,
  },

  // -------------------------------------------------------------- Creator
  signal: {
    id: "signal",
    district: "creator-quarter",
    name: "Signal tower",
    blurb: "Brings people in, steadily, for very little. The backbone of any crowd.",
    cost: 26,
    credits: 0,
    footfall: 4,
    draw: 0,
    capacity: 0,
    load: 2,
    upkeep: 1,
    unlockAt: 1,
  },
  stage: {
    id: "stage",
    district: "creator-quarter",
    name: "Stage",
    blurb: "Draws a far bigger crowd, and costs real money every tick to keep it there.",
    cost: 50,
    credits: 0,
    footfall: 10,
    draw: 0,
    capacity: 0,
    load: 4,
    upkeep: 5,
    unlockAt: 2,
  },

  // ---------------------------------------------------------------- Forge
  foundry: {
    id: "foundry",
    district: "offer-forge",
    name: "Foundry",
    blurb: "Makes the headroom everything else runs in. Heavy, and worth it.",
    cost: 34,
    credits: 0,
    footfall: 0,
    draw: 0,
    capacity: 9,
    load: 0,
    upkeep: 2,
    unlockAt: 1,
  },
  depot: {
    id: "depot",
    district: "offer-forge",
    name: "Depot",
    blurb: "Less headroom than a foundry, but it takes a cut off the whole city's upkeep.",
    cost: 44,
    credits: 0,
    footfall: 0,
    draw: 0,
    capacity: 4,
    load: 0,
    upkeep: 1,
    unlockAt: 2,
  },
};

/** Depots shave upkeep off the whole city. Per depot level, as a fraction. */
export const DEPOT_RELIEF = 0.06;
/** However many depots are built, upkeep never falls below this fraction. */
export const DEPOT_RELIEF_FLOOR = 0.55;

/**
 * Cost to take a plot from `level` to `level + 1`.
 *
 * Steep enough that a third level is a decision rather than a formality.
 */
export function upgradeCost(trade: Trade, level: number): number {
  return Math.round(TRADE[trade].cost * (level === 0 ? 1 : level === 1 ? 1.9 : 3.4));
}

/** What comes back when a plot is cleared. Never all of it. */
export function demolitionRefund(trade: Trade, level: number): number {
  let spent = 0;
  for (let step = 0; step < level; step++) spent += upgradeCost(trade, step);
  return Math.floor(spent * 0.4);
}

// ---------------------------------------------------------------------------
// Progression
// ---------------------------------------------------------------------------

export type CityRank = {
  readonly level: number;
  readonly name: string;
  /** Total plot levels across the city needed to reach this rank. */
  readonly at: number;
  /** What arriving here opens up, in one line. */
  readonly unlocks: string;
  /** The highest level any plot may be raised to at this rank. */
  readonly levelCap: number;
};

export const RANKS: readonly CityRank[] = [
  { level: 1, name: "Landing", at: 0, unlocks: "Market halls, signal towers and foundries.", levelCap: 1 },
  { level: 2, name: "Township", at: 5, unlocks: "Second storeys, arcades, stages and depots.", levelCap: 2 },
  { level: 3, name: "Borough", at: 12, unlocks: "Third storeys, and the first civic works.", levelCap: 3 },
  { level: 4, name: "Metropolis", at: 22, unlocks: "Every civic work the city can hold.", levelCap: 3 },
];

export function rankFor(totalLevels: number): CityRank {
  let rank = RANKS[0];
  for (const candidate of RANKS) if (totalLevels >= candidate.at) rank = candidate;
  return rank;
}

export function nextRank(totalLevels: number): CityRank | null {
  return RANKS.find((rank) => rank.at > totalLevels) ?? null;
}

// ---------------------------------------------------------------------------
// Civic works — the city-wide upgrades a Borough can afford
// ---------------------------------------------------------------------------

export const WORKS = ["latetrading", "shiftwork", "festival"] as const;
export type Work = (typeof WORKS)[number];

export type WorkSpec = {
  readonly id: Work;
  readonly name: string;
  readonly blurb: string;
  readonly cost: number;
  readonly unlockAt: number;
  /** Applied to the whole city, once bought. */
  readonly effect: { credits?: number; footfall?: number; capacity?: number; upkeep?: number };
};

export const WORK: Record<Work, WorkSpec> = {
  latetrading: {
    id: "latetrading",
    name: "Late trading",
    blurb: "Shops stay open. A fifth again on takings, and the lights cost something.",
    cost: 180,
    unlockAt: 3,
    effect: { credits: 0.2, upkeep: 0.12 },
  },
  shiftwork: {
    id: "shiftwork",
    name: "Shift work",
    blurb: "The forge runs through the night. A quarter more headroom across the city.",
    cost: 220,
    unlockAt: 3,
    effect: { capacity: 0.25 },
  },
  festival: {
    id: "festival",
    name: "Standing festival",
    blurb: "The quarter never quite packs up. A third again on footfall, and it is not free.",
    cost: 300,
    unlockAt: 4,
    effect: { footfall: 0.33, upkeep: 0.1 },
  },
};

/** Every trade a district can run, in the order they unlock. */
export function tradesOf(district: DistrictId): TradeSpec[] {
  return TRADES.map((trade) => TRADE[trade])
    .filter((spec) => spec.district === district)
    .sort((a, b) => a.unlockAt - b.unlockAt);
}
