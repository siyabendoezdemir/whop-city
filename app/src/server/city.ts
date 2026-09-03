/**
 * The single server entry point for city data.
 *
 * The snapshot is captured here and discarded here. What crosses to the browser
 * is the projection and nothing else — the sensitive snapshot never enters a
 * return value, so it cannot be serialised into the page.
 */

import { createServerFn } from "@tanstack/react-start";

import { toPublicProjection, unavailableProjection, type CityProjection } from "./projection";
import { captureSnapshot } from "./snapshot";

type Env = Record<string, unknown>;

/**
 * Bindings live in different places in the two runtimes: hosted Whop exposes
 * them on the Worker env, and `whop apps dev` exports them into the node
 * process. Both are merged so one code path serves both, with the Worker env
 * winning. Verified against both — see docs/website-auth-spike.md.
 */
async function resolveEnv(): Promise<Env> {
  const merged: Env = {};

  try {
    const workers = (await import("cloudflare:workers")) as { env?: Record<string, unknown> };
    Object.assign(merged, workers.env ?? {});
  } catch {
    // Not running under workerd. The process fallback below covers it.
  }

  const nodeProcess = (globalThis as { process?: { env?: Record<string, unknown> } }).process;
  if (nodeProcess?.env) {
    for (const [key, value] of Object.entries(nodeProcess.env)) {
      if (merged[key] === undefined) merged[key] = value;
    }
  }

  return merged;
}

export const loadCityProjection = createServerFn({ method: "GET" }).handler(async (): Promise<CityProjection> => {
  try {
    const env = await resolveEnv();
    const snapshot = await captureSnapshot(env);
    return toPublicProjection(snapshot);
  } catch {
    // A failure here must not leak a message: an error string can carry a URL
    // or an identifier. The city renders honestly dark instead.
    return unavailableProjection(Date.now());
  }
});
