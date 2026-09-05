import type { CityMetrics } from "../city/projection";

/**
 * The privacy boundary.
 *
 * One function, one direction: a sensitive `BusinessSnapshot` goes in and a
 * `PublicCityProjection` comes out. Nothing else in the app is allowed to move
 * data across.
 *
 * What crosses, and what does not. Titles, ids, prices, timestamps and any
 * trace of an individual are read to decide a bucket and then dropped on the
 * floor; none of them survives into the return value.
 *
 * Counts do survive, and only counts: how many customers, products, ways to
 * buy, affiliate programmes, and the best rate. They are the game's resources
 * — a building's next level costs five customers, not five invented credits —
 * and they are bounded integers, whitelisted one field at a time in
 * `sealMetrics`. Because they are the business's real figures they are the
 * owner's: the public route serves them zeroed, and only a viewer Whop has
 * verified as an admin of this business gets them for real.
 *
 * On honesty: there is no history store, so this never claims a trend it cannot
 * see. A district with nothing in it is `dormant`, not `struggling`; a district
 * that exists but is shuttered or inert is `struggling`; and `cooling` is only
 * used where there is a built thing with no recent activity. Nothing is
 * invented to make the city look busier than the business is.
 */

import {
  DISTRICT_IDS,
  PARCELS_MAX,
  PARCELS_MIN,
  PROJECTION_SCHEMA,
  VARIANT_MAX,
  ZERO_METRICS,
  type Direction,
  type DistrictId,
  type DistrictState,
  type Freshness,
  type PublicCityProjection,
  type PublicDistrict,
  type Signal,
} from "../city/projection";
import { seedStream } from "./seed";
import type { BusinessSnapshot } from "./snapshot";

const RECENT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * What a district's raw inputs reduce to before bucketing.
 *
 * Deliberately tiny: `built` is whether anything exists at all, `live` whether
 * any of it is visible to buyers, `active` whether anything is actually
 * happening, and `weight` a coarse magnitude that only ever reaches the output
 * as a `signal` word.
 */
type DistrictEvidence = {
  built: number;
  live: number;
  active: number;
  weight: number;
  newestCreatedAt: number | null;
};

