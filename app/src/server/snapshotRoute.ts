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
 *  - **live**, when the deployment bound an API origin;
 *  - **fixture**, only when the deployment explicitly asked for fixtures;
 *  - **nothing**, otherwise, which renders the unavailable city.
 *
 * The third case is the important one. Fixtures used to be the fallback, which
 * meant a hosted City whose binding was missing or renamed would answer with a
 * healthy invented business and label it "Reading the business now" — fabricated
 * state presented as real, on a public URL. Fixtures are now opt-in, so an
 * unconfigured deployment says it cannot read the business instead of making
 * one up.
 */

import { serializeProjection, unavailableProjection } from "../city/projection";
import { DEFAULT_SCENARIO, fixtureSnapshot, resolveScenario } from "./fixtures";
import { toPublicProjection } from "./project";
import { ANONYMOUS_SEED, deriveLayoutSeed } from "./seed";
import { captureSnapshot, emptySnapshot } from "./snapshot";
import { apiOrigin, type Env } from "./whop-client";

export const SNAPSHOT_PATH = "/api/city/snapshot";
export const SNAPSHOT_METHOD = "GET";

/**
 * Live only when the deployment actually gave us somewhere to read from.
 *
 * In local development there is no binding, so nothing outbound is attempted at
 * all — not a failed request, not a timeout, none.
 */
export function isLiveSource(env: Env): boolean {
  return apiOrigin(env) !== null;
}

/**
 * Fixtures are opt-in and local-only.
 *
 * `CITY_FIXTURES` is set in `.dev.vars`, which wrangler reads for the local
 * worker and never uploads, so a deployed City cannot turn this on by accident.
 */
export function isFixtureSource(env: Env): boolean {
  const flag = env.CITY_FIXTURES;
  return flag === true || flag === "1" || flag === "true";
}

/** The source this environment resolves to. Exported so tests can assert it. */
export function resolveSource(env: Env): "live" | "fixture" | "none" {
  if (isLiveSource(env)) return "live";
  return isFixtureSource(env) ? "fixture" : "none";
}

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // The projection is per-deployment and cheap to rebuild; caching it at a
      // shared edge would be a way to serve one business's city to another.
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function handleSnapshotRequest(request: Request, env: Env): Promise<Response> {
  if (request.method !== SNAPSHOT_METHOD) {
    return new Response(null, { status: 405, headers: { allow: SNAPSHOT_METHOD } });
  }

  const now = Date.now();
  const secret = typeof env.CITY_SEED_SECRET === "string" ? env.CITY_SEED_SECRET : null;

  try {
    const source = resolveSource(env);
    const snapshot =
      source === "live"
        ? await captureSnapshot(env)
        : source === "fixture"
          ? fixtureSnapshot(resolveScenario(new URL(request.url).searchParams.get("scenario")), now)
          : // No binding and no fixture opt-in: say so rather than invent a city.
            emptySnapshot(now);

    const seed = await deriveLayoutSeed(snapshot.accountId, secret);
    return jsonResponse(serializeProjection(toPublicProjection(snapshot, seed, now)));
  } catch {
    // Never surface the reason. An error string can carry a URL, an id, or a
    // fragment of an upstream response. The city renders honestly dormant.
    try {
      const seed = await deriveLayoutSeed(null, secret);
      return jsonResponse(serializeProjection(unavailableProjection(seed)));
    } catch {
      return jsonResponse(serializeProjection(unavailableProjection(ANONYMOUS_SEED)), 200);
    }
  }
}

/** Used by the route loader during SSR, where there is no Request to hand. */
export async function buildProjectionForEnv(env: Env, scenarioHint: string | null = null) {
  const now = Date.now();
  const secret = typeof env.CITY_SEED_SECRET === "string" ? env.CITY_SEED_SECRET : null;
  const source = resolveSource(env);
  const snapshot =
    source === "live"
      ? await captureSnapshot(env).catch(() => emptySnapshot(now))
      : source === "fixture"
        ? fixtureSnapshot(resolveScenario(scenarioHint ?? DEFAULT_SCENARIO), now)
        : emptySnapshot(now);
  const seed = await deriveLayoutSeed(snapshot.accountId, secret);
  return toPublicProjection(snapshot, seed, now);
}
