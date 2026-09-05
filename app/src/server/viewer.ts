/**
 * Who is looking, and are they allowed to see the numbers.
 *
 * Whop renders an app inside an iframe on its own domain and attaches a
 * short-lived signed token to every same-origin request. Verifying it server
 * side is the whole of the authentication story: no OAuth, no redirect URIs,
 * no session of our own to get wrong, and no credential ever in the browser.
 *
 * Two things have to be true before a real figure crosses the wire:
 *
 *   the token is genuinely Whop's, signed ES256 against their published keys
 *   and issued for *this* app rather than some other one, and
 *
 *   the user it names is an admin of the very business this deployment is
 *   bound to — not a member of it, not an admin of a different one.
 *
 * Anything less is the public view, which carries no figures at all. There is
 * no third state and no way to ask for one.
 */

import { createRemoteJWKSet, jwtVerify } from "jose";

import { apiOrigin, boundAppId, readOwningAccountId, type Env } from "./whop-client";

const JWKS_PATH = "/.well-known/jwks.json";
const TOKEN_HEADER = "x-whop-user-token";
const CHECK_TIMEOUT_MS = 5_000;

/**
 * Cached per origin.
 *
 * `createRemoteJWKSet` does its own caching and honours the key set's
 * cache headers; what this avoids is building a fresh fetcher, and therefore
 * a fresh cache, on every single request.
 */
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function keysFor(origin: string) {
  const existing = keySets.get(origin);
  if (existing) return existing;
  const created = createRemoteJWKSet(new URL(`${origin}${JWKS_PATH}`));
  keySets.set(origin, created);
  return created;
}

/** What a key resolver looks like, so tests can supply their own. */
export type KeyResolver = Parameters<typeof jwtVerify>[1];

/**
 * The user Whop says is looking, or null. Never throws.
 *
 * `keys` exists for tests: the real path always resolves Whop's published set
 * from the API origin, and nothing in a request can redirect it.
 */
export async function verifyViewer(
  request: Request,
  env: Env,
  keys?: KeyResolver,
): Promise<string | null> {
  const token = request.headers.get(TOKEN_HEADER);
  if (!token) return null;

  const origin = apiOrigin(env);
  const appId = boundAppId(env);
  if (!origin || !appId) return null;

  try {
    const { payload } = await jwtVerify(token, keys ?? keysFor(origin), {
      algorithms: ["ES256"],
      // A token minted for another app is not a token for this one.
      audience: appId,
    });
    const subject = payload.sub;
    return typeof subject === "string" && subject.length > 0 ? subject : null;
  } catch {
    return null;
  }
}

/**
 * Does this user run this business.
 *
 * The resource is the account the deployment is bound to, resolved the same
 * way everything else resolves it — from the bindings, never from the request
 * — so a caller cannot ask about a business they happen to administer
 * elsewhere and be handed this one's figures.
 */
export async function isAdminOf(userId: string, env: Env): Promise<boolean> {
  const origin = apiOrigin(env);
  if (!origin) return false;

  const account = await readOwningAccountId(env);
  if (!account.ok) return false;

  const url = `${origin}/api/v1/users/${encodeURIComponent(userId)}/access/${encodeURIComponent(account.data)}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
    const response = await fetch(url, {
      headers: { accept: "application/json", "Api-Version-Date": "2026-09-02-2" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) return false;

    const body = (await response.json()) as { access_level?: unknown };
    // Only admin. A customer of the business is not entitled to its books.
    return body?.access_level === "admin";
  } catch {
    return false;
  }
}

/**
 * The audience for this request.
 *
 * Public unless proven otherwise, and proving otherwise takes both a valid
 * token and an admin check. Every failure — no header, bad signature, wrong
 * app, unreachable check — lands on public, because the safe answer and the
 * error answer have to be the same one.
 */
export async function audienceFor(
  request: Request,
  env: Env,
  keys?: KeyResolver,
): Promise<"public" | "owner"> {
  const userId = await verifyViewer(request, env, keys);
  if (!userId) return "public";
  return (await isAdminOf(userId, env)) ? "owner" : "public";
}
