/**
 * The only place City talks to Whop.
 *
 * Every call is a named function with a literal method and a literal path.
 * There is no generic request helper exported, no caller-supplied path, and no
 * way to reach an endpoint that is not written in this file. Adding a Whop
 * operation is a code change and a review, which is the point.
 *
 * Everything here is GET but one, so no product route can reach a payment,
 * payout, transfer, account, team or person action — not behind a flag, not
 * behind a session. The single exception is `writeOAuthConfig`, which changes
 * two fields on **this deployment's own app record** so that a freshly
 * published City can accept a sign-in at all. Its boundary is argued where it
 * is defined; nothing else here is allowed to follow it.
 *
 * City never holds a credential. The hosted Website runtime attaches the app's
 * key in an outbound proxy, so there is no `Authorization` header anywhere in
 * this file and no code path that reads a key.
 *
 * Every reader returns a `Read<T>` rather than a bare value. A failed request
 * and an empty result are different facts about the business and the city
 * renders them differently, so they must not collapse into the same `[]` on the
 * way up. See `snapshot.ts`.
 *
 * A 200 is not on its own a successful read. Every mandatory response is
 * checked against the shape City actually needs before it counts, because the
 * failure modes that matter here are quiet ones: a proxy returning `{}`, a
 * truncated page with no `data` on it, or a product detail missing the very
 * affiliate fields the read exists to fetch. Left unchecked, each of those
 * becomes an empty-but-live city, which is the exact lie this file is supposed
 * to prevent.
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

/** Used when the deployment does not name an origin, which is the usual case. */
const DEFAULT_API_ORIGIN = `https://${API_HOST}`;

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
/**
 * Where the Whop API lives for this deployment.
 *
 * Defaults to the public API rather than requiring a binding. The hosted
 * runtime does not inject `WHOP_API_ORIGIN` - measured, and recorded in
 * `docs/website-auth-spike.md` - so requiring it meant every deployed City
 * failed closed to the unavailable projection and no business was ever read.
 *
 * An override is still honoured and still has to survive the permitted-host
 * check, so the widening is in what is *absent*, not in what is accepted.
 */
/**
 * The app this deployment is, from whichever name the runtime used.
 *
 * Hosted Whop injects `WHOP_APP_ID`; the original code only looked for
 * `APP_ID`, so the account fallback never fired where it was needed most.
 */
