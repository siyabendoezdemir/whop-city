/**
 * The city, as a set of buildings you level up with your real business.
 *
 * There is no invented currency here and there is no simulated economy. A
 * building's next level costs a **real Whop number** — a thousand in revenue,
 * fifty members, two hundred visitors — and the only way to pay it is to
 * actually go and grow the business. That is the whole game: the city is the
 * scoreboard and your Whop account is the controller.
 *
 * One resource per district, which is the rule that makes the skyline readable
 * from the water:
 *
 *   **Commerce Core** rises with revenue. Downtown is money.
 *   **Offer Forge** rises with recurring revenue. The forge makes the thing
 *   that pays again next month.
 *   **Creator Quarter** rises with people — the members who live there and the
 *   visitors who walk through.
 *
 * So a business with good revenue and no recurring gets a downtown and an
 * empty forge, and can see that from the wide shot without reading a word.
 */

import type { CityMetrics } from "../city/projection";
import type { DistrictId } from "../city/projection";

/** The four things the city runs on. */
export const RESOURCES = ["gold", "citizens", "traffic", "recurring"] as const;
export type Resource = (typeof RESOURCES)[number];

export const RESOURCE: Record<
  Resource,
  { name: string; unit: string; prefix?: string; tone: string; blurb: string }
> = {
  gold: {
    name: "Gold",
    unit: "in revenue this month",
    prefix: "$",
    tone: "gold",
    blurb: "Everything the business took this month.",
  },
  citizens: {
    name: "Citizens",
    unit: "paying members",
    tone: "green",
    blurb: "People paying you right now. They live here.",
  },
  traffic: {
    name: "Footfall",
    unit: "visitors today",
    tone: "violet",
    blurb: "People who came through today.",
  },
  recurring: {
    name: "Reserve",
    unit: "a month, recurring",
    prefix: "$",
    tone: "blue",
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
   * milestone rather than a formality. Plots inside one district are staggered
   * so they do not all light up on the same afternoon.
   */
  readonly ladder: readonly [number, number, number, number, number];
};

export const BUILDINGS: readonly Building[] = [
  // ------------------------------------- Commerce Core — revenue, this month
  {
    id: "core-landmark",
    district: "commerce-core",
    name: "The Treasury",
    role: "The tower downtown. It is as tall as the month was good.",
    resource: "gold",
    ladder: [100, 1_000, 5_000, 25_000, 100_000],
  },
  {
    id: "core-north",
    district: "commerce-core",
    name: "Grand Exchange",
    role: "Trading floors, one per order of magnitude.",
    resource: "gold",
    ladder: [250, 2_000, 10_000, 50_000, 200_000],
  },
  {
    id: "core-east",
    district: "commerce-core",
    name: "Merchant Row",
    role: "The first block to go up when money starts arriving.",
    resource: "gold",
    ladder: [50, 500, 2_500, 12_000, 50_000],
  },
  {
    id: "core-southeast",
    district: "commerce-core",
    name: "Counting House",
    role: "The last block to go up. It only opens for a serious month.",
    resource: "gold",
    ladder: [500, 4_000, 20_000, 80_000, 300_000],
  },

  // ------------------------------- Offer Forge — recurring revenue, per month
  {
    id: "forge-hero",
    district: "offer-forge",
    name: "The Mint",
    role: "Where money that comes back on its own is struck.",
    resource: "recurring",
    ladder: [50, 500, 2_500, 10_000, 50_000],
  },
  {
    id: "forge-north",
    district: "offer-forge",
    name: "The Foundry",
    role: "Runs hotter the more of the book renews itself.",
    resource: "recurring",
    ladder: [150, 1_200, 6_000, 25_000, 100_000],
  },
  {
    id: "forge-south",
    district: "offer-forge",
    name: "The Vault",
    role: "Opens the day something first renews without you.",
    resource: "recurring",
    ladder: [25, 250, 1_200, 6_000, 30_000],
  },

  // ------------------------------------- Creator Quarter — the people
  {
    id: "creator-park",
    district: "creator-quarter",
    name: "The Gates",
    role: "Widen for every visitor who walks through today.",
    resource: "traffic",
    ladder: [25, 150, 750, 3_000, 15_000],
  },
  {
    id: "creator-terrace",
    district: "creator-quarter",
    name: "Signal Tower",
    role: "Reaches further the more people find you.",
    resource: "traffic",
    ladder: [60, 400, 2_000, 8_000, 40_000],
  },
  {
    id: "creator-venue",
    district: "creator-quarter",
    name: "The Amphitheatre",
    role: "Fills up as the membership does.",
    resource: "citizens",
    ladder: [5, 50, 250, 1_000, 5_000],
  },
  {
    id: "creator-struggling",
    district: "creator-quarter",
    name: "The Terraces",
    role: "Homes for everyone who stayed.",
    resource: "citizens",
    ladder: [15, 120, 600, 2_500, 12_000],
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
  { level: 1, name: "Landing", at: 0, blurb: "Empty ground and a good view." },
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
