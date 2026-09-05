/**
 * The public city projection.
 *
 * This is the whole contract between the server and the browser. Everything the
 * client knows about a business arrives in this shape and nothing else does.
 *
 * The design rule is that the projection carries *physical states*, not
 * measurements. A district is `healthy` or `struggling`; it never carries the
 * revenue, the member count, the price, the product title, the customer, the
 * Whop identifier or the timestamp that led to that conclusion. Those live on
 * the server side of the boundary in `server/snapshot.ts` and are discarded
 * once the state is decided.
 *
 * Two mechanisms keep it that way, because a comment is not a guarantee:
 *
 *  - `PublicCityProjection` is a closed type of string-literal unions and small
 *    bounded integers. Widening it is a visible type change.
 *  - `serializeProjection` does not stringify the object it is given. It
 *    rebuilds one field by field from the whitelist below and validates every
 *    value against its allowed domain. A field added to the projection without
 *    also being added here cannot reach the wire, and a value outside its
 *    domain throws rather than being sent.
 */

export const DISTRICT_IDS = ["commerce-core", "offer-forge", "creator-quarter"] as const;
export type DistrictId = (typeof DISTRICT_IDS)[number];

/**
 * The four physical states the renderer knows how to build.
 *
 * These are the only description of business health that crosses the boundary.
 */
export const DISTRICT_STATES = ["dormant", "rising", "healthy", "struggling"] as const;
export type DistrictState = (typeof DISTRICT_STATES)[number];

/** Coarse trend. Never a rate, never a delta. */
export const DIRECTIONS = ["rising", "steady", "cooling", "dormant"] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** Coarse activity, as a word. The bucket boundaries are not published. */
export const SIGNALS = ["unbuilt", "quiet", "stirring", "busy", "thriving", "unreadable"] as const;
export type Signal = (typeof SIGNALS)[number];

/** How current the reading is, bucketed. Never a timestamp. */
export const FRESHNESS = ["live", "recent", "stale", "unavailable"] as const;
export type Freshness = (typeof FRESHNESS)[number];

/** Renderer-safe bounds. Outside these the world does not compose. */
export const PARCELS_MIN = 2;
export const PARCELS_MAX = 5;
export const VARIANT_MAX = 3;
/** 64 bits of opaque seed, lowercase hex. */
export const SEED_LENGTH = 16;

export type PublicDistrict = {
  readonly id: DistrictId;
  readonly state: DistrictState;
  readonly direction: Direction;
  readonly signal: Signal;
  /** How many authored parcels this district lays out. */
  readonly parcels: number;
  /** Which authored skin set to use. */
  readonly variant: number;
};

/**
 * The real numbers the game runs on.
 *
 * These are counts from the business's own Whop account, and they are the
 * game's only resource: a building's next level costs *five customers*, not
 * five invented credits. Nothing here is simulated, and nothing here is a
 * name, a price, an identifier or a piece of anyone's personal data — they are
 * counts, and they are what "you need five customers" is made of.
 *
 * Because these are real business figures they belong to the owner. The public
 * route serves them zeroed; the owner's dashboard view serves them for real.
 */
export type CityMetrics = {
  /** Gross revenue this month, in whole units of the account's currency. */
  readonly gold: number;
  /** Monthly recurring revenue: the part that comes back on its own. */
  readonly recurring: number;
  /** Paying members right now. */
  readonly citizens: number;
  /** People who came through today. */
  readonly traffic: number;
  /** Yesterday's traffic, so the city can say it fell. */
  readonly trafficBefore: number;
  /** Last month's revenue, for the same reason. */
  readonly goldBefore: number;
  /** Members lost, as whole percent. */
  readonly churn: number;
  /** Refunds, as whole percent. */
  readonly refunds: number;
  /** New members this month. */
  readonly joined: number;
  /** Whether these are the business's own figures or a zeroed public stand-in. */
  readonly source: "owner" | "withheld";
};

export const ZERO_METRICS: CityMetrics = {
  gold: 0,
  recurring: 0,
  citizens: 0,
  traffic: 0,
  trafficBefore: 0,
  goldBefore: 0,
  churn: 0,
  refunds: 0,
  joined: 0,
  source: "withheld",
};

export type PublicCityProjection = {
  readonly schema: "whop-city.public.v2";
  readonly freshness: Freshness;
  /**
   * Opaque, stable per business, and not reversible to the business it came
   * from. Derived server-side — see `server/seed.ts`.
   */
  readonly seed: string;
  readonly districts: readonly PublicDistrict[];
  readonly metrics: CityMetrics;
};

export const PROJECTION_SCHEMA = "whop-city.public.v2";

/** No count the game needs is larger than this; anything bigger is a bug. */
const METRIC_MAX = 10_000_000;

/**
 * Compile-time proof that the projection is plain data.
 *
 * A field typed as a function, a Date, a Map, or an arbitrary object fails to
 * satisfy this and the build breaks.
 */
type PlainValue = string | number | boolean | readonly PlainValue[] | { readonly [key: string]: PlainValue };
type AssertPlain<T extends PlainValue> = T;
export type ProjectionIsPlain = AssertPlain<PublicCityProjection>;

