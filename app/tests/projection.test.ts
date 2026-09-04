import { describe, expect, it } from "vitest";

import {
  DISTRICT_IDS,
  DISTRICT_STATES,
  ProjectionViolation,
  parseProjection,
  sealProjection,
  serializeProjection,
  unavailableProjection,
  type PublicCityProjection,
} from "../src/city/projection";
import { FIXTURE_SCENARIOS, fixtureSnapshot } from "../src/server/fixtures";
import { toPublicProjection } from "../src/server/project";
import { ANONYMOUS_SEED, deriveLayoutSeed } from "../src/server/seed";
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
    const wire = serializeProjection(toPublicProjection(plantedSnapshot(), SEED, NOW));

    for (const [label, sentinel] of Object.entries(SENTINELS)) {
      expect(wire, `${label} leaked`).not.toContain(sentinel);
    }
    // The raw numbers behind the buckets, in every plausible rendering.
    for (const raw of ["8675309", "424242", "37", String(NOW), String(NOW - 90 * 24 * 60 * 60 * 1000)]) {
      expect(wire, `raw value ${raw} leaked`).not.toContain(raw);
    }
  });

  it("emits exactly the whitelisted keys and nothing else", () => {
    const wire = JSON.parse(serializeProjection(toPublicProjection(plantedSnapshot(), SEED, NOW)));

    expect(Object.keys(wire).sort()).toEqual(["districts", "freshness", "schema", "seed"]);
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
    expect(Object.keys(JSON.parse(wire)).sort()).toEqual(["districts", "freshness", "schema", "seed"]);
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

    const wire = serializeProjection(contaminated);

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
  it("never contains the account id it came from", async () => {
    const seed = await deriveLayoutSeed(SENTINELS.accountId, null);
    expect(seed).not.toContain(SENTINELS.accountId);
    expect(seed).not.toContain("biz_");
    expect(seed).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is stable for the same business and different across businesses", async () => {
    const a1 = await deriveLayoutSeed("biz_alpha", null);
    const a2 = await deriveLayoutSeed("biz_alpha", null);
    const b = await deriveLayoutSeed("biz_beta", null);
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });

  it("changes with the deployment secret, so an unkeyed digest cannot be precomputed", async () => {
    const unkeyed = await deriveLayoutSeed("biz_alpha", null);
    const keyed = await deriveLayoutSeed("biz_alpha", "deployment-secret");
    const other = await deriveLayoutSeed("biz_alpha", "another-secret");
    expect(keyed).not.toBe(unkeyed);
    expect(keyed).not.toBe(other);
    expect(keyed).toMatch(/^[0-9a-f]{16}$/);
  });

  it("has a stable inert seed when there is no account", async () => {
    expect(await deriveLayoutSeed(null, null)).toBe(ANONYMOUS_SEED);
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
