import { describe, expect, it } from "vitest";

import type { BusinessSnapshot } from "../src/server/snapshot";
import { bucketToTier, toPublicProjection, unavailableProjection } from "../src/server/projection";

/**
 * Every sensitive value a snapshot can carry, planted with a recognisable
 * sentinel. If any of these reaches the serialised projection, the privacy
 * boundary has been breached and this suite fails.
 */
const SENTINELS = {
  accountId: "biz_SENTINEL_ACCOUNT",
  productId: "prod_SENTINEL_PRODUCT",
  productTitle: "SENTINEL Secret Product Name",
  planId: "plan_SENTINEL_PLAN",
  memberCount: 1337,
  price: 4242,
};

function loadedSnapshot(): BusinessSnapshot {
  return {
    accountId: SENTINELS.accountId,
    capturedAt: 1_700_000_000_000,
    reachable: true,
    products: [
      {
        id: SENTINELS.productId,
        title: SENTINELS.productTitle,
        visible: true,
        memberCount: SENTINELS.memberCount,
        affiliateEnabled: true,
        affiliatePercentage: 30,
        memberAffiliateEnabled: false,
        createdAt: 1_699_000_000_000,
        planType: "one_time",
      },
    ],
    plans: [
      {
        id: SENTINELS.planId,
        planType: "one_time",
        visible: true,
        priceMinorUnits: SENTINELS.price,
        createdAt: 1_699_000_000_000,
      },
    ],
  };
}

describe("the public projection boundary", () => {
  it("leaks no identifier, title, count, or price into the serialised output", () => {
    const serialised = JSON.stringify(toPublicProjection(loadedSnapshot()));

    expect(serialised).not.toContain(SENTINELS.accountId);
    expect(serialised).not.toContain(SENTINELS.productId);
    expect(serialised).not.toContain(SENTINELS.productTitle);
    expect(serialised).not.toContain(SENTINELS.planId);
    expect(serialised).not.toContain(String(SENTINELS.memberCount));
    expect(serialised).not.toContain(String(SENTINELS.price));
  });

  it("exposes no Whop object id prefix at all", () => {
    const serialised = JSON.stringify(toPublicProjection(loadedSnapshot()));
    for (const prefix of ["biz_", "prod_", "plan_", "app_", "user_", "ausr_"]) {
      expect(serialised).not.toContain(prefix);
    }
  });

  it("emits only the agreed keys, so a new sensitive field cannot slip in unnoticed", () => {
    const projection = toPublicProjection(loadedSnapshot());

    expect(Object.keys(projection).sort()).toEqual(
      ["capturedAt", "cityTier", "districts", "freshness", "schema", "skyPhase"].sort(),
    );
    for (const district of projection.districts) {
      expect(Object.keys(district).sort()).toEqual(
        ["blocks", "direction", "health", "id", "name", "signal", "tagline", "tier", "variant"].sort(),
      );
    }
  });

  it("always describes the three districts", () => {
    const projection = toPublicProjection(loadedSnapshot());
    expect(projection.districts.map((d) => d.id)).toEqual([
      "commerce-core",
      "offer-forge",
      "creator-quarter",
    ]);
  });

  it("is deterministic for the same business", () => {
    const a = JSON.stringify(toPublicProjection(loadedSnapshot()));
    const b = JSON.stringify(toPublicProjection(loadedSnapshot()));
    expect(a).toEqual(b);
  });
});

describe("honest rendering of an unreadable or empty business", () => {
  it("reports every district dormant and unreadable when nothing could be read", () => {
    const projection = unavailableProjection(1_700_000_000_000);

    expect(projection.freshness).toBe("unavailable");
    expect(projection.cityTier).toBe(0);
    for (const district of projection.districts) {
      expect(district.tier).toBe(0);
      expect(district.health).toBe(0);
      expect(district.direction).toBe("dormant");
      expect(district.signal).toBe("Unreadable");
    }
  });

  it("does not invent activity for a reachable but empty business", () => {
    const projection = toPublicProjection({
      accountId: "biz_empty",
      capturedAt: 1_700_000_000_000,
      reachable: true,
      products: [],
      plans: [],
    });

    expect(projection.freshness).toBe("live");
    for (const district of projection.districts) {
      expect(district.tier).toBe(0);
      expect(district.health).toBe(0);
      expect(district.signal).toBe("Unbuilt");
      expect(district.direction).toBe("dormant");
    }
  });

  it("never claims a trend it cannot see", () => {
    // No history store exists, so an established district with nothing new is
    // steady rather than cooling. "cooling" must not appear without evidence.
    const old = 1_600_000_000_000;
    const projection = toPublicProjection({
      accountId: "biz_old",
      capturedAt: 1_700_000_000_000,
      reachable: true,
      products: [
        {
          id: "prod_old",
          title: "old",
          visible: true,
          memberCount: 3,
          affiliateEnabled: false,
          affiliatePercentage: 0,
          memberAffiliateEnabled: false,
          createdAt: old,
          planType: "one_time",
        },
      ],
      plans: [],
    });

    const commerce = projection.districts.find((d) => d.id === "commerce-core");
    expect(commerce?.direction).toBe("steady");
  });
});

describe("tier bucketing", () => {
  it("hides the underlying count behind coarse buckets", () => {
    expect(bucketToTier(0)).toBe(0);
    expect(bucketToTier(1)).toBe(2);
    expect(bucketToTier(2)).toBe(3);
    expect(bucketToTier(4)).toBe(4);
    expect(bucketToTier(9)).toBe(5);
    expect(bucketToTier(10_000)).toBe(5);
  });

  it("maps many different counts onto the same tier, so the count is not recoverable", () => {
    const tiers = new Set([bucketToTier(20), bucketToTier(120), bucketToTier(9_999)]);
    expect(tiers.size).toBe(1);
  });
});
