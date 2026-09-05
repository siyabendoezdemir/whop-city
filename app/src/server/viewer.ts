/**
 * Who is looking, and are they allowed to see the numbers.
 *
 * A Whop **website** has no iframe and no injected user token: the hosting
 * docs say plainly that the runtime authenticates as the business and never as
 * the visitor, and that visitor identity means OAuth. So identity arrives as a
 * signed session cookie minted by `oauth.ts` after Whop vouched for the user
 * and the access check said they run this business.
 *
 * Everyone else is the public view, which carries no figures at all. There is
 * no third state and no way to ask for one.
 */

import { readSession } from "./session";
import { apiOrigin, readOwningAccountId, type Env } from "./whop-client";

const CHECK_TIMEOUT_MS = 5_000;

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
export async function audienceFor(request: Request, env: Env): Promise<"public" | "owner"> {
  const account = await readOwningAccountId(env);
  if (!account.ok) return "public";

  const secret = typeof env.CITY_SESSION_SECRET === "string" ? env.CITY_SESSION_SECRET : undefined;
  const session = await readSession(request, secret, account.data);
  return session ? "owner" : "public";
}
