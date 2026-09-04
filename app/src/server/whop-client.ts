/**
 * The only place City talks to Whop.
 *
 * Every call is a named function with a literal method and a literal path.
 * There is no generic request helper exported, no caller-supplied path, and no
 * way to reach an endpoint that is not written in this file. Adding a Whop
 * operation is a code change and a review, which is the point.
 *
 * Everything here is GET. There is no non-GET function, so no product route can
 * reach a payment, payout, transfer, account, team, OAuth-config or app-config
 * action — not behind a flag, not behind a session.
 *
 * City never holds a credential. The hosted Website runtime attaches the app's
 * key in an outbound proxy, so there is no `Authorization` header anywhere in
 * this file and no code path that reads a key.
 *
 * Every reader returns a `Read<T>` rather than a bare value. A failed request
 * and an empty result are different facts about the business and the city
 * renders them differently, so they must not collapse into the same `[]` on the
 * way up. See `snapshot.ts`.
 */

const API_VERSION = "2026-09-02-2";
const REQUEST_TIMEOUT_MS = 8_000;
const PAGE_SIZE = 100;

export type Env = Record<string, unknown>;

/**
 * The outcome of one upstream read.
 *
 * `ok: false` means we do not know, for any reason — refused connection,
 * timeout, non-OK status, unparseable body. It never means "nothing there".
 */
export type Read<T> = { ok: true; data: T } | { ok: false };

const FAILED: Read<never> = { ok: false };

/**
 * Hosts this deployment is willing to call.
 *
 * `api.whop.com` is the documented API host and the only one City needs. The
 * bare `whop.com` apex used to be permitted here and is not an API host at all
 * — it is the marketplace website — so it is gone.
 *
 * Subdomains stay permitted because the hosted Website runtime supplies
 * `WHOP_API_ORIGIN` itself and its exact value is not documented; pinning to
 * the single literal would risk breaking live reads on a deployment, and that
 * cannot be verified without a live probe. Narrowing this to one host is a
 * follow-up for the first deployment that observes the real value.
 */
const API_HOST = "api.whop.com";
const API_DOMAIN_SUFFIX = ".whop.com";

function isPermittedApiHost(hostname: string): boolean {
  // Note the leading dot: "api.whop.com.evil.example" does not end with it, and
  // neither does "notwhop.com".
  return hostname === API_HOST || hostname.endsWith(API_DOMAIN_SUFFIX);
}

/**
 * Resolves the API origin from the hosted binding, and only from it.
 *
 * Returning null is the normal case in local development and means no outbound
 * request will be attempted at all.
 */
export function apiOrigin(env: Env): string | null {
  const hosted = env.WHOP_API_ORIGIN;
  if (typeof hosted !== "string" || hosted.length === 0) return null;
  try {
    const url = new URL(hosted);
    if (url.protocol !== "https:") return null;
    if (!isPermittedApiHost(url.hostname)) return null;
    // An origin with credentials, a path or a query in it is a misconfiguration
    // at best, so it is refused rather than normalised away.
    if (url.username || url.password || url.search || (url.pathname && url.pathname !== "/")) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

/** Not exported. Internal to the named readers below. */
async function readJson<T>(env: Env, path: string): Promise<Read<T>> {
  const origin = apiOrigin(env);
  if (origin === null) return FAILED;
  try {
    const response = await fetch(`${origin}${path}`, {
      method: "GET",
      headers: { "Api-Version-Date": API_VERSION },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    // Includes 401 and 403: an authorization failure is a thing we could not
    // read, never a business with nothing in it.
    if (!response.ok) return FAILED;
    try {
      return { ok: true, data: (await response.json()) as T };
    } catch {
      // Malformed or truncated body. We have no idea what is there.
      return FAILED;
    }
  } catch {
    // Refused, DNS, TLS, abort on timeout.
    return FAILED;
  }
}

export type WhopProduct = {
  id: string;
  title: string | null;
  visibility: string | null;
  member_count: number | null;
  created_at: string | null;
  default_plan: { id: string; plan_type: string | null } | null;
};

export type WhopProductDetail = WhopProduct & {
  global_affiliate_status: string | null;
  global_affiliate_percentage: number | null;
  member_affiliate_status: string | null;
};

export type WhopPlan = {
  id: string;
  plan_type: string | null;
  visibility: string | null;
  created_at: string | null;
  initial_price: { amount: string | null; currency: string | null } | null;
};

type Page<T> = { data?: T[] };

/**
 * A page that came back successfully but carried nothing is a real answer: the
 * business has no products. Only a failed read is a failure.
 */
function page<T>(read: Read<Page<T>>): Read<T[]> {
  return read.ok ? { ok: true, data: read.data?.data ?? [] } : FAILED;
}

/**
 * GET /api/v1/products?account_id=…
 *
 * `account_id` is not optional in practice. Omitting it does not error — it
 * silently searches the public marketplace and hands back other people's
 * products, which a city would then render as the business's own. The parameter
 * is required here so that mistake cannot recur.
 */
export async function readProducts(env: Env, accountId: string): Promise<Read<WhopProduct[]>> {
  return page(
    await readJson<Page<WhopProduct>>(
      env,
      `/api/v1/products?account_id=${encodeURIComponent(accountId)}&first=${PAGE_SIZE}`,
    ),
  );
}

/** GET /api/v1/plans?account_id=… — `account_id` is required or the API 400s. */
export async function readPlans(env: Env, accountId: string): Promise<Read<WhopPlan[]>> {
  return page(
    await readJson<Page<WhopPlan>>(
      env,
      `/api/v1/plans?account_id=${encodeURIComponent(accountId)}&first=${PAGE_SIZE}`,
    ),
  );
}

/**
 * GET /api/v1/products/{id}
 *
 * The list response omits the affiliate fields entirely; they exist only on the
 * single-product read, which is why the snapshot bounds how many it asks for.
 */
export async function readProductDetail(
  env: Env,
  productId: string,
): Promise<Read<WhopProductDetail>> {
  return readJson<WhopProductDetail>(env, `/api/v1/products/${encodeURIComponent(productId)}`);
}

/**
 * GET /api/v1/apps/{id}
 *
 * Used only to learn which business the deployment belongs to. A Blueprint
 * deployment belongs to a different business every time, so the app record is
 * the reliable source when `WHOP_ACCOUNT_ID` is absent.
 *
 * This is the only place an account is chosen, and it is chosen from bindings.
 * No caller can pass one in.
 */
export async function readOwningAccountId(env: Env): Promise<Read<string>> {
  const bound = env.WHOP_ACCOUNT_ID;
  if (typeof bound === "string" && bound.length > 0) return { ok: true, data: bound };

  const appId = typeof env.APP_ID === "string" ? env.APP_ID : null;
  if (!appId) return FAILED;

  const app = await readJson<{ account?: { id?: string } }>(
    env,
    `/api/v1/apps/${encodeURIComponent(appId)}`,
  );
  if (!app.ok) return FAILED;

  const id = app.data?.account?.id;
  // A 200 with no account on it tells us the deployment is not wired to a
  // business. That is not a business with nothing in it either.
  return typeof id === "string" && id.length > 0 ? { ok: true, data: id } : FAILED;
}
