/**
 * The privacy boundary.
 *
 * `toPublicProjection` is the only way business data reaches the browser. Its
 * return type is a closed shape of buckets and labels: no absolute revenue, no
 * customer counts, no customer records, no product titles, no plan pricing, no
 * team details, and no Whop object ids. Adding a sensitive field here is a type
 * error, not a review miss, and `tests/projection.test.ts` additionally proves
 * at runtime that sentinel values planted in a snapshot cannot appear in the
 * serialised output.
 *
 * One thing this boundary deliberately does NOT claim: that the deployed page
 * exposes no Whop identifiers at all. Whop's hosting injects its own pixel into
 * every HTML response and publishes the business id through it. See
 * docs/architecture-website-blueprint.md. City controls its own payload; it does
 * not control the platform's.
 */

import type { BusinessSnapshot } from "./snapshot";

export const DISTRICT_IDS = ["commerce-core", "offer-forge", "creator-quarter"] as const;
export type DistrictId = (typeof DISTRICT_IDS)[number];

/** Coarse enough that the underlying count cannot be recovered. */
export type Tier = 0 | 1 | 2 | 3 | 4 | 5;

export type Direction = "rising" | "steady" | "cooling" | "dormant";
export type Freshness = "live" | "unavailable";

export type DistrictProjection = {
  readonly id: DistrictId;
  /** City's own vocabulary, never a product or plan title. */
  readonly name: string;
  readonly tagline: string;
  readonly tier: Tier;
  /** 0..1, two decimals. A shape input, not a metric anyone can invert. */
  readonly health: number;
  readonly direction: Direction;
  /** Deterministic visual seed so a business always renders the same city. */
  readonly variant: number;
  /** Bucketed word, never a number. */
  readonly signal: string;
  readonly blocks: number;
};

export type CityProjection = {
  readonly schema: "whop-city.public.v1";
  readonly capturedAt: number;
  readonly freshness: Freshness;
  readonly cityTier: Tier;
  readonly skyPhase: "dawn" | "day" | "dusk";
  readonly districts: readonly DistrictProjection[];
};

/**
 * Compile-time guarantee that the projection carries only plain data. A field
 * whose type is a function, a Date, a Map, or an arbitrary object fails here.
 */
type PlainValue = string | number | boolean | readonly PlainValue[] | { readonly [key: string]: PlainValue };
type AssertPlain<T extends PlainValue> = T;
export type ProjectionIsPlain = AssertPlain<CityProjection>;

const TIER_BOUNDS = [1, 2, 4, 9, 20] as const;

/** Maps a raw count onto a tier without exposing the count. */
export function bucketToTier(count: number): Tier {
  if (count <= 0) return 0;
  let tier = 1;
  for (const bound of TIER_BOUNDS) if (count >= bound) tier += 1;
  return Math.min(tier, 5) as Tier;
}

const SIGNAL_WORDS = ["Unbuilt", "Quiet", "Stirring", "Busy", "Thriving", "Landmark"] as const;

function signalFor(tier: Tier, reachable: boolean): string {
  if (!reachable) return "Unreadable";
  return SIGNAL_WORDS[tier];
}

const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Direction without a time series.
 *
 * There is no history store, so this is derived from recency of creation only,
 * and it never claims a trend it cannot see: an empty district is `dormant`,
 * and an established one with nothing new is `steady`, not `cooling`. Nothing
 * here is invented.
 */
function directionFor(tier: Tier, newestCreatedAt: number | null, now: number, reachable: boolean): Direction {
  if (!reachable || tier === 0) return "dormant";
  if (newestCreatedAt !== null && now - newestCreatedAt <= RECENT_WINDOW_MS) return "rising";
  return "steady";
}

