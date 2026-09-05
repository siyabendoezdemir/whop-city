/**
 * The city, as a set of buildings you level up with your real business.
 *
 * There is no invented currency here and there is no simulated economy. A
 * building's next level costs a **real Whop number** — five customers, three
 * products, an affiliate programme at twenty percent — and the only way to pay
 * it is to actually go and grow the business. That is the whole game: the city
 * is the scoreboard and your Whop account is the controller.
 *
 * Eligibility is real and cannot be faked. Claiming an unlocked level is a
 * click, kept in this browser, so the moment of upgrading is yours to take
 * when you want it — the satisfying part of Clash of Clans is pressing the
 * button, not being told it happened.
 */

import type { CityMetrics } from "../city/projection";
import type { DistrictId } from "../city/projection";

/** The real numbers a building can be gated on. */
export const RESOURCES = ["customers", "products", "waysToBuy", "affiliates", "bestRate"] as const;
export type Resource = (typeof RESOURCES)[number];

export const RESOURCE: Record<Resource, { name: string; one: string; many: string; suffix?: string }> = {
  customers: { name: "Customers", one: "customer", many: "customers" },
  products: { name: "Products", one: "product", many: "products" },
  waysToBuy: { name: "Ways to buy", one: "plan", many: "plans" },
  affiliates: { name: "Affiliates", one: "affiliate offer", many: "affiliate offers" },
  bestRate: { name: "Commission", one: "percent", many: "percent", suffix: "%" },
};

export const MAX_LEVEL = 5;

export type Building = {
  readonly id: string;
  readonly district: DistrictId;
  readonly name: string;
  /** What this building is for, in one line, in the city's own language. */
  readonly role: string;
  readonly resource: Resource;
  /**
   * What the business must reach for each level, starting at level 1.
   *
   * Five rungs. The first is deliberately within reach of a business that has
   * just opened, so the city starts moving on day one, and the last is a real
   * milestone rather than a formality.
   */
  readonly ladder: readonly [number, number, number, number, number];
};

/**
 * Eleven buildings on the eleven authored parcels.
 *
 * Spread across four of the five resources on purpose: a business that only
 * adds products still watches most of its city stand still, which is the
 * nudge. Nothing here is gated on money — Whop reports what is on sale and who
 * holds it, and inventing a revenue figure from that would be a lie.
 */
export const BUILDINGS: readonly Building[] = [
  // ---------------------------------------------------- Commerce Core
  {
    id: "core-landmark",
    district: "commerce-core",
    name: "Grand Exchange",
    role: "The house your buyers walk into.",
    resource: "customers",
    ladder: [1, 10, 50, 250, 1000],
  },
  {
    id: "core-north",
    district: "commerce-core",
    name: "Trade Hall",
    role: "One floor for every thing you sell.",
    resource: "products",
    ladder: [1, 2, 4, 8, 16],
  },
  {
    id: "core-east",
    district: "commerce-core",
    name: "Merchant Row",
    role: "Shopfronts fill as the customers do.",
    resource: "customers",
    ladder: [3, 25, 100, 500, 2000],
  },
  {
    id: "core-southeast",
    district: "commerce-core",
    name: "Counting House",
    role: "Every way to pay you gets a window.",
    resource: "waysToBuy",
    ladder: [1, 2, 4, 8, 16],
  },

  // ------------------------------------------------------ Offer Forge
  {
    id: "forge-hero",
    district: "offer-forge",
    name: "The Mint",
    role: "Where a price becomes an offer.",
    resource: "waysToBuy",
    ladder: [1, 3, 6, 12, 24],
  },
  {
    id: "forge-north",
    district: "offer-forge",
    name: "Foundry",
    role: "Raises a chimney for every product on the line.",
    resource: "products",
    ladder: [1, 3, 6, 12, 24],
  },
  {
    id: "forge-south",
    district: "offer-forge",
    name: "The Vault",
    role: "It grows with the size of the book.",
    resource: "customers",
    ladder: [5, 50, 200, 800, 3000],
  },

  // -------------------------------------------------- Creator Quarter
  {
    id: "creator-park",
    district: "creator-quarter",
    name: "Signal Tower",
    role: "Reaches further for every affiliate carrying you.",
    resource: "affiliates",
    ladder: [1, 2, 4, 8, 16],
  },
  {
    id: "creator-terrace",
    district: "creator-quarter",
    name: "Commission House",
    role: "Stands as tall as the cut you pay.",
    resource: "bestRate",
    ladder: [5, 10, 20, 30, 50],
  },
  {
    id: "creator-venue",
    district: "creator-quarter",
    name: "Amphitheatre",
    role: "Fills up as the crowd does.",
    resource: "customers",
    ladder: [5, 40, 150, 600, 2500],
  },
  {
    id: "creator-struggling",
    district: "creator-quarter",
    name: "The Beacon",
    role: "Lit by everyone selling on your behalf.",
    resource: "affiliates",
    ladder: [1, 3, 6, 12, 24],
  },
];

export function buildingById(id: string): Building | null {
  return BUILDINGS.find((building) => building.id === id) ?? null;
}

export function buildingsIn(district: DistrictId): Building[] {
  return BUILDINGS.filter((building) => building.district === district);
}

/** What the business has of the thing this building runs on. */
export function have(metrics: CityMetrics, resource: Resource): number {
  return metrics[resource];
}

/** What the next level needs, or null when the building is finished. */
export function needFor(building: Building, level: number): number | null {
  return level >= MAX_LEVEL ? null : building.ladder[level];
}

/**
 * The highest level the business has genuinely earned.
 *
 * Independent of what the player has claimed: this is what the numbers say,
 * and it only ever moves because the business moved.
 */
export function earnedLevel(building: Building, metrics: CityMetrics): number {
  let earned = 0;
  for (const rung of building.ladder) {
    if (have(metrics, building.resource) >= rung) earned += 1;
    else break;
  }
  return earned;
}

// ---------------------------------------------------------------------------
// The skyline
// ---------------------------------------------------------------------------

export type Tier = {
  readonly level: number;
  readonly name: string;
  /** Total claimed levels across the city needed to reach this tier. */
  readonly at: number;
  readonly blurb: string;
};

/**
 * How grand the city has become.
 *
 * The point of the top of this list is that it is a long way away and it looks
 * like somewhere: a business that keeps growing ends up with a skyline, not a
 * bigger number.
 */
export const TIERS: readonly Tier[] = [
  { level: 1, name: "Landing", at: 0, blurb: "A few buildings and a lot of empty ground." },
  { level: 2, name: "Township", at: 6, blurb: "Streets with something on them." },
  { level: 3, name: "Borough", at: 14, blurb: "Mid-rise, and busy with it." },
  { level: 4, name: "Downtown", at: 26, blurb: "Towers going up on every block." },
  { level: 5, name: "Metropolis", at: 40, blurb: "A skyline you can recognise from the water." },
];

export function tierFor(totalLevels: number): Tier {
  let tier = TIERS[0];
  for (const candidate of TIERS) if (totalLevels >= candidate.at) tier = candidate;
  return tier;
}

export function nextTier(totalLevels: number): Tier | null {
  return TIERS.find((tier) => tier.at > totalLevels) ?? null;
}
