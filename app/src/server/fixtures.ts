/**
 * Deterministic fixtures.
 *
 * The production route runs on these until live reads are wired in a later
 * increment, and they stay afterwards as the thing the visual and browser tests
 * point at. A test that depends on a real business is not a test.
 *
 * Each scenario is a `BusinessSnapshot` — the sensitive shape — so the fixtures
 * exercise the real projection code path rather than short-circuiting it. What
 * reaches the browser has been through exactly the same boundary as live data
 * would be, which is the only way the boundary is actually under test.
 *
 * Timestamps are expressed as offsets from a supplied `now` so a scenario means
 * the same thing whenever it runs.
 *
 * This module is unreachable in a deployable build. The only branch that calls
 * `fixtureSnapshot` sits behind `__CITY_FIXTURES_BUILD__`, which compiles to
 * `false`, so the bundler drops the branch and this file with it. The scenario
 * *names* live in `scenarios.ts` precisely so nothing outside a fixture build
 * has a reason to import this one.
 */

import type { FixtureScenario } from "./scenarios";
import type { BusinessSnapshot, SnapshotPlan, SnapshotProduct } from "./snapshot";

const DAY = 24 * 60 * 60 * 1000;

function product(
  index: number,
  options: Partial<SnapshotProduct> & { ageDays: number },
): SnapshotProduct {
  return {
    id: `fixture_product_${index}`,
    title: `Fixture product ${index}`,
    visible: true,
    memberCount: 0,
    affiliateEnabled: false,
    affiliatePercentage: 0,
    memberAffiliateEnabled: false,
    createdAt: -options.ageDays * DAY,
    ...options,
    // Age is applied by the caller against `now`; keep the marker consistent.
    ...(options.createdAt !== undefined ? { createdAt: options.createdAt } : {}),
  };
}

function plan(index: number, options: Partial<SnapshotPlan> & { ageDays: number }): SnapshotPlan {
  return {
    id: `fixture_plan_${index}`,
    planType: "renewal",
    visible: true,
    priceMinorUnits: 0,
    createdAt: -options.ageDays * DAY,
    ...options,
  };
}

/** Shifts the relative `createdAt` markers onto the real clock. */
function anchor(snapshot: BusinessSnapshot, now: number): BusinessSnapshot {
  const shift = <T extends { createdAt: number | null }>(item: T): T =>
    item.createdAt === null ? item : { ...item, createdAt: now + item.createdAt };
  return {
    ...snapshot,
    capturedAt: now,
    products: snapshot.products.map(shift),
    plans: snapshot.plans.map(shift),
  };
}

function build(scenario: FixtureScenario): BusinessSnapshot {
  const base: BusinessSnapshot = {
    accountId: `fixture_account_${scenario}`,
    capturedAt: 0,
    reachable: true,
    products: [],
    plans: [],
  };

  switch (scenario) {
    case "blank":
      // A business that has just been created. Every district dormant, which
      // is the only way to reach the "decide what goes here" activities.
      return base;

    case "unavailable":
      return { ...base, accountId: null, reachable: false };

    case "launch":
      // Days old, nothing sold yet. Everything is going up.
      return {
        ...base,
        products: [product(1, { ageDays: 3 }), product(2, { ageDays: 1 })],
        plans: [plan(1, { ageDays: 2 })],
      };

    case "thriving":
      return {
        ...base,
        products: [
          product(1, { ageDays: 400, memberCount: 180, affiliateEnabled: true, affiliatePercentage: 30 }),
          product(2, { ageDays: 320, memberCount: 96, affiliateEnabled: true, affiliatePercentage: 25 }),
          product(3, { ageDays: 260, memberCount: 54, memberAffiliateEnabled: true }),
          product(4, { ageDays: 180, memberCount: 31, affiliateEnabled: true, affiliatePercentage: 20 }),
          product(5, { ageDays: 120, memberCount: 22, memberAffiliateEnabled: true }),
        ],
        plans: [
          plan(1, { ageDays: 400 }),
          plan(2, { ageDays: 380, planType: "one_time" }),
          plan(3, { ageDays: 300, planType: "renewal" }),
          plan(4, { ageDays: 200, planType: "expiration" }),
        ],
      };

    case "struggling":
      // Built, then shuttered: products exist but none are visible, plans are
      // hidden, and nobody is affiliating. This is the state that has to read
      // as a real place going wrong rather than an empty one.
      return {
        ...base,
        products: [
          product(1, { ageDays: 500, visible: false, memberCount: 4 }),
          product(2, { ageDays: 430, visible: false, memberCount: 0 }),
          product(3, { ageDays: 380, visible: false, memberCount: 1 }),
        ],
        plans: [plan(1, { ageDays: 500, visible: false }), plan(2, { ageDays: 470, visible: false })],
      };

    case "balanced":
    default:
      // The approved default: an established shopfront, a pricing surface that
      // has just been reworked, and a modest affiliate presence.
      return {
        ...base,
        products: [
          product(1, { ageDays: 240, memberCount: 64, affiliateEnabled: true, affiliatePercentage: 22 }),
          product(2, { ageDays: 180, memberCount: 28, memberAffiliateEnabled: true }),
          product(3, { ageDays: 90, memberCount: 11 }),
        ],
        plans: [
          plan(1, { ageDays: 6 }),
          plan(2, { ageDays: 4, planType: "one_time" }),
          plan(3, { ageDays: 2, planType: "expiration" }),
        ],
      };
  }
}

export function fixtureSnapshot(scenario: FixtureScenario, now: number = Date.now()): BusinessSnapshot {
  return anchor(build(scenario), now);
}