export class ProjectionViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectionViolation";
  }
}

function oneOf<T extends string>(allowed: readonly T[], value: unknown, field: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new ProjectionViolation(`${field} is not one of ${allowed.join(" | ")}`);
  }
  return value as T;
}

function boundedInt(value: unknown, min: number, max: number, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new ProjectionViolation(`${field} must be an integer in [${min}, ${max}]`);
  }
  return value;
}

const SEED_PATTERN = /^[0-9a-f]+$/;

function opaqueSeed(value: unknown): string {
  if (typeof value !== "string" || value.length !== SEED_LENGTH || !SEED_PATTERN.test(value)) {
    throw new ProjectionViolation(`seed must be ${SEED_LENGTH} lowercase hex characters`);
  }
  return value;
}

/**
 * Rebuilds the projection from the whitelist and validates every value.
 *
 * Deliberately not `JSON.stringify(projection)`. This reads named fields off
 * the input and writes a fresh object, so anything the caller happens to be
 * carrying — a snapshot reference, a debug field, an id someone attached during
 * a refactor — is dropped rather than serialised. It is the last line of the
 * privacy boundary and the thing the tests point at.
 */
export function sealProjection(input: PublicCityProjection): PublicCityProjection {
  if (input.schema !== PROJECTION_SCHEMA) {
    throw new ProjectionViolation(`unexpected schema ${String(input.schema)}`);
  }
  if (!Array.isArray(input.districts) || input.districts.length !== DISTRICT_IDS.length) {
    throw new ProjectionViolation(`districts must be exactly ${DISTRICT_IDS.length} entries`);
  }

  const districts = DISTRICT_IDS.map((id) => {
    const found = input.districts.find((district) => district.id === id);
    if (!found) throw new ProjectionViolation(`missing district ${id}`);
    return {
      id,
      state: oneOf(DISTRICT_STATES, found.state, `${id}.state`),
      direction: oneOf(DIRECTIONS, found.direction, `${id}.direction`),
      signal: oneOf(SIGNALS, found.signal, `${id}.signal`),
      parcels: boundedInt(found.parcels, PARCELS_MIN, PARCELS_MAX, `${id}.parcels`),
      variant: boundedInt(found.variant, 0, VARIANT_MAX, `${id}.variant`),
    } satisfies PublicDistrict;
  });

  return {
    schema: PROJECTION_SCHEMA,
    freshness: oneOf(FRESHNESS, input.freshness, "freshness"),
    seed: opaqueSeed(input.seed),
    districts,
    metrics: sealMetrics(input.metrics),
  };
}

/**
 * Counts only, and only sane ones.
 *
 * The whitelist still holds: whatever the caller hands over, exactly these six
 * fields go out and every one of them is a bounded integer. A title, an id or
 * a price cannot travel through here whatever anyone does upstream.
 */
function sealMetrics(input: CityMetrics | undefined): CityMetrics {
  if (!input || input.source !== "owner") return ZERO_METRICS;
  return {
    gold: boundedInt(input.gold, 0, METRIC_MAX, "metrics.gold"),
    goldBefore: boundedInt(input.goldBefore, 0, METRIC_MAX, "metrics.goldBefore"),
    recurring: boundedInt(input.recurring, 0, METRIC_MAX, "metrics.recurring"),
    citizens: boundedInt(input.citizens, 0, METRIC_MAX, "metrics.citizens"),
    traffic: boundedInt(input.traffic, 0, METRIC_MAX, "metrics.traffic"),
    trafficBefore: boundedInt(input.trafficBefore, 0, METRIC_MAX, "metrics.trafficBefore"),
    churn: boundedInt(input.churn, 0, 100, "metrics.churn"),
    refunds: boundedInt(input.refunds, 0, 100, "metrics.refunds"),
    joined: boundedInt(input.joined, 0, METRIC_MAX, "metrics.joined"),
    source: "owner",
  };
}

/** The only supported way to put a projection on the wire. */
export function serializeProjection(input: PublicCityProjection): string {
  return JSON.stringify(sealProjection(input));
}

/**
 * Parses a payload received by the browser.
 *
 * Runs the same whitelist in the other direction, so a client cannot be talked
 * into rendering a payload with extra fields in it either.
 */
export function parseProjection(input: unknown): PublicCityProjection {
  if (typeof input !== "object" || input === null) {
    throw new ProjectionViolation("projection must be an object");
  }
  return sealProjection(input as PublicCityProjection);
}

/** What the city renders when the server could not read anything. */
export function unavailableProjection(seed: string): PublicCityProjection {
  return {
    metrics: ZERO_METRICS,
    schema: PROJECTION_SCHEMA,
    freshness: "unavailable",
    seed,
    districts: DISTRICT_IDS.map((id) => ({
      id,
      state: "dormant" as const,
      direction: "dormant" as const,
      signal: "unreadable" as const,
      parcels: PARCELS_MIN,
      variant: 0,
    })),
  };
}
