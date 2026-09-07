import type { CityMetrics } from "../city/projection";

/**
 * The live layer.
 *
 * Everything that turns "the numbers changed while you were looking at them"
 * into something the city can react to. Kept out of the components because it
 * is a small state machine with real rules — what counts as new, what counts
 * as news, what a run of sales adds up to — and rules buried in a `useEffect`
 * are rules nobody can test.
 *
 * The honesty rule that governs this file: nothing here invents an event. A
 * dispatch exists because a payment exists or because a figure Whop reports
 * moved. There is no queue of encouraging messages, no simulated tick, and
 * nothing that fires on a timer to make the city feel busy.
 */

export type Sale = {
  readonly key: string;
  readonly cents: number;
  readonly at: number;
  readonly kind: "first" | "renewal";
  readonly product: string | null;
};

export type LiveBody = {
  readonly live: boolean;
  readonly at?: number;
  readonly metrics?: CityMetrics;
  readonly sales?: readonly Sale[];
};

/** What the feed shows. One line, one thing that actually happened. */
export type Dispatch =
  | { readonly id: string; readonly at: number; readonly kind: "sale"; readonly sale: Sale }
  | {
      readonly id: string;
      readonly at: number;
      readonly kind: "member";
      /** Always positive: a member lost is not announced as good news. */
      readonly gained: number;
    }
  | {
      readonly id: string;
      readonly at: number;
      readonly kind: "visitors";
      readonly now: number;
      readonly before: number;
    }
  | {
      readonly id: string;
      readonly at: number;
      readonly kind: "level";
      readonly plot: string;
      readonly name: string;
      readonly level: number;
    };

/** Nothing older than this is on the feed, however quiet it has been. */
export const FEED_WINDOW_MS = 24 * 60 * 60 * 1000;
/** How many lines the feed keeps. */
export const FEED_LIMIT = 40;

export function parseLive(body: unknown): LiveBody {
  if (typeof body !== "object" || body === null) return { live: false };
  const record = body as Record<string, unknown>;
  if (record.live !== true) return { live: false };
  return {
    live: true,
    at: typeof record.at === "number" ? record.at : Date.now(),
    metrics: (record.metrics as CityMetrics | undefined) ?? undefined,
    sales: Array.isArray(record.sales) ? (record.sales as Sale[]).filter(isSale) : undefined,
  };
}

function isSale(value: unknown): value is Sale {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.key === "string" &&
    typeof record.cents === "number" &&
    typeof record.at === "number" &&
    (record.kind === "first" || record.kind === "renewal")
  );
}

/**
 * Sales in the reply that were not in the last one.
 *
 * Keyed rather than timed, because a payment's recorded time is not the time
 * it turns up in the API — a card that takes four seconds to settle arrives
 * with a timestamp four seconds in the past, and a purely time-based filter
 * either misses it or replays it forever.
 */
export function freshSales(sales: readonly Sale[], seen: ReadonlySet<string>): Sale[] {
  return sales.filter((sale) => !seen.has(sale.key)).sort((a, b) => a.at - b.at);
}

/**
 * Money that has arrived but has not been counted yet.
 *
 * The city's revenue figure comes from Whop's stats API, which reports whole
 * months and recomputes on its own schedule. The sales feed comes from the
 * payments list, which knows about a payment the moment it settles. So there
 * is a window — sometimes seconds, sometimes a good deal longer — where the
 * game can see the sale and cannot see the money: a card lands on the feed
 * saying $20, the revenue counter does not move, and the building that sale
 * just paid for does not offer itself. That reads as broken, and the player is
 * right that it is.
 *
 * This closes the window. `anchor` is the last rollup figure we believed, and
 * `cents` is everything the payments list has shown us since. The rollup stays
 * the source of truth and the credit only ever adds to it.
 *
 * It is not an estimate and it invents nothing: a paid payment is revenue that
 * exists, read from the same platform, and the only claim being made is that
 * the total has not caught up with its own parts yet.
 */
export type Takings = {
  /** The rollup figure the credit below is measured from. */
  readonly anchor: number;
  /** Cents of settled sales seen since the anchor was set. */
  readonly cents: number;
};

export const NO_TAKINGS: Takings = { anchor: 0, cents: 0 };