export function boundAppId(env: Env): string | null {
  for (const key of ["WHOP_APP_ID", "APP_ID"] as const) {
    const value = env[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

export function apiOrigin(env: Env): string | null {
  const hosted = env.WHOP_API_ORIGIN;
  if (typeof hosted !== "string" || hosted.length === 0) return DEFAULT_API_ORIGIN;
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** A field the API declares nullable. Present, and either a string or null. */
function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

/**
 * A quantity, in either representation the API uses.
 *
 * `toNumber` in `snapshot.ts` accepts a number or a numeric string, so this
 * accepts exactly those and null. Everything else is refused rather than
 * normalised: `parseFloat` would quietly turn `"12 members"` into 12 and
 * `{}` into 0, and a zero invented that way is indistinguishable from a real
 * one by the time it reaches a district's state.
 */
function isNullableQuantity(value: unknown): value is number | string | null {
  if (value === null) return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && Number.isFinite(Number(trimmed));
}

/**
 * An RFC 3339 timestamp, or null.
 *
 * Shape *and* calendar. A pattern match alone accepts `2026-02-29`, and
 * `Date.parse` does not reject it either — JavaScript silently rolls an
 * impossible date forward, so February 30th arrives as March 2nd and a
 * timestamp the API never meant to send ends up deciding whether a district
 * reads as `rising`. `Date.parse` is therefore not consulted at all here: every
 * component is range-checked, and the day is checked against the real length of
 * its month in its own year.
 */
const RFC3339 =
  /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(\.\d+)?([Zz]|([+-])(\d{2}):(\d{2}))$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function isNullableTimestamp(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string") return false;

  const match = RFC3339.exec(value);
  if (!match) return false;

  const [, year, month, day, hour, minute, second, , , , offsetHour, offsetMinute] = match;

  const y = Number(year);
  const mo = Number(month);
  const d = Number(day);
  if (mo < 1 || mo > 12) return false;
  if (d < 1 || d > daysInMonth(y, mo)) return false;

  // Leap seconds are legal RFC 3339 but nothing upstream emits one, and
  // accepting 60 would mean accepting it on any minute of any day.
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return false;

  // A numeric offset, when present, has its own ranges.
  if (offsetHour !== undefined) {
    if (Number(offsetHour) > 23 || Number(offsetMinute) > 59) return false;
  }

  return true;
}

/**
 * Presence matters, not just type.
 *
 * A field the API declares as `string | null` and simply omits is a malformed
 * response, not a null. Treating the two the same is how `{ id: "prod_1" }`
 * used to become a complete product with an empty title, an invisible
 * shopfront and no members — a live city built out of nothing.
 */
function has(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function field(
  body: Record<string, unknown>,
  key: string,
  check: (value: unknown) => boolean,
): boolean {
  return has(body, key) && check(body[key]);
}

/** `{ id, plan_type }`, or null. Declared on every product. */
function isDefaultPlan(value: unknown): boolean {
  if (value === null) return true;
  if (!isObject(value)) return false;
  return field(value, "id", isNonEmptyString) && field(value, "plan_type", isNullableString);
}

/** `{ amount, currency }`, or null. The amount is what becomes a price. */
/**
 * A plan's price, in either shape the API has been seen to use.
 *
 * The live API returns a plain number with the currency as a sibling field.
 * This validator originally accepted only an `{ amount, currency }` object,
 * which was an assumption about a response nobody had ever received: the first
 * deployment read a real business, every plan failed this check, and the whole
 * capture failed closed to the unavailable projection.
 *
 * Both shapes are accepted now. The object form is kept because rejecting it
 * would trade one unverified assumption for another.
 */
function isInitialPrice(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value === "number") return Number.isFinite(value) && value >= 0;
  if (!isObject(value)) return false;
  return field(value, "amount", isNullableQuantity) && field(value, "currency", isNullableString);
}

/**
 * Validates a list response.
 *
 * The envelope must be an object with a `data` array on it — a missing `data`
 * is a malformed response, not a business with nothing in it — and every item
 * must carry every field the snapshot reads, in a shape the snapshot can read.
 * One malformed row fails the whole page: a partially-understood catalogue is
 * not a smaller catalogue.
 *
 * `{ data: [] }` is valid and means exactly what it says.
 */
function page<T>(read: Read<unknown>, item: (value: unknown) => value is T): Read<T[]> {
  if (!read.ok) return FAILED;
  const body = read.data;
  if (!isObject(body) || !Array.isArray(body.data)) return FAILED;
  if (!body.data.every(item)) return FAILED;
  return { ok: true, data: body.data as T[] };
}

function isWhopProduct(value: unknown): value is WhopProduct {
  if (!isObject(value)) return false;
  return (
    field(value, "id", isNonEmptyString) &&
    field(value, "title", isNullableString) &&
    field(value, "visibility", isNullableString) &&
    field(value, "member_count", isNullableQuantity) &&
    field(value, "created_at", isNullableTimestamp) &&
    field(value, "default_plan", isDefaultPlan)
  );
}

export function isWhopPlan(value: unknown): value is WhopPlan {
  if (!isObject(value)) return false;
  return (
    field(value, "id", isNonEmptyString) &&
    field(value, "plan_type", isNullableString) &&
    field(value, "visibility", isNullableString) &&
    field(value, "created_at", isNullableTimestamp) &&
    field(value, "initial_price", isInitialPrice)
  );
}

/**
 * A product detail is only usable if it is the product that was asked for and
 * it says something about affiliate state.
 *
 * The affiliate fields are the entire reason this read exists. A detail that
 * omits `global_affiliate_status` cannot distinguish "affiliates are off" from
 * "we did not learn", and the projection would quietly choose the first, which
 * renders Creator Quarter dormant on no evidence.
 */
function isWhopProductDetail(value: unknown, expectedId: string): value is WhopProductDetail {
  if (!isWhopProduct(value)) return false;
  const body = value as unknown as Record<string, unknown>;
  if (body.id !== expectedId) return false;
  return (
    field(body, "global_affiliate_status", isNullableString) &&
    field(body, "global_affiliate_percentage", isNullableQuantity) &&
    field(body, "member_affiliate_status", isNullableString)
  );
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
    await readJson<unknown>(
      env,
      `/api/v1/products?account_id=${encodeURIComponent(accountId)}&first=${PAGE_SIZE}`,
    ),
    isWhopProduct,
  );
}

/** GET /api/v1/plans?account_id=… — `account_id` is required or the API 400s. */
export async function readPlans(env: Env, accountId: string): Promise<Read<WhopPlan[]>> {
  return page(
    await readJson<unknown>(
      env,
      `/api/v1/plans?account_id=${encodeURIComponent(accountId)}&first=${PAGE_SIZE}`,
    ),
    isWhopPlan,
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
  const read = await readJson<unknown>(env, `/api/v1/products/${encodeURIComponent(productId)}`);
  if (!read.ok) return FAILED;
  // The id has to match what was asked for. A detail for a different product
  // would silently attach one product's affiliate state to another.
  return isWhopProductDetail(read.data, productId) ? { ok: true, data: read.data } : FAILED;
}

/**
 * GET /api/v1/companies/{id}
 *
 * What the business is called, so the interface can say which Whop the city is
 * reading instead of leaving somebody with several of them to guess. A name
 * and a public route, nothing else: no balance, no owner, no contact details,
 * and never anything from this response reaches the public projection — it is
 * served only on the owner's own gated endpoint.
 */
export async function readAccountName(
  env: Env,
  accountId: string,
): Promise<Read<{ name: string; route: string | null }>> {
  const read = await readJson<unknown>(env, `/api/v1/companies/${encodeURIComponent(accountId)}`);
  if (!read.ok) return FAILED;
  const body = read.data;
  if (!isObject(body)) return FAILED;

  // The field has been seen as both `title` and `name` depending on surface.
  const name = [body.title, body.name].find(isNonEmptyString);
  if (!name) return FAILED;
  return {
    ok: true,
    data: { name: name.slice(0, 60), route: isNonEmptyString(body.route) ? body.route : null },
  };
}

/**
 * PATCH /api/v1/apps/{id} — the one non-GET in this file.
 *
 * Every Blueprint deployment registers a **new app**, and a new app has no
 * OAuth callback whitelisted and is a `confidential` client. So the first
 * person to press "Sign in with Whop" on a freshly published City gets
 * `redirect_uri is invalid` from Whop before anything else happens, and the
 * only fix is a configuration change on the app. Making that a manual step for
 * every deployer is a broken product; doing it here makes publishing one step.
 *
 * The exception is bounded as tightly as it can be:
 *
 *   - one method, one path, and the path is **this deployment's own app id**,
 *     read from a binding. There is no parameter and no caller can supply one.
 *   - exactly two fields in the body, both derived — the callback from the
 *     request's own origin, the client type from a literal.
 *   - it touches no business, no product, no plan, no payment and no person.
 *     `developer:update_app` is the only permission involved, and the spike
 *     verified in production that the injected credential holds it and that
 *     both fields land.
 *   - it is skipped entirely when the app is already configured, so the steady
 *     state is a read.
 *
 * See `docs/website-auth-spike.md`, "a deployed Website can self-bootstrap".
 */
export type OAuthConfig = { redirectUris: string[]; clientType: string | null };

export async function readOAuthConfig(env: Env): Promise<Read<OAuthConfig>> {
  const appId = boundAppId(env);
  if (!appId) return FAILED;
  const app = await readJson<unknown>(env, `/api/v1/apps/${encodeURIComponent(appId)}`);
  if (!app.ok || !isObject(app.data)) return FAILED;
  const uris = Array.isArray(app.data.redirect_uris)
    ? app.data.redirect_uris.filter(isNonEmptyString)
    : [];
  return {
    ok: true,
    data: {
      redirectUris: uris,
      clientType: isNonEmptyString(app.data.oauth_client_type) ? app.data.oauth_client_type : null,
    },
  };
}

export async function writeOAuthConfig(
  env: Env,
  redirectUris: readonly string[],
): Promise<Read<true>> {
  const origin = apiOrigin(env);
  const appId = boundAppId(env);
  if (origin === null || !appId) return FAILED;

  try {
    const response = await fetch(`${origin}/api/v1/apps/${encodeURIComponent(appId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "Api-Version-Date": API_VERSION },
      // A public client, because the alternative is a per-deployment secret
      // that a hosted Website has nowhere safe to keep.
      body: JSON.stringify({ redirect_uris: redirectUris, oauth_client_type: "public" }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return response.ok ? { ok: true, data: true } : FAILED;
  } catch {
    return FAILED;
  }
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

  const appId = boundAppId(env);
  if (!appId) return FAILED;

  const app = await readJson<unknown>(env, `/api/v1/apps/${encodeURIComponent(appId)}`);
  if (!app.ok) return FAILED;

  // A 200 with no account on it tells us the deployment is not wired to a
  // business. That is not a business with nothing in it either.
  const body = app.data;
  if (!isObject(body) || !isObject(body.account)) return FAILED;
  return isNonEmptyString(body.account.id) ? { ok: true, data: body.account.id } : FAILED;
}
