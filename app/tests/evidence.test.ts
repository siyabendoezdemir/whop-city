import { describe, expect, it } from "vitest";

import { EVIDENCE_OF, evidenceKind, readingFor, type EvidenceKind } from "../src/city/evidence";
import { DISTRICT_IDS, DISTRICT_STATES, type DistrictId } from "../src/city/projection";
import { toPublicProjection } from "../src/server/project";
import type { BusinessSnapshot, SnapshotPlan, SnapshotProduct } from "../src/server/snapshot";

/**
 * The copy is only honest if it matches the derivation that produced the state.
 *
 * Every case below builds a snapshot, runs the **real** server derivation over
 * it, and asserts the state that comes out is the one the evidence module
 * claims that observation produces. Change `server/project.ts` without changing
 * the readings and this fails, which is the point: a regex that bans digits
 * proves nothing about whether a sentence is true.
 */

const NOW = 1_780_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const OLD = NOW - 200 * DAY;
const NEW = NOW - 3 * DAY;
const SEED = "a7f3c1e90b6d84fa";

const product = (over: Partial<SnapshotProduct> = {}): SnapshotProduct => ({
  id: "prod_1",
  title: "t",
  visible: true,
  memberCount: 0,
  affiliateEnabled: false,
  affiliatePercentage: 0,
  memberAffiliateEnabled: false,
  createdAt: OLD,
  ...over,
});

const plan = (over: Partial<SnapshotPlan> = {}): SnapshotPlan => ({
  id: "plan_1",
  planType: "renewal",
  visible: true,
  priceMinorUnits: 0,
  createdAt: OLD,
  ...over,
});

const snapshot = (over: Partial<BusinessSnapshot> = {}): BusinessSnapshot => ({
  accountId: "biz_1",
  capturedAt: NOW,
  reachable: true,
  products: [],
  plans: [],
  ...over,
});

/** The state the real derivation produces for one district. */
function stateOf(id: DistrictId, input: BusinessSnapshot) {
  const projection = toPublicProjection(input, SEED, NOW);
  const district = projection.districts.find((entry) => entry.id === id);
  if (!district) throw new Error(`no ${id}`);
  return district;
}

/**
 * Each case: an observation, and the evidence class the copy claims it is.
 *
 * The two `mixed` entries per district are the whole reason the reading for
 * `struggling` names both explanations instead of picking one.
 */
const CASES: Array<{ id: DistrictId; kind: EvidenceKind; because: string; snapshot: BusinessSnapshot }> = [
  // --------------------------------------------------------- Commerce Core
  { id: "commerce-core", kind: "nothing", because: "no products at all", snapshot: snapshot() },
  {
    id: "commerce-core",
    kind: "mixed",
    because: "products exist, none marked visible",
    snapshot: snapshot({ products: [product({ visible: false, memberCount: 9 })] }),
  },
  {
    id: "commerce-core",
    kind: "mixed",
    because: "products visible, no members against any of them",
    snapshot: snapshot({ products: [product({ visible: true, memberCount: 0 })] }),
  },
  {
    id: "commerce-core",
    kind: "recent",
    because: "a visible product created inside the window",
    snapshot: snapshot({ products: [product({ visible: true, createdAt: NEW })] }),
  },
  {
    id: "commerce-core",
    kind: "working",
    because: "visible products with members, nothing new",
    snapshot: snapshot({ products: [product({ visible: true, memberCount: 12 })] }),
  },

  // ----------------------------------------------------------- Offer Forge
  { id: "offer-forge", kind: "nothing", because: "no plans at all", snapshot: snapshot() },
  {
    id: "offer-forge",
    kind: "mixed",
    because: "plans exist, none marked visible",
    snapshot: snapshot({ plans: [plan({ visible: false })] }),
  },
  {
    id: "offer-forge",
    kind: "mixed",
    because: "plans visible, none carrying a plan type",
    snapshot: snapshot({ plans: [plan({ visible: true, planType: null })] }),
  },
  {
    id: "offer-forge",
    kind: "recent",
    because: "a visible typed plan created inside the window",
    snapshot: snapshot({ plans: [plan({ visible: true, createdAt: NEW })] }),
  },
  {
    id: "offer-forge",
    kind: "working",
    because: "visible typed plans, nothing new",
    snapshot: snapshot({ plans: [plan({ visible: true })] }),
  },

  // ------------------------------------------------------- Creator Quarter
  {
    id: "creator-quarter",
    kind: "nothing",
    because: "no product has any affiliate setting on",
    snapshot: snapshot({ products: [product()] }),
  },
  {
    id: "creator-quarter",
    kind: "mixed",
    because: "buyer referrals only, open programme off",
    snapshot: snapshot({ products: [product({ memberAffiliateEnabled: true })] }),
  },
  {
    id: "creator-quarter",
    kind: "mixed",
    because: "open programme on at a zero rate",
    snapshot: snapshot({
      products: [product({ affiliateEnabled: true, affiliatePercentage: 0 })],
    }),
  },
  {
    id: "creator-quarter",
    kind: "recent",
    because: "affiliates on, product created inside the window",
    snapshot: snapshot({
      products: [product({ affiliateEnabled: true, affiliatePercentage: 25, createdAt: NEW })],
    }),
  },
  {
    id: "creator-quarter",
    kind: "working",
    because: "affiliates on at a real rate, nothing new",
    snapshot: snapshot({
      products: [product({ affiliateEnabled: true, affiliatePercentage: 25 })],
    }),
  },
];

