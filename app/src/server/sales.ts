/**
 * Recent sales, for the live feed.
 *
 * The rest of the game runs on Whop's stats API, which reports whole days and
 * whole months. That is the right grain for "how big should this building be"
 * and the wrong grain for "somebody just bought something" — a monthly revenue
 * figure creeps up by a fraction and says nothing about what happened. This
 * reads the payments themselves, newest first, which is the only place on the
 * platform where an individual sale exists as an event.
 *
 * **What crosses the wire, and what does not.** A sale becomes four things: an
 * amount, a time, whether it was a first purchase or a renewal, and the product
 * name. No buyer. Not their name, not their email, not their id, not their
 * membership, not their country, not the payment id. The endpoint is behind an
 * owner session and the owner is entitled to all of it, but a feed of who
 * bought what is a different product with different obligations, and the game
 * does not need one to put a coin over a building.
 *
 * The dedupe key is a digest of the payment id rather than the id. The client
 * needs to know "same sale as last poll" and nothing more, and an upstream
 * identifier on the wire is an upstream identifier that can end up in a log.
 */

import { apiOrigin, type Env, type Read } from "./whop-client";

/** One sale, stripped to what a feed can honestly say about it. */
export type Sale = {
  /** Stable within a session. Not an upstream identifier. */
  readonly key: string;
  /** Settlement amount in whole cents, USD. */
  readonly cents: number;
  /** Epoch milliseconds. */
  readonly at: number;
  readonly kind: "first" | "renewal";
  readonly product: string | null;
};

const TIMEOUT_MS = 6_000;
const API_VERSION = "2026-09-02-2";
/** Enough to fill a feed after a quiet hour, few enough to stay cheap. */
const PAGE = 20;
/** Nothing older than this is news. */
export const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * A short, stable digest.
 *
 * Not a security boundary — it is a dedupe key for a list the caller already
 * owns. It exists so the identifier Whop uses does not become an identifier
 * this app publishes.
 */
export function digest(value: string): string {
  let hash = 2_166_136_261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

type PaymentRow = {
  id?: unknown;
  usd_total?: unknown;
  total?: unknown;
  paid_at?: unknown;
  created_at?: unknown;
  status?: unknown;
  billing_reason?: unknown;
  product?: unknown;
};

/** Whop reports times as ISO strings in some places and epoch seconds in others. */
function timeOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Seconds if it is small enough to be one; anything else is already ms.
    return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function nameOf(product: unknown): string | null {
  if (typeof product !== "object" || product === null) return null;
  const record = product as Record<string, unknown>;
  for (const key of ["title", "name"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim().slice(0, 48);
  }
  return null;
}

/**
 * Whop's billing reasons that mean "this one charged itself".
 *
 * The distinction is the whole point of showing it: a first purchase is
 * somebody the business persuaded, and a renewal is somebody it kept. They are
 * different achievements and the city says different things about them.
 *
 * Matched against a list rather than a pattern. `subscription_create` and
 * `subscription_cycle` differ by one word and mean opposite things, and a
 * regex loose enough to catch renewals was calling every new subscriber one.
 */
const RENEWAL_REASONS = new Set(["subscription_cycle", "subscription", "renewal"]);

function kindOf(reason: unknown): "first" | "renewal" {
  return typeof reason === "string" && RENEWAL_REASONS.has(reason.toLowerCase())
    ? "renewal"
    : "first";
}

/**
 * Turns one upstream row into a sale, or nothing.
 *
 * Exported so the shape handling is testable without a network. A row missing
 * an amount or a time is dropped rather than guessed at: a sale on the feed
 * for zero pounds at the epoch is worse than a sale that is not on the feed.
 */
export function toSale(row: unknown, now: number): Sale | null {
  if (typeof row !== "object" || row === null) return null;
  const record = row as PaymentRow;

  const id = typeof record.id === "string" ? record.id : null;
  if (id === null) return null;

  const amount = Number(record.usd_total ?? record.total);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const at = timeOf(record.paid_at) ?? timeOf(record.created_at);
  if (at === null) return null;
  // A clock skewed into the future would sit at the top of the feed forever.
  if (at > now + 60_000 || at < now - WINDOW_MS) return null;

  return {
    key: digest(id),
    cents: Math.round(amount * 100),
    at,
    kind: kindOf(record.billing_reason),
    product: nameOf(record.product),
  };
}

/**
 * The last day's sales for one business, newest first.
 *
 * `ok: false` is "we could not look" — no origin, a refusal, a timeout, a body
 * that was not a list. It is not "no sales", and the feed says so, because a
 * quiet day and a broken read look identical if you collapse them.
 */
export async function readSales(env: Env, accountId: string | null): Promise<Read<Sale[]>> {
  const origin = apiOrigin(env);
  if (!origin) return { ok: false };

  const now = Date.now();
  const url = new URL(`${origin}/api/v1/payments`);
  url.searchParams.set("first", String(PAGE));
  url.searchParams.set("order", "created_at");
  url.searchParams.set("direction", "desc");
  url.searchParams.set("created_after", new Date(now - WINDOW_MS).toISOString());
  // Named, always. Omitting it means "whatever the credential defaults to",
  // which on a credential that can read more than one business is a quiet way
  // to put somebody else's sales in this city's feed.
  if (accountId) url.searchParams.set("account_id", accountId);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const response = await fetch(url, {
      headers: { accept: "application/json", "Api-Version-Date": API_VERSION },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) return { ok: false };

    const body = (await response.json()) as { data?: unknown };
    if (!Array.isArray(body?.data)) return { ok: false };

    const sales = body.data
      .map((row) => toSale(row, now))
      .filter((sale): sale is Sale => sale !== null)
      .sort((a, b) => b.at - a.at);
    return { ok: true, data: sales };
  } catch {
    return { ok: false };
  }
}
