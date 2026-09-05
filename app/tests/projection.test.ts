import { describe, expect, it } from "vitest";

import {
  DISTRICT_IDS,
  DISTRICT_STATES,
  ProjectionViolation,
  ZERO_METRICS,
  parseProjection,
  sealProjection,
  serializeProjection,
  unavailableProjection,
  type CityMetrics,
  type PublicCityProjection,
} from "../src/city/projection";
import { fixtureSnapshot } from "../src/server/fixtures";
import { FIXTURE_SCENARIOS } from "../src/server/scenarios";
import { toPublicProjection } from "../src/server/project";
import {
  ANONYMOUS_SEED,
  SeedSecretUnavailable,
  deriveLayoutSeed,
  isUsableSeedSecret,
} from "../src/server/seed";
import type { BusinessSnapshot } from "../src/server/snapshot";

const NOW = 1_780_000_000_000;
/** Deliberately not sequential: a sequential seed contains most short
 * numeric sentinels as a substring and turns leak assertions into noise. */
const SEED = "a7f3c1e90b6d84fa";

/**
 * Values planted in the snapshot that must not survive the boundary.
 *
 * Each is a string that would be unmistakable in the output, standing in for
 * the class of data it represents: identity, titles, money, ids, timestamps.
 */
const SENTINELS = {
  accountId: "biz_SENTINEL_ACCOUNT",
  productId: "prod_SENTINEL_PRODUCT",
  planId: "plan_SENTINEL_PLAN",
  title: "SENTINEL Premium Coaching Programme",
} as const;

function plantedSnapshot(): BusinessSnapshot {
  return {
    accountId: SENTINELS.accountId,
    capturedAt: NOW,
    reachable: true,
    products: [
      {
        id: SENTINELS.productId,
        title: SENTINELS.title,
        visible: true,
        // A distinctive count and rate, so a leak would be recognisable.
        memberCount: 8675309,
        affiliateEnabled: true,
        affiliatePercentage: 37,
        memberAffiliateEnabled: true,
        createdAt: NOW - 90 * 24 * 60 * 60 * 1000,
      },
    ],
    plans: [
      {
        id: SENTINELS.planId,
        planType: "renewal",
        visible: true,
        priceMinorUnits: 424242,
        createdAt: NOW - 120 * 24 * 60 * 60 * 1000,
      },
    ],
  };
}

