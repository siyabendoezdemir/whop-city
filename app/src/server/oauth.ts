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

import { apiOrigin, boundAppId, readOwningAccountId, type Env } from "./whop-client";
import { SESSION_SECONDS, clearedSessionCookie, mintSession, sessionCookie } from "./session";

export const AUTH_START = "/api/auth/start";
export const AUTH_CALLBACK = "/api/auth/callback";
export const AUTH_LOGOUT = "/api/auth/logout";

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

export async function handleAuthStart(request: Request, env: Env): Promise<Response> {
  const origin = apiOrigin(env);
  const clientId = boundAppId(env);
  if (!origin || !clientId) return backToCity(request, "unavailable");

  const verifier = random(32);
  const state = random(16);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri(request),
    // Identity only. The city needs to know who signed in, nothing more —
    // every business figure is read with the deployment's own credential.
    scope: "openid",
    state,
    nonce: random(16),
    code_challenge: await challenge(verifier),
    code_challenge_method: "S256",
  });

  // Scoping the token to this business is what makes "are you an admin here"
  // a question Whop can answer about the right place.
  const account = await readOwningAccountId(env);
  if (account.ok) params.set("company_id", account.data);

  const headers = new Headers({ location: `${origin}/oauth/authorize?${params}` });
  headers.append("set-cookie", pkceCookie(JSON.stringify({ verifier, state }), PKCE_SECONDS));
  return new Response(null, { status: 302, headers });
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

    const profile = (await who.json()) as { sub?: unknown };
    const userId = typeof profile.sub === "string" ? profile.sub : null;
    if (!userId) return backToCity(request, "failed", [drop]);

    // Signing in is not the same as running the place.
    const { isAdminOf } = await import("./viewer");
    if (!(await isAdminOf(userId, env))) return backToCity(request, "notadmin", [drop]);

    const secret = typeof env.CITY_SESSION_SECRET === "string" ? env.CITY_SESSION_SECRET : "";
    if (secret.length < 24) return backToCity(request, "unavailable", [drop]);

    const session = await mintSession(userId, account.data, secret);
    return backToCity(request, "ok", [drop, sessionCookie(session, SESSION_SECONDS)]);
  } catch {
    return backToCity(request, "failed", [drop]);
  }
}

export function handleAuthLogout(request: Request): Response {
  return backToCity(request, "out", [clearedSessionCookie]);
}
