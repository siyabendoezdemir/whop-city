/**
 * The snapshot endpoint.
 *
 * One path, one method, one shape. `GET /api/city/snapshot` is the only thing
 * the browser is allowed to call, and this module is the only thing that
 * answers it.
 *
 * What the caller can influence: in fixture mode, which named fixture is built,
 * from a closed allowlist. That is all. There is no path, method, header, body,
 * account or origin the caller can reach, and in live mode the query string is
 * not read at all. The account always comes from the deployment binding.
 *
 * There are three sources, in this order:
 *
 *  - **live**, when the deployment bound an API origin *and* holds a usable
 *    seed key;
 *  - **fixture**, only when the deployment explicitly asked for fixtures;
 *  - **nothing**, otherwise, which renders the unavailable city.
 *
 * Every way this can go wrong ends in the same generic unavailable projection:
 * no key, a failed upstream read, a timeout, a non-OK status, a malformed body,
 * an unexpected throw. None of them produce a dormant-looking *live* city and
 * none of them put a reason on the wire, because a reason can carry a URL, an
 * id, or a fragment of an upstream response.
 */

import { serializeProjection, unavailableProjection } from "../city/projection";
import { fixtureSnapshot, fixtureStats } from "./fixtures";
import { DEFAULT_SCENARIO, resolveScenario } from "./scenarios";
import { toPublicProjection, type Audience } from "./project";
import { readStats } from "./stats";
import { viewerFor } from "./viewer";
import { ANONYMOUS_SEED, deriveLayoutSeed, fixtureSeed, isUsableSeedSecret } from "./seed";
import { captureSnapshot } from "./snapshot";
import { withSingleFlight } from "./snapshotCache";
import { apiOrigin, boundAppId, type Env } from "./whop-client";
import type { PublicCityProjection } from "../city/projection";

export const SNAPSHOT_PATH = "/api/city/snapshot";
export const SNAPSHOT_METHOD = "GET";

/**
 * Live only when the deployment gave us somewhere to read from *and* a key to
 * derive the layout seed with.
 *
 * The key is checked here, before any upstream work, so a misconfigured
 * deployment does not read a business it then cannot render. In local
 * development neither is present, so nothing outbound is attempted at all —
 * not a failed request, not a timeout, none.
 */
export function isLiveSource(env: Env): boolean {
  return apiOrigin(env) !== null && isUsableSeedSecret(env.CITY_SEED_SECRET);
}

/**
 * Fixtures need two things, and the first one is not a runtime value.
 *
 * The build must have been made with fixtures compiled in, which a deployable
 * build never is — see `fixtureGuard.ts`. `CITY_FIXTURES` on top of that is the
 * local opt-in. Relying on the binding alone was the hole: `.dev.vars` not
 * being uploaded is a convention, and a hosted deployment that acquired the
 * variable by any other route could have published an invented city as live.
 *
 * @param compiledIn Injectable so tests can exercise the production side of the
 *   guard. Production proof that it really is `false` in a deployable build is
 *   the bundle assertion in `tests/productionBuild.test.ts`.
 */
export function isFixtureSource(env: Env, compiledIn: boolean = __CITY_FIXTURES_BUILD__): boolean {
  if (!compiledIn) return false;
  const flag = env.CITY_FIXTURES;
  return flag === true || flag === "1" || flag === "true";
}

/** The source this environment resolves to. Exported so tests can assert it. */
export function resolveSource(
  env: Env,
  compiledIn: boolean = __CITY_FIXTURES_BUILD__,
): "live" | "fixture" | "none" {
  if (isLiveSource(env)) return "live";
  return isFixtureSource(env, compiledIn) ? "fixture" : "none";
}

/**
 * Which deployment a cache entry belongs to.
 *
 * Built from binding values only, never from anything a caller sends, so two
 * deployments cannot collide and a caller cannot select somebody else's entry.
 * `none` and fixture deployments get their own keys too, which keeps the fast
 * paths from sharing one slot with a live business.
 */
export function deploymentKey(env: Env, source: string): string {
  const parts = [
    source,
    typeof env.WHOP_API_ORIGIN === "string" ? env.WHOP_API_ORIGIN : "",
    boundAppId(env) ?? "",
    typeof env.WHOP_ACCOUNT_ID === "string" ? env.WHOP_ACCOUNT_ID : "",
  ];
  return parts.join("|");
}

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Private and unstored. The projection belongs to one business, and a
      // shared cache in front of this endpoint would be a way to serve one
      // business's city to another.
      "cache-control": "private, no-store, max-age=0",
      vary: "Cookie",
      "x-content-type-options": "nosniff",
    },
  });
}