describe("the privacy boundary", () => {
  it("carries no planted sensitive value into the serialised projection", () => {
    const owner = toPublicProjection(plantedSnapshot(), SEED, NOW, "owner");

    // Withheld — the public route — is still absolute: nothing planted in the
    // snapshot appears anywhere, counts included.
    const publicWire = serializeProjection(toPublicProjection(plantedSnapshot(), SEED, NOW));
    for (const [label, sentinel] of Object.entries(SENTINELS)) {
      expect(publicWire, `${label} leaked publicly`).not.toContain(sentinel);
    }
    for (const raw of ["8675309", "424242", "37"]) {
      expect(publicWire, `count ${raw} leaked publicly`).not.toContain(raw);
    }

    // For the owner the counts are the point. They cross, and they cross only
    // inside `metrics`: strip that block out and the wire is exactly as bare
    // as the public one.
    const wire = serializeProjection(owner);
    const parsed = JSON.parse(wire);
    expect(parsed.metrics.customers).toBe(8675309);
    expect(parsed.metrics.bestRate).toBe(37);

    const outsideMetrics = wire.replace(JSON.stringify(parsed.metrics), "");
    for (const [label, sentinel] of Object.entries(SENTINELS)) {
      expect(outsideMetrics, `${label} leaked`).not.toContain(sentinel);
    }
    for (const raw of ["8675309", "424242", "37", String(NOW), String(NOW - 90 * 24 * 60 * 60 * 1000)]) {
      expect(outsideMetrics, `raw value ${raw} leaked outside metrics`).not.toContain(raw);
    }

    // Money and identity never cross, for anyone, metrics or not.
    expect(wire).not.toContain("424242");
    for (const sentinel of Object.values(SENTINELS)) expect(wire).not.toContain(sentinel);
  });

  it("emits exactly the whitelisted keys and nothing else", () => {
    const wire = JSON.parse(serializeProjection(toPublicProjection(plantedSnapshot(), SEED, NOW)));

    expect(Object.keys(wire).sort()).toEqual(["districts", "freshness", "metrics", "schema", "seed"]);
    for (const district of wire.districts) {
      expect(Object.keys(district).sort()).toEqual([
        "direction",
        "id",
        "parcels",
        "signal",
        "state",
        "variant",
      ]);
    }
  });

  it("drops fields smuggled onto the projection object", () => {
    // Stands in for a future refactor attaching something for convenience.
    const contaminated = {
      ...toPublicProjection(plantedSnapshot(), SEED, NOW),
      accountId: SENTINELS.accountId,
      revenueCents: 5550317,
      capturedAt: NOW,
    } as unknown as PublicCityProjection;

    const wire = serializeProjection(contaminated);

    expect(wire).not.toContain(SENTINELS.accountId);
    expect(wire).not.toContain("5550317");
    expect(wire).not.toContain("capturedAt");
    expect(Object.keys(JSON.parse(wire)).sort()).toEqual([
      "districts",
      "freshness",
      "metrics",
      "schema",
      "seed",
    ]);
  });

  it("drops fields smuggled onto a district", () => {
    const base = toPublicProjection(plantedSnapshot(), SEED, NOW);
    const contaminated = {
      ...base,
      districts: base.districts.map((district) => ({
        ...district,
        productTitle: SENTINELS.title,
        memberCount: 8675309,
      })),
    } as unknown as PublicCityProjection;

    // Zeroed metrics, so the only route the planted count could take is the
    // smuggled district field this test is about.
    const wire = serializeProjection({ ...contaminated, metrics: ZERO_METRICS });

    expect(wire).not.toContain(SENTINELS.title);
    expect(wire).not.toContain("8675309");
  });

  it("refuses a value outside its declared domain rather than sending it", () => {
    const base = toPublicProjection(plantedSnapshot(), SEED, NOW);

    const badState = {
      ...base,
      districts: base.districts.map((d, i) => (i === 0 ? { ...d, state: "on fire" } : d)),
    } as unknown as PublicCityProjection;
    expect(() => serializeProjection(badState)).toThrow(ProjectionViolation);

    const badParcels = {
      ...base,
      districts: base.districts.map((d, i) => (i === 0 ? { ...d, parcels: 4096 } : d)),
    } as unknown as PublicCityProjection;
    expect(() => serializeProjection(badParcels)).toThrow(ProjectionViolation);

    // A raw account id smuggled in as the seed is not hex of the right length.
    expect(() => serializeProjection({ ...base, seed: SENTINELS.accountId })).toThrow(
      ProjectionViolation,
    );
  });

  it("produces only bucket words and bounded integers", () => {
    for (const scenario of FIXTURE_SCENARIOS) {
      const projection = toPublicProjection(fixtureSnapshot(scenario, NOW), SEED, NOW);
      for (const district of projection.districts) {
        expect(DISTRICT_STATES).toContain(district.state);
        expect(district.parcels).toBeGreaterThanOrEqual(2);
        expect(district.parcels).toBeLessThanOrEqual(5);
        expect(Number.isInteger(district.variant)).toBe(true);
      }
      // No floats anywhere: a float is the shape a measurement arrives in.
      const numbers = JSON.stringify(projection).match(/-?\d+\.\d+/g);
      expect(numbers, `scenario ${scenario} emitted a fractional value`).toBeNull();
    }
  });

  it("round-trips through the client-side parser", () => {
    const projection = toPublicProjection(fixtureSnapshot("balanced", NOW), SEED, NOW);
    expect(parseProjection(JSON.parse(serializeProjection(projection)))).toEqual(
      sealProjection(projection),
    );
  });

  it("renders every district dormant and unreadable when nothing can be read", () => {
    const projection = unavailableProjection(ANONYMOUS_SEED);
    expect(projection.freshness).toBe("unavailable");
    expect(projection.districts.map((d) => d.id)).toEqual([...DISTRICT_IDS]);
    for (const district of projection.districts) {
      expect(district.state).toBe("dormant");
      expect(district.signal).toBe("unreadable");
    }
  });
});

