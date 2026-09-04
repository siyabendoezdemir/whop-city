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
    const live = isLiveSource(env);
    const snapshot = live
      ? await captureSnapshot(env)
      : fixtureSnapshot(resolveScenario(new URL(request.url).searchParams.get("scenario")), now);

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
  const snapshot = isLiveSource(env)
    ? await captureSnapshot(env).catch(() => emptySnapshot(now))
    : fixtureSnapshot(resolveScenario(scenarioHint ?? DEFAULT_SCENARIO), now);
  const seed = await deriveLayoutSeed(snapshot.accountId, secret);
  return toPublicProjection(snapshot, seed, now);
}
