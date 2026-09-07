/**
 * Sign in with Whop.
 *
 * OAuth 2.1 with PKCE, which is what a website gets instead of the iframe
 * token an app would have. Three handlers and no library: start the flow,
 * take the code back, drop the session.
 *
 * The public client flow is deliberate — the token exchange proves possession
 * of the code verifier rather than a client secret, so the deployment holds no
 * secret it could leak. The verifier and the state live in a short HttpOnly
 * cookie for the seconds between the redirect out and the redirect back.
 *
 * The access token is used once, server side, to ask Whop who signed in, and
 * is then thrown away. Nothing about it is stored and it never reaches the
 * browser.
 */

import {
  apiOrigin,
  boundAppId,
  readOAuthConfig,
  readOwningAccountId,
  writeOAuthConfig,
  type Env,
} from "./whop-client";
import {
  SESSION_SECONDS,
  clearedSessionCookie,
  mintSession,
  readSession,
  sessionCookie,
  trimShops,
  type Shop,
} from "./session";

export const AUTH_START = "/api/auth/start";
export const AUTH_CALLBACK = "/api/auth/callback";
export const AUTH_LOGOUT = "/api/auth/logout";
export const AUTH_VIEW = "/api/auth/view";

const PKCE_COOKIE = "city_pkce";
const PKCE_SECONDS = 600;
const EXCHANGE_TIMEOUT_MS = 8_000;

function base64url(bytes: Uint8Array | ArrayBuffer): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const random = (bytes: number) => base64url(crypto.getRandomValues(new Uint8Array(bytes)));

async function challenge(verifier: string): Promise<string> {
  return base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
}

/** Where Whop should send them back to, derived from the request, not a binding. */
function redirectUri(request: Request): string {
  return `${new URL(request.url).origin}${AUTH_CALLBACK}`;
}