/**
 * Builds the projection for this deployment.
 *
 * Throws nothing: every failure resolves to the unavailable projection, so the
 * value is safe to share between coalesced callers and safe to retain for the
 * cache's short window.
 */
async function buildProjection(
  env: Env,
  scenario: string | null,
  audience: Audience = "public",
  viewing: string | null = null,
): Promise<PublicCityProjection> {
  const source = resolveSource(env);

  if (source === "none") return unavailableProjection(ANONYMOUS_SEED);

  const now = Date.now();

  // The literal, not a function call: this is what lets the bundler see the
  // branch is dead in a deployable build and delete `fixtures.ts` with it.
  if (__CITY_FIXTURES_BUILD__ && source === "fixture") {
    // Not account-bound, so no key is needed and none is used.
    // Fixtures are invented data with no business behind them, so there is
    // nothing to withhold and the game is fully playable in dev. This branch
    // cannot exist in a production build — see the compile-time guard above.
    const picked = resolveScenario(scenario);
    return toPublicProjection(
      fixtureSnapshot(picked, now),
      // A seed of its own per scenario: the browser keys the saved city on it,
      // and one shared seed meant every fixture business inherited the last
      // one's city.
      fixtureSeed(picked),
      now,
      "owner",
      fixtureStats(picked),
    );
  }
  if (source === "fixture") return unavailableProjection(ANONYMOUS_SEED);

  const capture = await captureSnapshot(env);
  // A failed mandatory read is "we could not look", never "there is nothing
  // there". The second would be a lie told in the operator's own city.
  if (!capture.ok) return unavailableProjection(ANONYMOUS_SEED);

  const accountId = capture.snapshot.accountId;
  if (accountId === null) return unavailableProjection(ANONYMOUS_SEED);

  // isLiveSource already required a usable key, so this only throws if the
  // binding changed underneath us. Either way, fail closed.
  let seed: string;
  try {
    seed = await deriveLayoutSeed(accountId, env.CITY_SEED_SECRET);
  } catch {
    return unavailableProjection(ANONYMOUS_SEED);
  }

  // The stats read is what the game runs on, and it is separate from the
  // snapshot on purpose: a business with no products still has traffic, and a
  // stats node that will not answer should cost that one figure rather than
  // the whole city. It is only performed for a viewer entitled to the numbers,
  // and it names the business rather than letting the credential pick one.
  const stats = audience === "owner" ? await readStats(env, viewing ?? accountId) : undefined;
  return toPublicProjection(capture.snapshot, seed, now, audience, stats);
}

export async function handleSnapshotRequest(request: Request, env: Env): Promise<Response> {
  if (request.method !== SNAPSHOT_METHOD) {
    return new Response(null, { status: 405, headers: { allow: SNAPSHOT_METHOD } });
  }

  try {
    const source = resolveSource(env);
    // Only the fixture path reads the query string, and only to pick from a
    // closed allowlist. It is part of the key so two scenarios do not share an
    // entry during local visual work.
    const scenario =
      source === "fixture" ? resolveScenario(new URL(request.url).searchParams.get("scenario")) : null;

    // Who is asking decides whether the figures cross. Public unless Whop
    // vouches for an admin of this very business.
    const viewer = await viewerFor(request, env);
    const audience = viewer.audience;

    const projection = await withSingleFlight(
      // The audience and the business being read are both part of the key: an
      // owner's city and a visitor's city are different documents, and so are
      // two owners' cities, and none of them may share a cache entry.
      `${deploymentKey(env, source)}|${scenario ?? ""}|${audience}|${viewer.viewing ?? ""}`,
      () => buildProjection(env, scenario, audience, viewer.viewing),
      // An unavailable city is a failure with a face on it. Keeping it for the
      // window would pin a transient upstream problem in place; the next
      // request retries, while callers already waiting share this attempt.
      { retain: (projection) => projection.freshness !== "unavailable" },
    );

    return jsonResponse(serializeProjection(projection));
  } catch {
    // Never surface the reason. An error string can carry a URL, an id, or a
    // fragment of an upstream response.
    return jsonResponse(serializeProjection(unavailableProjection(ANONYMOUS_SEED)));
  }
}

/** Used by a route loader during SSR, where there is no Request to hand. */
export async function buildProjectionForEnv(
  env: Env,
  scenarioHint: string | null = null,
): Promise<PublicCityProjection> {
  try {
    return await buildProjection(env, scenarioHint ?? DEFAULT_SCENARIO);
  } catch {
    return unavailableProjection(ANONYMOUS_SEED);
  }
}
