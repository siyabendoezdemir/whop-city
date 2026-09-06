/**
 * The business, as four numbers and a few health signals.
 *
 * Read from Whop's stats API, which is the same place the creator's own
 * dashboard gets its figures. These are general to every business on the
 * platform — revenue, members, traffic, recurring — rather than counts of
 * whatever objects happen to exist, which is why product counts and commission
 * rates are gone: they described a shape of business rather than a business.
 *
 * Two things this file is careful about.
 *
 * **Scope.** Every query names the account it is about. The parameter is
 * optional in the API and omitting it means "whatever the credential defaults
 * to", which is a quiet way to read the wrong business — or, on a credential
 * that has more than one, an arbitrary one.
 *
 * **Zero is not silence.** A metric that cannot be read is `null`, never zero.
 * "No revenue" and "could not read revenue" are different facts, the city says
 * different things about them, and collapsing the two is how a working
 * business ends up looking at a row of noughts and concluding the game is
 * broken.
 */

import { apiOrigin, type Env } from "./whop-client";

/** How a metric arrives: a period column and a value column. */
type MetricRows = { columns?: string[] | null; data?: unknown };

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

/**
 * Did enough of the read work to draw a city.
 *
 * The four the game runs on. If none of them answered, this is a business we
 * could not look at rather than a business with nothing in it.
 */
export function statsReadable(stats: BusinessStats): boolean {
  return (
    stats.revenue !== null ||
    stats.recurring !== null ||
    stats.members !== null ||
    stats.traffic !== null
  );
}

const TIMEOUT_MS = 6_000;

/**
 * Pulls the value out of one row.
 *
 * The API documents rows as arrays matching `columns`, and its own schema
 * types them as objects. Both shapes are handled: an array takes its last
 * cell, an object is matched against the column names and otherwise takes the
 * last numeric value on it. Guessing wrong here reads as a flat zero, which is
 * indistinguishable from a real one at every layer above.
 */
function valueOf(row: unknown, columns: readonly string[] | null | undefined): number | null {
  if (Array.isArray(row)) {
    const cell = Number(row[row.length - 1]);
    return Number.isFinite(cell) ? cell : null;
  }
  if (typeof row !== "object" || row === null) return null;

  const record = row as Record<string, unknown>;
  const named = columns?.[columns.length - 1];
  if (named !== undefined && named in record) {
    const cell = Number(record[named]);
    if (Number.isFinite(cell)) return cell;
  }
  for (const key of ["value", "total", "amount", "count"]) {
    if (key in record) {
      const cell = Number(record[key]);
      if (Number.isFinite(cell)) return cell;
    }
  }
  const numbers = Object.values(record)
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry));
  return numbers.length > 0 ? numbers[numbers.length - 1] : null;
}

async function metric(
  env: Env,
  accountId: string | null,
  resource: string,
  granularity: "daily" | "monthly",
): Promise<Trend | null> {
  const origin = apiOrigin(env);
  if (!origin) return null;

  const url = new URL(`${origin}/api/v1/stats/metric`);
  url.searchParams.set("resource", resource);
  url.searchParams.set("granularity", granularity);
  if (accountId) url.searchParams.set("account_id", accountId);

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
    if (!Array.isArray(body?.data)) return null;
    if (body.data.length === 0) return { now: 0, before: null };

    // Rows come back oldest first, one per period.
    const values = body.data
      .map((row) => valueOf(row, body.columns))
      .filter((value): value is number => value !== null);
    if (values.length === 0) return null;

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
 *
 * @param accountId The business to read. Required in practice — see the note
 *   at the top of the file about what omitting it means.
 */
export async function readStats(env: Env, accountId: string | null): Promise<BusinessStats> {
  const [revenue, recurring, members, traffic, newMembers, churn, refunds] = await Promise.all([
    metric(env, accountId, "receipts:gross_revenue", "monthly"),
    metric(env, accountId, "mrr_history_records:monthly_recurring_revenue", "monthly"),
    metric(env, accountId, "vw_member_statuses:paid_active_members", "monthly"),
    metric(env, accountId, "events:traffic_people", "daily"),
    metric(env, accountId, "members:new_users", "monthly"),
    metric(env, accountId, "vw_member_statuses:churn_rate", "monthly"),
    metric(env, accountId, "receipts/refunds:refund_rate", "monthly"),
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