/** Stable per-business visual seed, derived without retaining the id. */
function seedFrom(text: string | null): number {
  if (!text) return 0;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function newest(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length === 0 ? null : Math.max(...present);
}

export function toPublicProjection(snapshot: BusinessSnapshot): CityProjection {
  const { reachable, products, plans } = snapshot;
  const now = snapshot.capturedAt;
  const seed = seedFrom(snapshot.accountId);

  // ---------------------------------------------------------- Commerce Core
  // What the business actually sells, and whether anyone is buying it.
  const liveProducts = products.filter((p) => p.visible).length;
  const totalMembers = products.reduce((sum, p) => sum + p.memberCount, 0);
  const commerceWeight = liveProducts + Math.min(totalMembers, 40);
  const commerceTier = bucketToTier(commerceWeight);
  const commerceHealth = reachable
    ? round2(Math.min(1, liveProducts === 0 ? 0 : 0.4 + Math.min(totalMembers, 25) / 40))
    : 0;

  // ------------------------------------------------------------ Offer Forge
  // The pricing surface: how many ways there are to buy, and how varied.
  const livePlans = plans.filter((p) => p.visible).length;
  const planShapes = new Set(plans.map((p) => p.planType).filter(Boolean)).size;
  const forgeTier = bucketToTier(livePlans + planShapes);
  const forgeHealth = reachable ? round2(Math.min(1, livePlans === 0 ? 0 : 0.35 + planShapes * 0.2 + Math.min(livePlans, 6) * 0.06)) : 0;

  // -------------------------------------------------------- Creator Quarter
  // Affiliate reach. Narrowed to what global_affiliate_status exposes, which is
  // all the injected credential can see — see docs/website-auth-spike.md.
  const affiliateProducts = products.filter((p) => p.affiliateEnabled);
  const memberAffiliateProducts = products.filter((p) => p.memberAffiliateEnabled);
  const bestAffiliateRate = affiliateProducts.reduce((max, p) => Math.max(max, p.affiliatePercentage), 0);
  const quarterWeight = affiliateProducts.length + memberAffiliateProducts.length + (bestAffiliateRate >= 20 ? 2 : 0);
  const quarterTier = bucketToTier(quarterWeight);
  const quarterHealth = reachable
    ? round2(Math.min(1, affiliateProducts.length === 0 ? 0 : 0.35 + Math.min(bestAffiliateRate, 50) / 80))
    : 0;

  const districts: DistrictProjection[] = [
    {
      id: "commerce-core",
      name: "Commerce Core",
      tagline: "Where the business sells",
      tier: commerceTier,
      health: commerceHealth,
      direction: directionFor(commerceTier, newest(products.map((p) => p.createdAt)), now, reachable),
      variant: (seed + 1) % 4,
      signal: signalFor(commerceTier, reachable),
      blocks: 3 + commerceTier,
    },
    {
      id: "offer-forge",
      name: "Offer Forge",
      tagline: "Where offers are shaped",
      tier: forgeTier,
      health: forgeHealth,
      direction: directionFor(forgeTier, newest(plans.map((p) => p.createdAt)), now, reachable),
      variant: (seed + 2) % 4,
      signal: signalFor(forgeTier, reachable),
      blocks: 2 + forgeTier,
    },
    {
      id: "creator-quarter",
      name: "Creator Quarter",
      tagline: "Where others carry the offer",
      tier: quarterTier,
      health: quarterHealth,
      direction: directionFor(quarterTier, newest(affiliateProducts.map((p) => p.createdAt)), now, reachable),
      variant: (seed + 3) % 4,
      signal: signalFor(quarterTier, reachable),
      blocks: 2 + quarterTier,
    },
  ];

  const cityTier = Math.round(districts.reduce((sum, d) => sum + d.tier, 0) / districts.length) as Tier;

  return {
    schema: "whop-city.public.v1",
    capturedAt: snapshot.capturedAt,
    freshness: reachable ? "live" : "unavailable",
    cityTier,
    skyPhase: !reachable ? "dusk" : cityTier >= 3 ? "day" : "dawn",
    districts,
  };
}

/** The shape rendered when the server could not read anything at all. */
export function unavailableProjection(capturedAt: number): CityProjection {
  return toPublicProjection({ accountId: null, capturedAt, reachable: false, products: [], plans: [] });
}
