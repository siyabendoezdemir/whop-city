/**
 * The live endpoint.
 *
 * `GET /api/city/live` is the small, frequent read: the four figures the game
 * runs on, and the sales behind them. The snapshot endpoint is the big
 * infrequent one — parcels, districts, freshness, the whole document — and it
 * is far too heavy to poll every few seconds. Splitting them is what lets the
 * city keep up with a business that is trading right now without turning a
 * fifteen-second refresh into a fan-out of twenty-seven upstream reads.
 *
 * Owner only, and it says so rather than quietly returning zeroes. A visitor
 * gets `{ live: false }` and nothing else: no figures, no sales, no timing, no
 * hint about whether the business is busy. The public city has never carried
 * business numbers and this does not become the route that does.
 *
 * Single-flighted and briefly cached on the same key discipline as the
 * snapshot, so ten tabs left open on a Monday morning are one upstream read
 * every few seconds rather than ten.
 */

import type { CityMetrics } from "../city/projection";
import { fixtureSales, fixtureStats } from "./fixtures";
import { metricsFrom } from "./project";
import { readSales, type Sale } from "./sales";
import { resolveScenario } from "./scenarios";
import { withSingleFlight } from "./snapshotCache";
import { readStats } from "./stats";
import { viewerFor } from "./viewer";
import { deploymentKey, resolveSource } from "./snapshotRoute";
import { readOwningAccountId, type Env } from "./whop-client";

export const LIVE_PATH = "/api/city/live";
export const LIVE_METHOD = "GET";

/**
 * How long a live read is reused.
 *
 * Shorter than the snapshot's, because the whole point of this endpoint is
 * that it is current, and long enough that a browser polling every fifteen
 * seconds and a second tab doing the same do not double the upstream load.
 */
export const LIVE_TTL_MS = 6_000;

export type LiveBody = {
  /** False for anyone the figures are not for. Nothing else is present. */
  readonly live: boolean;
  /** Server time the read settled, epoch ms. */
  readonly at?: number;
  readonly metrics?: CityMetrics;
  /** Newest first. Absent — not empty — when the sales read did not answer. */
  readonly sales?: readonly Sale[];
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // One business's takings. Never stored, never shared, never cached by
      // anything between here and the tab that asked.
      "cache-control": "private, no-store, max-age=0",
      vary: "Cookie",
      "x-content-type-options": "nosniff",
    },
  });
}

const CLOSED: LiveBody = { live: false };

async function readLive(env: Env, scenario: string | null, viewing: string | null): Promise<LiveBody> {
  const source = resolveSource(env);
  const now = Date.now();

  if (__CITY_FIXTURES_BUILD__ && source === "fixture") {
    const picked = resolveScenario(scenario);
    return {
      live: true,
      at: now,
      metrics: metricsFrom(fixtureStats(picked)),
      sales: fixtureSales(picked, now),
    };
  }
  if (source !== "live") return CLOSED;

  // The owning account, and nothing else. The snapshot's own capture would
  // answer this too, but it costs a fan-out of products, plans and per-product
  // affiliate details to do it — which is the exact cost this endpoint exists
  // to avoid paying every fifteen seconds.
  const account = await readOwningAccountId(env);
  if (!account.ok) return CLOSED;
  const accountId = viewing ?? account.data;

  // Independent: a business whose payments the credential cannot read should
  // still get live figures, and a stats node that will not answer should not
  // cost the feed.
  const [stats, sales] = await Promise.all([readStats(env, accountId), readSales(env, accountId)]);

  return {
    live: true,
    at: now,
    metrics: metricsFrom(stats),
    // Absent rather than empty when the read failed. "No sales today" and
    // "could not read sales" are different facts and the feed says which.
    ...(sales.ok ? { sales: sales.data } : {}),
  };
}

export async function handleLiveRequest(request: Request, env: Env): Promise<Response> {
  if (request.method !== LIVE_METHOD) {
    return new Response(null, { status: 405, headers: { allow: LIVE_METHOD } });
  }

  try {
    const source = resolveSource(env);
    // Fixtures are invented data with no business behind them, so there is
    // nothing to withhold and the feed is playable in dev without a sign-in.
    // The literal is what lets the bundler prove this branch cannot exist in a
    // deployable build — the same guard the snapshot route stands behind.
    const fixtures = __CITY_FIXTURES_BUILD__ && source === "fixture";

    const viewer = await viewerFor(request, env);
    // Before any upstream work. A visitor to a live deployment must not be able
    // to cost the business a read, let alone see what came back.
    if (!fixtures && viewer.audience !== "owner") return jsonResponse(CLOSED);

    const scenario = fixtures
      ? resolveScenario(new URL(request.url).searchParams.get("scenario"))
      : null;

    const body = await withSingleFlight(
      `live|${deploymentKey(env, source)}|${scenario ?? ""}|${viewer.audience}|${viewer.viewing ?? ""}`,
      () => readLive(env, scenario, viewer.viewing),
      {
        ttlMs: LIVE_TTL_MS,
        // A closed answer is a failure with a face on it; retrying costs one
        // request and pinning it costs the player their live city.
        retain: (value) => value.live,
      },
    );

    return jsonResponse(body);
  } catch {
    return jsonResponse(CLOSED);
  }
}