describe("every reading matches the observation that produces it", () => {
  for (const { id, kind, because, snapshot: input } of CASES) {
    it(`${id}: ${because} reads as "${kind}"`, () => {
      const district = stateOf(id, input);
      expect(evidenceKind(district), `state was ${district.state}`).toBe(kind);
    });
  }

  it("covers every state the projection can produce", () => {
    for (const state of DISTRICT_STATES) expect(EVIDENCE_OF[state]).toBeTruthy();
    const covered = new Set(CASES.map((entry) => `${entry.id}:${entry.kind}`));
    for (const id of DISTRICT_IDS) {
      for (const kind of ["nothing", "mixed", "recent", "working"] as const) {
        expect(covered.has(`${id}:${kind}`), `${id}/${kind} is not exercised`).toBe(true);
      }
    }
  });
});

describe("the ambiguous state says it is ambiguous", () => {
  it("names both explanations wherever one observation has two", () => {
    // Proven above: two different snapshots produce `struggling` in each
    // district. A reading that picked one would be asserting a cause City
    // cannot see.
    for (const id of DISTRICT_IDS) {
      const mixed = CASES.filter((entry) => entry.id === id && entry.kind === "mixed");
      expect(mixed.length, `${id} should have two ways to be struggling`).toBe(2);

      const reading = readingFor({
        id,
        state: "struggling",
        direction: "cooling",
        signal: "quiet",
        parcels: 3,
        variant: 0,
      });
      expect(reading.ambiguity, `${id} struggling reading hides its ambiguity`).toBeTruthy();
      expect(reading.ambiguity).toMatch(/either|cannot tell/i);
    }
  });

  it("does not add an ambiguity note where the observation is unambiguous", () => {
    for (const id of DISTRICT_IDS) {
      for (const state of ["dormant", "healthy", "rising"] as const) {
        const reading = readingFor({
          id,
          state,
          direction: "steady",
          signal: "busy",
          parcels: 3,
          variant: 0,
        });
        expect(reading.ambiguity, `${id}/${state} invents an ambiguity`).toBeUndefined();
      }
    }
  });
});

describe("no reading claims something City did not observe", () => {
  const readings = DISTRICT_IDS.flatMap((id) =>
    DISTRICT_STATES.map((state) =>
      readingFor({ id, state, direction: "steady", signal: "busy", parcels: 3, variant: 0 }),
    ),
  ).flatMap((reading) => [reading.observed, reading.ambiguity ?? ""]);

  it("never describes the storefront, the buyer, or a purchase attempt", () => {
    // City reads the API. Everything in this list would require it to have
    // opened a browser, and it never does.
    for (const reading of readings) {
      expect(reading.toLowerCase()).not.toMatch(
        /\bbuyers? (cannot|can't|could not)\b|\blogged[- ]out\b|\bcheckout\b|\bstorefront\b|\bunreachable\b/,
      );
    }
  });

  it("attributes every positive claim to Whop rather than to City's judgement", () => {
    for (const reading of readings) {
      if (reading === "" || reading.startsWith("City could not read")) continue;
      if (reading.startsWith("That is either")) continue;
      expect(reading, `"${reading}" does not say who observed it`).toMatch(/^Whop reports/);
    }
  });
});
