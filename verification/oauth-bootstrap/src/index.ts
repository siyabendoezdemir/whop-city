/**
 * OAuth bootstrap self-configuration probe.
 *
 * Answers one question: can a deployed Website configure its own OAuth client
 * using the credential the hosted runtime injects, rather than a broad business
 * key? That is the question a Blueprint deployment depends on, and it cannot be
 * answered from outside the hosted runtime.
 *
 * ---------------------------------------------------------------------------
 * THIS BUILD MUTATES. Promoting it causes a PATCH on the first request.
 * ---------------------------------------------------------------------------
 *
 * It is the only verification build that writes. It is idempotent — it PATCHes
 * only when the app is not already in the desired state — but it must never be
 * promoted casually, and it must never remain the production build.
 *
 * Properties this file is written to make auditable:
 *
 *   1. `callApps` is the only place `fetch` appears. Its method is a two-value
 *      union, its path is a single constant computed once, and the only body it
 *      can send is the frozen PATCH_BODY. There is no second call site and no
 *      way to reach a different endpoint.
 *   2. The handler takes no parameters other than `env`. It cannot read the
 *      request URL, path, query, method, headers, or body, because it never
 *      receives them.
 *   3. Bindings are read only from the hosted `env` argument. There is no
 *      `process.env` access and no fallback to the `whop apps dev` names, so
 *      this build is inert anywhere except the hosted runtime.
 *   4. Logs carry status codes and booleans only. No identifier, URL, token,
 *      response body, or configuration value is ever logged.
 *   5. `required_scopes` is absent from the payload. Whether `read_user` at app
 *      level and `openid` at authorize time can coexist is a separate
 *      hypothesis and is not touched here.
 */

const TAG = "[city-oauth-bootstrap]";

/** Same pin used by every other call in this spike. */
const API_VERSION = "2026-09-02-2";

/** The desired state. Present in source because it is the value being written. */
const DESIRED_REDIRECT_URI = "https://city-spike.whop.site/auth/whop/callback";
const DESIRED_CLIENT_TYPE = "public";

/**
 * The only body this Worker can send. Frozen so no code path can extend it,
 * and deliberately limited to the two approved fields.
 */
const PATCH_BODY = Object.freeze({
  redirect_uris: Object.freeze([DESIRED_REDIRECT_URI]),
  oauth_client_type: DESIRED_CLIENT_TYPE,
});

type Outcome =
  | "aborted-no-bindings"
  | "aborted-bad-origin"
  | "already-configured"
  | "patched"
  | "patch-failed"
  | "read-failed";

function log(line: string): void {
  console.log(`${TAG} ${line}`);
}

/** Rejects any origin that is not an HTTPS Whop host. */
function isWhopOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "whop.com" || url.hostname.endsWith(".whop.com"));
  } catch {
    return false;
  }
}

type AppShape = { redirect_uris?: unknown; oauth_client_type?: unknown };

/** Exact array equality against the single desired redirect URI. */
function redirectUrisMatch(value: unknown): boolean {
  return Array.isArray(value) && value.length === 1 && value[0] === DESIRED_REDIRECT_URI;
}

function clientTypeMatches(value: unknown): boolean {
  return value === DESIRED_CLIENT_TYPE;
}

/**
 * The single outbound call site in this Worker.
 *
 * `url` is fixed by the caller's closure over one computed constant, the method
 * is one of two literals, and a body is sent only for PATCH and only ever
 * PATCH_BODY. Nothing here is derived from a visitor request.
 */
async function callApps(url: string, method: "GET" | "PATCH"): Promise<{ status: number; app: AppShape | null }> {
  const init: RequestInit =
    method === "PATCH"
      ? {
          method: "PATCH",
          headers: { "Api-Version-Date": API_VERSION, "Content-Type": "application/json" },
          body: JSON.stringify(PATCH_BODY),
          signal: AbortSignal.timeout(15_000),
        }
      : {
          method: "GET",
          headers: { "Api-Version-Date": API_VERSION },
          signal: AbortSignal.timeout(15_000),
        };

  const response = await fetch(url, init);
  let app: AppShape | null = null;
  try {
    app = (await response.json()) as AppShape;
  } catch {
    app = null;
  }
  return { status: response.status, app };
}

async function bootstrap(env: Record<string, unknown>): Promise<Outcome> {
  const appId = env.APP_ID;
  const origin = env.WHOP_API_ORIGIN;

  log(`binding APP_ID present: ${typeof appId === "string" && appId.length > 0}`);
  log(`binding WHOP_API_ORIGIN present: ${typeof origin === "string" && origin.length > 0}`);

  if (typeof appId !== "string" || appId.length === 0 || typeof origin !== "string" || origin.length === 0) {
    log("outcome: aborted-no-bindings (not the hosted runtime; no request made)");
    return "aborted-no-bindings";
  }
  if (!isWhopOrigin(origin)) {
    log("outcome: aborted-bad-origin (no request made)");
    return "aborted-bad-origin";
  }

  // Computed once. Every call below reuses this exact string.
  const url = `${origin}/api/v1/apps/${appId}`;

  // ------------------------------------------------------------ read current
  const before = await callApps(url, "GET");
  log(`GET status: ${before.status}`);
  if (before.status !== 200 || before.app === null) {
    log("outcome: read-failed");
    return "read-failed";
  }

  const redirectOk = redirectUrisMatch(before.app.redirect_uris);
  const clientOk = clientTypeMatches(before.app.oauth_client_type);
  log(`before: redirect_uris matches desired: ${redirectOk}`);
  log(`before: oauth_client_type matches desired: ${clientOk}`);

  if (redirectOk && clientOk) {
    log("outcome: already-configured (no PATCH issued)");
    return "already-configured";
  }

  // ------------------------------------------------------------------ write
  log("state differs; issuing the single approved PATCH");
  const patched = await callApps(url, "PATCH");
  log(`PATCH status: ${patched.status}`);

  // --------------------------------------------------------- read back again
  const after = await callApps(url, "GET");
  log(`verify GET status: ${after.status}`);
  if (after.status !== 200 || after.app === null) {
    log("outcome: patch-failed (could not read back)");
    return "patch-failed";
  }

  const redirectNow = redirectUrisMatch(after.app.redirect_uris);
  const clientNow = clientTypeMatches(after.app.oauth_client_type);
  log(`after: redirect_uris matches desired: ${redirectNow}`);
  log(`after: oauth_client_type matches desired: ${clientNow}`);

  const outcome: Outcome = redirectNow && clientNow ? "patched" : "patch-failed";
  log(`outcome: ${outcome}`);
  return outcome;
}

let ran = false;

export default {
  /**
   * No `request` parameter: this handler structurally cannot read visitor
   * input. The response is a constant.
   */
  async fetch(_request: Request, env: Record<string, unknown>): Promise<Response> {
    if (!ran) {
      ran = true;
      try {
        await bootstrap(env);
      } catch {
        // Deliberately no error detail: an exception message can carry a URL.
        log("outcome: aborted-exception");
      }
    }
    return new Response("ok", {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "x-robots-tag": "noindex, nofollow",
      },
    });
  },
};