function readPkce(request: Request): { verifier: string; state: string } | null {
  const raw = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${PKCE_COOKIE}=`))
    ?.slice(PKCE_COOKIE.length + 1);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as { verifier?: unknown; state?: unknown };
    return typeof parsed.verifier === "string" && typeof parsed.state === "string"
      ? { verifier: parsed.verifier, state: parsed.state }
      : null;
  } catch {
    return null;
  }
}

function pkceCookie(value: string, seconds: number): string {
  return `${PKCE_COOKIE}=${encodeURIComponent(value)}; Path=${AUTH_CALLBACK}; Max-Age=${seconds}; HttpOnly; Secure; SameSite=Lax`;
}

/** Home, with a reason, rather than an error page nobody can act on. */
function backToCity(request: Request, outcome: string, cookies: string[] = []): Response {
  const url = new URL(request.url);
  const headers = new Headers({ location: `${url.origin}/?auth=${encodeURIComponent(outcome)}` });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
}

// ---------------------------------------------------------------------------

/**
 * Has this deployment's app been told where to send people back to.
 *
 * Cached for the life of the isolate once it is true: the answer only changes
 * when someone publishes a new City, and a fresh isolate re-checks anyway.
 */
let calledBack = false;

async function ensureCallbackRegistered(env: Env, callback: string): Promise<boolean> {
  if (calledBack) return true;

  const config = await readOAuthConfig(env);
  if (!config.ok) return false;

  if (config.data.redirectUris.includes(callback) && config.data.clientType === "public") {
    calledBack = true;
    return true;
  }

  // Merge rather than replace: another environment of the same app may have
  // registered a callback of its own, and taking it away would break it.
  const merged = [...new Set([...config.data.redirectUris, callback])];
  if (!(await writeOAuthConfig(env, merged)).ok) return false;

  // Read it back. A 200 on the write is not the same as the field having
  // changed, and sending somebody to Whop on the strength of one is how they
  // end up looking at `redirect_uri is invalid` again.
  const after = await readOAuthConfig(env);
  calledBack = after.ok && after.data.redirectUris.includes(callback) && after.data.clientType === "public";
  return calledBack;
}

export async function handleAuthStart(request: Request, env: Env): Promise<Response> {
  const origin = apiOrigin(env);
  const clientId = boundAppId(env);
  if (!origin || !clientId) return backToCity(request, "unavailable");

  // A Blueprint deployment is a brand new app with no callback whitelisted, so
  // the first sign-in on a freshly published City would otherwise be refused by
  // Whop before it even looked at the scopes.
  if (!(await ensureCallbackRegistered(env, redirectUri(request)))) {
    return backToCity(request, "unregistered");
  }

  const verifier = random(32);
  const state = random(16);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri(request),
    // Identity and a display name. Not `email`: nothing here sends mail, and
    // an address is the one field worth not holding. Every business figure is
    // still read with the deployment's own credential, never with this token.
    scope: "openid profile",
    state,
    nonce: random(16),
    code_challenge: await challenge(verifier),
    code_challenge_method: "S256",
  });

  // Deliberately *not* scoped to a company. A token pinned to one business can
  // only ever see that one, and somebody with several Whops needs to be told
  // which ones they have before they can choose between them.
  const headers = new Headers({ location: `${origin}/oauth/authorize?${params}` });
  headers.append("set-cookie", pkceCookie(JSON.stringify({ verifier, state }), PKCE_SECONDS));
  return new Response(null, { status: 302, headers });
}

/**
 * The businesses this user runs, as Whop lists them for their own token.
 *
 * Best effort, and treated as such: a deployment whose app was never granted a
 * scope that reaches this gets an empty list and the profile menu simply shows
 * the one business the city is bound to. That is a smaller answer, not a wrong
 * one, so it is not worth failing the sign-in over.
 */
async function readShops(origin: string, token: string, signal: AbortSignal): Promise<Shop[]> {
  try {
    const response = await fetch(`${origin}/api/v1/accounts?first=20`, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "Api-Version-Date": "2026-09-02-2",
        // The proxy would otherwise replace this with the deployment's own
        // credential, which answers for the app rather than for the visitor.
        "x-whop-inject-key": "none",
      },
      signal,
    });
    if (!response.ok) return [];
    const body = (await response.json()) as { data?: unknown };
    if (!Array.isArray(body.data)) return [];
    return trimShops(
      body.data
        .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
        .map((entry) => ({
          id: String(entry.id ?? ""),
          name: String(entry.title ?? entry.name ?? entry.route ?? entry.id ?? ""),
        }))
        .filter((shop) => shop.id.startsWith("biz_")),
    );
  } catch {
    return [];
  }
}

export async function handleAuthCallback(request: Request, env: Env): Promise<Response> {
  const drop = pkceCookie("", 0);
  const url = new URL(request.url);
  const origin = apiOrigin(env);
  const clientId = boundAppId(env);

  if (url.searchParams.get("error")) return backToCity(request, "denied", [drop]);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const pkce = readPkce(request);

  if (!origin || !clientId || !code || !state || !pkce) return backToCity(request, "failed", [drop]);
  // The state is the CSRF check: a callback nobody here started is not ours.
  if (state !== pkce.state) return backToCity(request, "failed", [drop]);

  const account = await readOwningAccountId(env);
  if (!account.ok) return backToCity(request, "failed", [drop]);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EXCHANGE_TIMEOUT_MS);

    const tokenResponse = await fetch(`${origin}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-whop-inject-key": "none" },
      signal: controller.signal,
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri(request),
        client_id: clientId,
        code_verifier: pkce.verifier,
      }),
    });
    if (!tokenResponse.ok) {
      clearTimeout(timer);
      return backToCity(request, "failed", [drop]);
    }

    const tokens = (await tokenResponse.json()) as { access_token?: unknown };
    if (typeof tokens.access_token !== "string") {
      clearTimeout(timer);
      return backToCity(request, "failed", [drop]);
    }

    // Used once, to ask who this is, and then dropped. It is never stored and
    // never sent to the browser.
    const who = await fetch(`${origin}/oauth/userinfo`, {
      headers: { authorization: `Bearer ${tokens.access_token}`, "x-whop-inject-key": "none" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!who.ok) return backToCity(request, "failed", [drop]);

    const profile = (await who.json()) as { sub?: unknown; name?: unknown; preferred_username?: unknown };
    const userId = typeof profile.sub === "string" ? profile.sub : null;
    if (!userId) return backToCity(request, "failed", [drop]);

    const name = [profile.name, profile.preferred_username].find(
      (value): value is string => typeof value === "string" && value.length > 0,
    );

    // Signing in is not the same as running the place.
    const { isAdminOf } = await import("./viewer");
    if (!(await isAdminOf(userId, env))) return backToCity(request, "notadmin", [drop]);

    const secret = typeof env.CITY_SESSION_SECRET === "string" ? env.CITY_SESSION_SECRET : "";
    if (secret.length < 24) return backToCity(request, "unavailable", [drop]);

    const shops = await readShops(origin, tokens.access_token, controller.signal);

    const session = await mintSession(userId, account.data, secret, { name, shops });
    return backToCity(request, "ok", [drop, sessionCookie(session, SESSION_SECONDS)]);
  } catch {
    return backToCity(request, "failed", [drop]);
  }
}

export function handleAuthLogout(request: Request): Response {
  return backToCity(request, "out", [clearedSessionCookie]);
}

/**
 * Point the city at a different one of your own Whops.
 *
 * The id is only honoured if Whop listed it for this user at sign-in, so the
 * query string cannot name a business — it can only pick one already in the
 * signed session. Anything else silently falls back to the deployment's own.
 */
export async function handleAuthView(request: Request, env: Env): Promise<Response> {
  const account = await readOwningAccountId(env);
  if (!account.ok) return backToCity(request, "failed");

  const secret = typeof env.CITY_SESSION_SECRET === "string" ? env.CITY_SESSION_SECRET : "";
  const session = await readSession(request, secret, account.data);
  if (!session) return backToCity(request, "failed");

  const wanted = new URL(request.url).searchParams.get("business") ?? account.data;
  const allowed =
    wanted === account.data || (session.shops ?? []).some((shop) => shop.id === wanted)
      ? wanted
      : account.data;

  const next = await mintSession(session.userId, account.data, secret, {
    name: session.name,
    shops: session.shops,
    viewing: allowed,
  });
  return backToCity(request, "switched", [sessionCookie(next, SESSION_SECONDS)]);
}
