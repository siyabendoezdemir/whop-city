/**
 * The only place City talks to Whop.
 *
 * Every call is a named function with a literal method and a literal path.
 * There is no generic request helper exported, no caller-supplied path, and no
 * way to reach an endpoint that is not written here. Adding a Whop operation is
 * a code change and a review, which is the point.
 *
 * v1 is read-only. There is no non-GET function in this file, so no product
 * route can reach a payment, payout, transfer, account, team, OAuth-config, or
 * app-config action — not behind a flag, not behind a session.
 */

const API_VERSION = "2026-09-02-2";
const DEFAULT_ORIGIN = "https://api.whop.com";

type Env = Record<string, unknown>;

/**
 * City never holds a Whop credential.
 *
 * Hosted attaches the app's key in an outbound proxy, and local dev routes
 * through an equivalent proxy in the Vite node process — see the plugin in
 * `vite.config.ts`. There is no `Authorization` header anywhere in this file
 * and no code path that reads a key, in either environment.
 */
function apiOrigin(env: Env): string {
  const hosted = env.WHOP_API_ORIGIN;
  if (typeof hosted === "string" && hosted.length > 0) {
    try {
      const url = new URL(hosted);
      const whopHost = url.hostname === "whop.com" || url.hostname.endsWith(".whop.com");
      if (url.protocol === "https:" && whopHost) return url.origin;
    } catch {
      // Fall through to the default.
    }
  }
  if (typeof __WHOP_DEV_PROXY__ === "string" && __WHOP_DEV_PROXY__.length > 0) {
    return __WHOP_DEV_PROXY__;
  }
  return DEFAULT_ORIGIN;
}

/** Not exported. Internal to the named readers below. */
async function readJson<T>(env: Env, path: string): Promise<T | null> {
  try {
    const response = await fetch(`${apiOrigin(env)}${path}`, {
      method: "GET",
      headers: { "Api-Version-Date": API_VERSION },
      signal: AbortSignal.timeout(8_000),
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
  global_affiliate_status: string | null;
  global_affiliate_percentage: number | null;
  created_at: string | null;
  default_plan: { id: string; plan_type: string | null } | null;
};

export type WhopProductDetail = WhopProduct & {
  global_affiliate_status: string | null;
  global_affiliate_percentage: number | null;
  member_affiliate_status: string | null;
  member_affiliate_percentage: number | null;
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
 * `account_id` is not optional in practice. Omitting it does not return an
 * error — it silently searches the **public marketplace** and hands back other
 * people's products, which a city would then render as if they were the
 * business's own. The parameter is required here so that mistake cannot recur.
 */
export async function readProducts(env: Env, accountId: string): Promise<WhopProduct[]> {
  const page = await readJson<Page<WhopProduct>>(
    env,
    `/api/v1/products?account_id=${encodeURIComponent(accountId)}&first=100`,
  );
  return page?.data ?? [];
}

/**
 * GET /api/v1/plans?account_id=…
 *
 * `account_id` is required by the API: without it the request is a 400 unless
 * `product_ids` is supplied for a public read.
 */
export async function readPlans(env: Env, accountId: string): Promise<WhopPlan[]> {
  const page = await readJson<Page<WhopPlan>>(
    env,
    `/api/v1/plans?account_id=${encodeURIComponent(accountId)}&first=100`,
  );
  return page?.data ?? [];
}

/**
 * GET /api/v1/products/{id}
 *
 * The list response omits the affiliate fields entirely — they exist only on
 * the single-product read. Creator Quarter therefore costs one request per
 * product, which is why `captureSnapshot` bounds how many it asks for.
 */
export async function readProductDetail(env: Env, productId: string): Promise<WhopProductDetail | null> {
  return readJson<WhopProductDetail>(env, `/api/v1/products/${encodeURIComponent(productId)}`);
}

/**
 * GET /api/v1/apps/{id}
 *
 * Used only to learn the business id at boot. WHOP_ACCOUNT_ID is absent under
 * `whop apps dev`, and a Blueprint deployment belongs to a different business
 * every time, so the app record is the reliable source.
 */
export async function readOwningAccountId(env: Env): Promise<string | null> {
  const bound = env.WHOP_ACCOUNT_ID;
  if (typeof bound === "string" && bound.length > 0) return bound;

  // Hosted names it APP_ID, `whop apps dev` names it WHOP_APP_ID, and the dev
  // worker receives neither — so the build-time dev value is the last fallback.
  const appId =
    typeof env.APP_ID === "string"
      ? env.APP_ID
      : typeof env.WHOP_APP_ID === "string"
        ? env.WHOP_APP_ID
        : typeof __WHOP_DEV_APP_ID__ === "string"
          ? __WHOP_DEV_APP_ID__
          : null;
  if (!appId) return null;

  const app = await readJson<{ account?: { id?: string } }>(env, `/api/v1/apps/${appId}`);
  return app?.account?.id ?? null;
}
