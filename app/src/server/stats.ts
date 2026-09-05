/**
 * The business, as four numbers and a few health signals.
 *
 * Read from Whop's stats API, which is the same place the creator's own
 * dashboard gets its figures. These are general to every business on the
 * platform — revenue, members, traffic, recurring — rather than counts of
 * whatever objects happen to exist, which is why product counts and commission
 * rates are gone: they described a shape of business rather than a business.
 *
 * Every read is independent and every one may fail. A metric that cannot be
 * read is `null`, never zero: "no revenue" and "could not read revenue" are
 * different facts and the game says different things about them.
 */

import { apiOrigin, type Env } from "./whop-client";

/** How a metric arrives: a period column and a value column. */
type MetricRows = { columns: string[]; data: Array<Array<string | number>> };

export type Trend = {
  /** The most recent complete figure. */
  readonly now: number;
  /** The one before it, for "traffic fell" and "revenue is up". */
  readonly before: number | null;
};

export type BusinessStats = {
  readonly revenue: Trend | null;
  readonly recurring: Trend | null;
  readonly members: Trend | null;
  readonly traffic: Trend | null;
  /** Fraction, 0..1. */
  readonly churn: number | null;
  readonly refundRate: number | null;
  readonly newMembers: Trend | null;
};

export const NO_STATS: BusinessStats = {
  revenue: null,
  recurring: null,
  members: null,
  traffic: null,
  churn: null,
  refundRate: null,
  newMembers: null,
};

const TIMEOUT_MS = 6_000;

async function metric(env: Env, resource: string, granularity: "daily" | "monthly"): Promise<Trend | null> {
  const origin = apiOrigin(env);
  if (!origin) return null;

  const url = new URL(`${origin}/api/v1/stats/metric`);
  url.searchParams.set("resource", resource);
  url.searchParams.set("granularity", granularity);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const response = await fetch(url, {
      headers: { accept: "application/json", "Api-Version-Date": "2026-09-02-2" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) return null;

    const body = (await response.json()) as MetricRows;
    if (!Array.isArray(body?.data) || body.data.length === 0) return { now: 0, before: null };

    // Rows come back oldest first, one per period, as [period, value].
    const values = body.data
      .map((row) => Number(row[row.length - 1]))
      .filter((value) => Number.isFinite(value));
    if (values.length === 0) return { now: 0, before: null };

    return {
      now: Math.max(0, values[values.length - 1]),
      before: values.length > 1 ? Math.max(0, values[values.length - 2]) : null,
    };
  } catch {
    return null;
  }
}

/**
 * Everything the city runs on, in one fan-out.
 *
 * Independent on purpose: a business with no affiliate history should still
 * get a city, and one slow node should not cost the player their revenue
 * figure. Whatever comes back, comes back.
 */
export async function readStats(env: Env): Promise<BusinessStats> {
  const [revenue, recurring, members, traffic, newMembers, churn, refunds] = await Promise.all([
    metric(env, "receipts:gross_revenue", "monthly"),
    metric(env, "mrr_history_records:monthly_recurring_revenue", "monthly"),
    metric(env, "vw_member_statuses:paid_active_members", "monthly"),
    metric(env, "events:traffic_people", "daily"),
    metric(env, "members:new_users", "monthly"),
    metric(env, "vw_member_statuses:churn_rate", "monthly"),
    metric(env, "receipts/refunds:refund_rate", "monthly"),
  ]);

  return {
    revenue,
    recurring,
    members,
    traffic,
    newMembers,
    // Rates arrive as a fraction or a percentage depending on the metric; both
    // are clamped into 0..1 so nothing downstream has to guess.
    churn: churn === null ? null : Math.min(1, churn.now > 1 ? churn.now / 100 : churn.now),
    refundRate: refunds === null ? null : Math.min(1, refunds.now > 1 ? refunds.now / 100 : refunds.now),
  };
}
