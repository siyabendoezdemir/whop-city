/**
 * The only place City talks to Whop.
 *
 * Ported from the halted vertical slice, which is the one part of it worth
 * keeping. Every call is a named function with a literal method and a literal
 * path. There is no generic request helper exported, no caller-supplied path,
 * and no way to reach an endpoint that is not written in this file. Adding a
 * Whop operation is a code change and a review, which is the point.
 *
 * Everything here is GET. There is no non-GET function, so no product route can
 * reach a payment, payout, transfer, account, team, OAuth-config or app-config
 * action — not behind a flag, not behind a session.
 *
 * City never holds a credential. The hosted Website runtime attaches the app's
 * key in an outbound proxy, so there is no `Authorization` header anywhere in
 * this file and no code path that reads a key. The dev-time proxy the previous
 * slice carried has been dropped: the origin now comes from the hosted binding
 * or nothing happens at all.
 */

const API_VERSION = "2026-09-02-2";
const REQUEST_TIMEOUT_MS = 8_000;
const PAGE_SIZE = 100;

export type Env = Record<string, unknown>;

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
    const isWhop = url.hostname === "whop.com" || url.hostname.endsWith(".whop.com");
    return url.protocol === "https:" && isWhop ? url.origin : null;
  } catch {
    return null;
  }
}

/** Not exported. Internal to the named readers below. */
async function readJson<T>(env: Env, path: string): Promise<T | null> {
  const origin = apiOrigin(env);
  if (origin === null) return null;
  try {
    const response = await fetch(`${origin}${path}`, {
      method: "GET",
      headers: { "Api-Version-Date": API_VERSION },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
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
 * GET /api/v1/products?account_id=…
 *
 * `account_id` is not optional in practice. Omitting it does not error — it
 * silently searches the public marketplace and hands back other people's
 * products, which a city would then render as the business's own. The parameter
 * is required here so that mistake cannot recur.
 */
export async function readProducts(env: Env, accountId: string): Promise<WhopProduct[]> {
  const page = await readJson<Page<WhopProduct>>(
    env,
    `/api/v1/products?account_id=${encodeURIComponent(accountId)}&first=${PAGE_SIZE}`,
  );
  return page?.data ?? [];
}

/** GET /api/v1/plans?account_id=… — `account_id` is required or the API 400s. */
export async function readPlans(env: Env, accountId: string): Promise<WhopPlan[]> {
  const page = await readJson<Page<WhopPlan>>(
    env,
    `/api/v1/plans?account_id=${encodeURIComponent(accountId)}&first=${PAGE_SIZE}`,
  );
  return page?.data ?? [];
}

/**
 * GET /api/v1/products/{id}
 *
 * The list response omits the affiliate fields entirely; they exist only on the
 * single-product read, which is why the snapshot bounds how many it asks for.
 */
export async function readProductDetail(env: Env, productId: string): Promise<WhopProductDetail | null> {
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
export async function readOwningAccountId(env: Env): Promise<string | null> {
  const bound = env.WHOP_ACCOUNT_ID;
  if (typeof bound === "string" && bound.length > 0) return bound;

  const appId = typeof env.APP_ID === "string" ? env.APP_ID : null;
  if (!appId) return null;

  const app = await readJson<{ account?: { id?: string } }>(
    env,
    `/api/v1/apps/${encodeURIComponent(appId)}`,
  );
  return app?.account?.id ?? null;
}
