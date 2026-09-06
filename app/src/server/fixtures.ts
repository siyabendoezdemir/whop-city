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
import type { Sale } from "./sales";
import { NO_STATS, type BusinessStats } from "./stats";
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

/**
 * Invented stats to go with the invented business.
 *
 * The game runs on figures from the stats API, so a fixture business needs
 * fixture figures or every scenario reads as a founder with nothing. Each one
 * is shaped to put the advisor in a different corner: a business nobody can
 * find, one nobody buys from, one that is leaking members, one that is simply
 * working.
 */
export function fixtureStats(scenario: FixtureScenario): BusinessStats {
  switch (scenario) {
    case "blank":
      return NO_STATS;

    case "launch":
      // People arriving, nobody buying yet. The advisor should call it a page
      // problem rather than send them for more traffic.
      return {
        revenue: { now: 0, before: 0 },
        recurring: { now: 0, before: 0 },
        members: { now: 0, before: 0 },
        traffic: { now: 420, before: 260 },
        newMembers: { now: 0, before: 0 },
        churn: 0,
        refundRate: 0,
      };

    case "struggling":
      // Selling, and leaking members faster than it wins them.
      return {
        revenue: { now: 2_400, before: 3_900 },
        recurring: { now: 900, before: 1_600 },
        members: { now: 48, before: 71 },
        traffic: { now: 60, before: 140 },
        newMembers: { now: 4, before: 12 },
        churn: 0.28,
        refundRate: 0.04,
      };

    case "balanced":
      return {
        revenue: { now: 6_200, before: 5_400 },
        recurring: { now: 3_100, before: 2_700 },
        members: { now: 130, before: 118 },
        traffic: { now: 340, before: 300 },
        newMembers: { now: 18, before: 15 },
        churn: 0.05,
        refundRate: 0.02,
      };

    case "thriving":
      return {
        revenue: { now: 48_000, before: 39_000 },
        recurring: { now: 26_500, before: 21_000 },
        members: { now: 1_240, before: 1_060 },
        traffic: { now: 2_900, before: 2_400 },
        newMembers: { now: 190, before: 160 },
        churn: 0.03,
        refundRate: 0.01,
      };

    default:
      return NO_STATS;
  }
}

/**
 * Invented sales for the live feed.
 *
 * Generated from the scenario's own revenue so the feed is consistent with the
 * figures beside it — a thriving business gets a busy hour, a launch gets
 * nothing. Deterministic apart from the times, which are relative to `now` so
 * the feed always reads as having happened in the last few hours.
 *
 * These are fixtures and are labelled as such everywhere they appear. The one
 * scenario deliberately withholds them, so the interface's "could not read the
 * sales" state is reachable in a browser without breaking anything upstream.
 */
export function fixtureSales(scenario: FixtureScenario, now: number): Sale[] | undefined {
  if (scenario === "unavailable") return undefined;

  const shape: Record<string, { count: number; low: number; high: number; renewals: number }> = {
    blank: { count: 0, low: 0, high: 0, renewals: 0 },
    launch: { count: 0, low: 0, high: 0, renewals: 0 },
    struggling: { count: 3, low: 1_900, high: 4_900, renewals: 0.7 },
    balanced: { count: 8, low: 2_900, high: 9_900, renewals: 0.5 },
    thriving: { count: 14, low: 3_900, high: 29_900, renewals: 0.45 },
  };
  const plan = shape[scenario] ?? shape.balanced;

  const names = ["Starter", "Pro monthly", "Annual pass", "Coaching call", "Templates bundle"];
  const sales: Sale[] = [];
  for (let i = 0; i < plan.count; i++) {
    // A repeatable spread of amounts and gaps: no clock reads, no randomness.
    const mix = ((i * 37) % 100) / 100;
    sales.push({
      key: `fixture-sale-${scenario}-${i}`,
      cents: Math.round(plan.low + (plan.high - plan.low) * mix),
      at: now - (i * 41 + 3) * 60 * 1000,
      kind: mix < plan.renewals ? "renewal" : "first",
      product: names[i % names.length],
    });
  }
  return sales;
}
