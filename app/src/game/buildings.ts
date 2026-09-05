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

/** The four things the city runs on. */
export const RESOURCES = ["gold", "citizens", "traffic", "recurring"] as const;
export type Resource = (typeof RESOURCES)[number];

export const RESOURCE: Record<
  Resource,
  { name: string; one: string; many: string; prefix?: string; tone: string; blurb: string }
> = {
  gold: {
    name: "Gold",
    one: "in revenue",
    many: "in revenue",
    prefix: "$",
    tone: "gold",
    blurb: "Everything the business took this month.",
  },
  citizens: {
    name: "Citizens",
    one: "member",
    many: "members",
    tone: "green",
    blurb: "People paying you right now. They live here.",
  },
  traffic: {
    name: "Footfall",
    one: "visitor",
    many: "visitors",
    tone: "violet",
    blurb: "People who came through today.",
  },
  recurring: {
    name: "Reserve",
    one: "a month",
    many: "a month",
    prefix: "$",
    tone: "dark",
    blurb: "The part that comes back on its own every month.",
  },
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
 * Spread across all four resources on purpose: a business that only drives
 * traffic still watches most of its city stand still, which is the nudge. The
 * ladders are absolute figures rather than counts of objects, so they mean the
 * same thing to a newsletter, a coaching programme and a software product.
 */
export const BUILDINGS: readonly Building[] = [
  // ---------------------------------------------------- Commerce Core
  {
    id: "core-landmark",
    district: "commerce-core",
    name: "The Treasury",
    role: "Rises with everything the business takes.",
    resource: "gold",
    ladder: [1, 100, 1_000, 10_000, 100_000],
  },
  {
    id: "core-north",
    district: "commerce-core",
    name: "Grand Exchange",
    role: "One floor for every hundred a month you can count on.",
    resource: "recurring",
    ladder: [1, 100, 1_000, 10_000, 50_000],
  },
  {
    id: "core-east",
    district: "commerce-core",
    name: "Merchant Row",
    role: "Shopfronts fill as the members do.",
    resource: "citizens",
    ladder: [1, 10, 100, 1_000, 10_000],
  },
  {
    id: "core-southeast",
    district: "commerce-core",
    name: "Counting House",
    role: "Keeps the books, and grows with them.",
    resource: "gold",
    ladder: [50, 500, 5_000, 50_000, 250_000],
  },

  // ------------------------------------------------------ Offer Forge
  {
    id: "forge-hero",
    district: "offer-forge",
    name: "The Mint",
    role: "Where recurring money is struck.",
    resource: "recurring",
    ladder: [10, 250, 2_500, 25_000, 100_000],
  },
  {
    id: "forge-north",
    district: "offer-forge",
    name: "Foundry",
    role: "Runs hotter the more comes through the gates.",
    resource: "traffic",
    ladder: [5, 50, 500, 5_000, 25_000],
  },
  {
    id: "forge-south",
    district: "offer-forge",
    name: "The Vault",
    role: "As deep as the book is big.",
    resource: "gold",
    ladder: [500, 5_000, 25_000, 100_000, 1_000_000],
  },

  // -------------------------------------------------- Creator Quarter
  {
    id: "creator-park",
    district: "creator-quarter",
    name: "The Gates",
    role: "Widen for every visitor who walks through.",
    resource: "traffic",
    ladder: [1, 25, 250, 2_500, 20_000],
  },
  {
    id: "creator-terrace",
    district: "creator-quarter",
    name: "Signal Tower",
    role: "Reaches further the more people find you.",
    resource: "traffic",
    ladder: [10, 100, 1_000, 10_000, 50_000],
  },
  {
    id: "creator-venue",
    district: "creator-quarter",
    name: "Amphitheatre",
    role: "Fills up as the crowd does.",
    resource: "citizens",
    ladder: [5, 50, 500, 5_000, 25_000],
  },
  {
    id: "creator-struggling",
    district: "creator-quarter",
    name: "The Quarter",
    role: "A home for everyone who stayed.",
    resource: "citizens",
    ladder: [25, 250, 2_500, 20_000, 100_000],
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

/**
 * A figure as the city writes it.
 *
 * Big numbers are the point of the late game and a six-digit revenue figure
 * cannot sit in a resource pill, so anything over a thousand is abbreviated.
 */
export function short(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(value));
}

/** The same, with the resource's own prefix on the front. */
export function money(resource: Resource, value: number): string {
  return `${RESOURCE[resource].prefix ?? ""}${short(value)}`;
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