function newest(values: (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : Math.max(...present);
}

/**
 * The four physical states.
 *
 * Ordering matters: nothing built is dormant before anything else; something
 * built but invisible or inert is struggling; something new is rising; the rest
 * is healthy.
 */
function stateFor(evidence: DistrictEvidence, now: number, reachable: boolean): DistrictState {
  if (!reachable || evidence.built === 0) return "dormant";
  if (evidence.live === 0) return "struggling";
  const isNew =
    evidence.newestCreatedAt !== null && now - evidence.newestCreatedAt <= RECENT_WINDOW_MS;
  if (isNew) return "rising";
  if (evidence.active === 0) return "struggling";
  return "healthy";
}

function directionFor(evidence: DistrictEvidence, now: number, reachable: boolean): Direction {
  if (!reachable || evidence.built === 0) return "dormant";
  const isNew =
    evidence.newestCreatedAt !== null && now - evidence.newestCreatedAt <= RECENT_WINDOW_MS;
  if (isNew) return "rising";
  // No history store, so "cooling" is only claimed where there is something
  // built that nothing is happening in. Otherwise: steady, honestly.
  if (evidence.active === 0 || evidence.live === 0) return "cooling";
  return "steady";
}

/** Coarse activity as a word. The boundaries are not published and not linear. */
const SIGNAL_BOUNDS = [1, 3, 8, 18] as const;

function signalFor(evidence: DistrictEvidence, reachable: boolean): Signal {
  if (!reachable) return "unreadable";
  if (evidence.built === 0) return "unbuilt";
  // Nothing visible means nothing publicly happening, whatever the history
  // behind it. A shuttered district reporting "busy" would be the projection
  // describing the business's records rather than the place a visitor sees.
  if (evidence.live === 0) return "quiet";
  let index = 0;
  for (const bound of SIGNAL_BOUNDS) if (evidence.weight >= bound) index += 1;
  return (["quiet", "stirring", "busy", "thriving", "thriving"] as const)[index];
}

/**
 * Renderer configuration.
 *
 * Parcel count is drawn from the signal bucket and the seed, never from the raw
 * weight, so it cannot carry more information than the bucket already does. A
 * business with four products and one with six get the same bucket and may
 * still get different-sized districts, because the difference is the seed.
 */
const PARCELS_BY_SIGNAL: Record<Signal, number> = {
  unreadable: PARCELS_MIN,
  unbuilt: PARCELS_MIN,
  quiet: PARCELS_MIN,
  stirring: 3,
  busy: 4,
  thriving: PARCELS_MAX,
};

function rendererConfig(signal: Signal, next: () => number): { parcels: number; variant: number } {
  const base = PARCELS_BY_SIGNAL[signal];
  const jitter = base > PARCELS_MIN && base < PARCELS_MAX ? next() % 2 : 0;
  return {
    parcels: Math.min(PARCELS_MAX, base + jitter),
    variant: next() % (VARIANT_MAX + 1),
  };
}

function evidenceFor(id: DistrictId, snapshot: BusinessSnapshot): DistrictEvidence {
  const { products, plans } = snapshot;

  if (id === "commerce-core") {
    // What the business sells, and whether anyone is buying it.
    const live = products.filter((product) => product.visible);
    const members = products.reduce((sum, product) => sum + product.memberCount, 0);
    return {
      built: products.length,
      live: live.length,
      active: members,
      weight: live.length + Math.min(members, 30),
      newestCreatedAt: newest(products.map((product) => product.createdAt)),
    };
  }

  if (id === "offer-forge") {
    // The pricing surface: how many ways there are to buy, and how varied.
    const live = plans.filter((plan) => plan.visible);
    const shapes = new Set(plans.map((plan) => plan.planType).filter(Boolean)).size;
    return {
      built: plans.length,
      live: live.length,
      active: shapes,
      weight: live.length + shapes,
      newestCreatedAt: newest(plans.map((plan) => plan.createdAt)),
    };
  }

  // Creator Quarter: affiliate reach, which is all the injected credential can
  // see. See docs/website-auth-spike.md.
  const affiliate = products.filter((product) => product.affiliateEnabled);
  const memberAffiliate = products.filter((product) => product.memberAffiliateEnabled);
  const bestRate = affiliate.reduce((max, product) => Math.max(max, product.affiliatePercentage), 0);
  return {
    built: affiliate.length + memberAffiliate.length,
    live: affiliate.length,
    active: bestRate,
    weight: affiliate.length + memberAffiliate.length + (bestRate >= 20 ? 2 : 0),
    newestCreatedAt: newest(affiliate.map((product) => product.createdAt)),
  };
}

const FRESHNESS_RECENT_MS = 5 * 60 * 1000;
const FRESHNESS_STALE_MS = 60 * 60 * 1000;

function freshnessFor(snapshot: BusinessSnapshot, now: number): Freshness {
  if (!snapshot.reachable) return "unavailable";
  const age = now - snapshot.capturedAt;
  if (age <= FRESHNESS_RECENT_MS) return "live";
  if (age <= FRESHNESS_STALE_MS) return "recent";
  return "stale";
}

/**
 * @param seed Already derived by `deriveLayoutSeed`. This function never sees
 *   the account id it came from, which is why it takes the seed rather than
 *   the snapshot's `accountId`.
 */
/**
 * The business, counted.
 *
 * Six numbers, straight off the snapshot: the resources the game spends. A
 * business City could not read has nothing to count, and says so by handing
 * back the withheld zeros rather than a plausible-looking nothing.
 */
function metricsFor(snapshot: BusinessSnapshot): CityMetrics {
  if (!snapshot.reachable) return ZERO_METRICS;
  const { products, plans } = snapshot;
  const affiliate = products.filter((product) => product.affiliateEnabled);
  return {
    // Floored, not refused. Upstream has been seen to send a quantity as a
    // string or with a decimal on it, and a fractional member is a rounding
    // artefact, not a reason to take the whole city offline.
    customers: Math.floor(products.reduce((sum, p) => sum + Math.max(0, p.memberCount || 0), 0)),
    products: products.filter((product) => product.visible).length,
    waysToBuy: plans.filter((plan) => plan.visible).length,
    affiliates: affiliate.length,
    bestRate: Math.min(100, Math.round(affiliate.reduce((max, p) => Math.max(max, p.affiliatePercentage || 0), 0))),
    source: "owner",
  };
}

/**
 * Who is going to read this.
 *
 * The default is `public`, and it is the default on purpose: the counts are
 * the business's own figures, so a caller has to *ask* for the owner's view,
 * having already proved the viewer is an admin of this business. Forgetting to
 * pass anything withholds them.
 */
export type Audience = "public" | "owner";

export function toPublicProjection(
  snapshot: BusinessSnapshot,
  seed: string,
  now: number = Date.now(),
  audience: Audience = "public",
): PublicCityProjection {
  const next = seedStream(seed);

  const districts: PublicDistrict[] = DISTRICT_IDS.map((id) => {
    const evidence = evidenceFor(id, snapshot);
    const signal = signalFor(evidence, snapshot.reachable);
    const { parcels, variant } = rendererConfig(signal, next);
    return {
      id,
      state: stateFor(evidence, now, snapshot.reachable),
      direction: directionFor(evidence, now, snapshot.reachable),
      signal,
      parcels,
      variant,
    };
  });

  return {
    metrics: audience === "owner" ? metricsFor(snapshot) : ZERO_METRICS,
    schema: PROJECTION_SCHEMA,
    freshness: freshnessFor(snapshot, now),
    seed,
    districts,
  };
}