/** Adds sales the rollup has not accounted for. */
export function bank(takings: Takings, sales: readonly Sale[]): Takings {
  if (sales.length === 0) return takings;
  const cents = sales.reduce((sum, sale) => sum + Math.max(0, sale.cents), 0);
  return { anchor: takings.anchor, cents: takings.cents + cents };
}

/**
 * Reconciles the credit against a fresh rollup.
 *
 * Two things end a credit. The rollup catching up — once it reports at least
 * what we were claiming, it has absorbed the sales and holding them separately
 * would count them twice. And the rollup going backwards, which is the turn of
 * the month: a new period starts at nothing and last month's sales are not
 * this month's.
 *
 * A rollup that has absorbed *some* of the credit is left alone, because there
 * is no way to know which sales it took, and the total still has to end up
 * right. Anchoring to the new figure and keeping the full credit would double
 * whatever it did absorb.
 */
export function settle(takings: Takings, rollup: number): Takings {
  const claimed = takings.anchor + Math.round(takings.cents / 100);
  if (rollup < takings.anchor || rollup >= claimed) return { anchor: rollup, cents: 0 };
  return takings;
}

/**
 * The figures with the uncounted money in them.
 *
 * Never below the rollup: this is allowed to be ahead of Whop's total, because
 * it can see the receipts the total has not added up yet, and never behind it.
 */
export function withTakings(metrics: CityMetrics, takings: Takings): CityMetrics {
  if (metrics.source !== "owner" || takings.cents === 0) return metrics;
  const credited = takings.anchor + Math.round(takings.cents / 100);
  if (credited <= metrics.gold) return metrics;
  return { ...metrics, gold: credited };
}

/**
 * What changed between two readings, as feed lines.
 *
 * Only the movements a person would call news. Revenue is deliberately absent:
 * it is already on the feed one sale at a time, and reporting the total as well
 * would count the same twenty dollars twice.
 */
export function movements(
  before: CityMetrics | null,
  after: CityMetrics,
  at: number,
): Dispatch[] {
  if (!before || before.source !== "owner" || after.source !== "owner") return [];
  const out: Dispatch[] = [];

  const gained = after.citizens - before.citizens;
  if (gained > 0) {
    out.push({ id: `member-${at}`, at, kind: "member", gained });
  }

  // Traffic is a daily figure, so this fires when the day's count crosses a
  // round number rather than on every tick — otherwise a busy afternoon is a
  // hundred identical lines.
  const step = 100;
  if (Math.floor(after.traffic / step) > Math.floor(before.traffic / step)) {
    out.push({
      id: `visitors-${at}`,
      at,
      kind: "visitors",
      now: after.traffic,
      before: before.traffic,
    });
  }

  return out;
}

/** Newest first, deduplicated, trimmed to the window and the limit. */
export function mergeFeed(
  existing: readonly Dispatch[],
  incoming: readonly Dispatch[],
  now: number,
): Dispatch[] {
  const seen = new Set<string>();
  return [...incoming, ...existing]
    .filter((entry) => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return now - entry.at < FEED_WINDOW_MS;
    })
    .sort((a, b) => b.at - a.at)
    .slice(0, FEED_LIMIT);
}

/** Money, the way a feed line says it. */
export function amount(cents: number): string {
  const whole = cents / 100;
  if (whole >= 1000) return `$${(whole / 1000).toFixed(whole >= 10_000 ? 0 : 1)}k`;
  return whole % 1 === 0 ? `$${whole}` : `$${whole.toFixed(2)}`;
}

/** "just now", "4m", "2h" — short enough to sit on a card. */
export function ago(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

/** What the feed says happened, in one line. */
export function headline(entry: Dispatch): string {
  switch (entry.kind) {
    case "sale":
      return entry.kind === "sale" && entry.sale.kind === "renewal"
        ? `${amount(entry.sale.cents)} renewed`
        : `${amount(entry.sale.cents)} sale`;
    case "member":
      return entry.gained === 1 ? "New member" : `${entry.gained} new members`;
    case "visitors":
      return `${entry.now} visitors today`;
    case "level":
      return `${entry.name} reached level ${entry.level}`;
  }
}

/** The detail under the headline, when there is one worth having. */
export function detail(entry: Dispatch): string | null {
  switch (entry.kind) {
    case "sale":
      return entry.sale.product;
    case "member":
      return "They are living in your city now";
    case "visitors":
      return entry.now > entry.before ? "Traffic is climbing" : null;
    case "level":
      return "Built";
  }
}