describe("the layout seed", () => {
  const SECRET = "a-deployment-secret-long-enough";

  it("never contains the account id it came from", async () => {
    const seed = await deriveLayoutSeed(SENTINELS.accountId, SECRET);
    expect(seed).not.toContain(SENTINELS.accountId);
    expect(seed).not.toContain("biz_");
    expect(seed).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is stable for the same business under the same secret", async () => {
    const a1 = await deriveLayoutSeed("biz_alpha", SECRET);
    const a2 = await deriveLayoutSeed("biz_alpha", SECRET);
    const b = await deriveLayoutSeed("biz_beta", SECRET);
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });

  it("differs for the same business under a different secret", async () => {
    const one = await deriveLayoutSeed("biz_alpha", SECRET);
    const other = await deriveLayoutSeed("biz_alpha", "another-secret-long-enough");
    expect(one).not.toBe(other);
    expect(other).toMatch(/^[0-9a-f]{16}$/);
  });

  it("refuses to derive an account-bound seed without a usable key", async () => {
    // There is no unkeyed path any more. An unkeyed digest of a short,
    // structured account id can be ground back to the business, so the only
    // answer here is to refuse and let the caller serve the unavailable city.
    for (const bad of [undefined, null, "", "   ", "too-short", 12345, {}]) {
      await expect(deriveLayoutSeed("biz_alpha", bad)).rejects.toBeInstanceOf(SeedSecretUnavailable);
      expect(isUsableSeedSecret(bad)).toBe(false);
    }
    expect(isUsableSeedSecret(SECRET)).toBe(true);
  });

  it("rejects a key that is only long enough once padded", async () => {
    await expect(deriveLayoutSeed("biz_alpha", "  short  ")).rejects.toBeInstanceOf(
      SeedSecretUnavailable,
    );
  });

  it("serialises neither the account id nor an unkeyed digest of it", async () => {
    // The digest an earlier version would have produced. If the code ever
    // regresses to the unkeyed path, this is the string that would appear.
    const material = new TextEncoder().encode(`whop-city/layout-seed/v2:${SENTINELS.accountId}`);
    const unkeyed = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", material)).slice(0, 8),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");

    const wire = serializeProjection(
      toPublicProjection(plantedSnapshot(), await deriveLayoutSeed(SENTINELS.accountId, SECRET), NOW),
    );

    expect(wire).not.toContain(SENTINELS.accountId);
    expect(wire).not.toContain(unkeyed);
  });
});

describe("state derivation", () => {
  const project = (scenario: Parameters<typeof fixtureSnapshot>[0]) =>
    toPublicProjection(fixtureSnapshot(scenario, NOW), SEED, NOW);

  it("puts the default scenario in the approved configuration", () => {
    const byId = Object.fromEntries(project("balanced").districts.map((d) => [d.id, d]));
    expect(byId["commerce-core"].state).toBe("healthy");
    expect(byId["offer-forge"].state).toBe("rising");
    expect(byId["creator-quarter"].state).toBe("healthy");
  });

  it("reads a shuttered business as struggling, not dormant", () => {
    const byId = Object.fromEntries(project("struggling").districts.map((d) => [d.id, d]));
    expect(byId["commerce-core"].state).toBe("struggling");
    // Nothing visible means nothing publicly busy, whatever the history.
    expect(byId["commerce-core"].signal).toBe("quiet");
  });

  it("reads an empty business as dormant rather than struggling", () => {
    const empty = toPublicProjection(
      { accountId: "biz_empty", capturedAt: NOW, reachable: true, products: [], plans: [] },
      SEED,
      NOW,
    );
    for (const district of empty.districts) {
      expect(district.state).toBe("dormant");
      expect(district.signal).toBe("unbuilt");
    }
  });

  it("is a pure function of snapshot, seed and clock", () => {
    const once = serializeProjection(project("thriving"));
    const twice = serializeProjection(project("thriving"));
    expect(once).toBe(twice);
  });
});

describe("the metrics block carries counts and nothing else", () => {
  const baseProjection = (): PublicCityProjection =>
    toPublicProjection(fixtureSnapshot("balanced", NOW), SEED, NOW);

  const owned = (over: Partial<CityMetrics> = {}): CityMetrics => ({
    customers: 12,
    products: 3,
    waysToBuy: 4,
    affiliates: 1,
    bestRate: 25,
    source: "owner",
    ...over,
  });

  it("emits exactly six fields, whatever is handed in", () => {
    const wire = sealProjection({
      ...baseProjection(),
      metrics: { ...owned(), title: "Founder tier", email: "a@b.c", revenue: 4200 } as CityMetrics,
    });
    expect(Object.keys(wire.metrics).sort()).toEqual([
      "affiliates",
      "bestRate",
      "customers",
      "products",
      "source",
      "waysToBuy",
    ]);
    expect(JSON.stringify(wire.metrics)).not.toMatch(/Founder|a@b\.c|4200/);
  });

  it("withholds the business's real figures unless the viewer owns them", () => {
    // The public route never marks the source as the owner, so the same
    // serializer that carries the numbers for an admin zeroes them for anyone
    // else. There is no second code path to get wrong.
    const wire = sealProjection({ ...baseProjection(), metrics: { ...owned(), source: "withheld" } });
    expect(wire.metrics).toEqual(ZERO_METRICS);
    expect(sealProjection({ ...baseProjection(), metrics: undefined as never }).metrics).toEqual(
      ZERO_METRICS,
    );
  });

  it("refuses a count that is not a count", () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "12" as never]) {
      expect(() =>
        sealProjection({ ...baseProjection(), metrics: owned({ customers: bad as number }) }),
      ).toThrow();
    }
    // A rate is a percentage and nothing else.
    expect(() => sealProjection({ ...baseProjection(), metrics: owned({ bestRate: 101 }) })).toThrow();
  });
});
