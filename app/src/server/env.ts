/**
 * Where the deployment's bindings come from.
 *
 * Hosted Whop exposes them on the Worker env; `whop apps dev` exports them into
 * the node process. Both are merged so one code path serves both, with the
 * Worker env winning. Verified against both — see docs/website-auth-spike.md.
 *
 * This is the only source of account context in the app. Nothing here reads a
 * request, a query string, a header or a cookie, which is what makes it
 * impossible for a caller to choose whose city they are looking at.
 */

import type { Env } from "./whop-client";

export async function resolveEnv(): Promise<Env> {
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
