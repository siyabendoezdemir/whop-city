/**
 * Who is signed in, and which Whop the city is reading.
 *
 * A second endpoint rather than a field on the snapshot, because the two have
 * different audiences and must not share a cache entry. The snapshot is a
 * public document with the figures gated inside it; this one has no public
 * form at all. A visitor gets `{ signedIn: false }` and nothing else — no
 * business name, no route, no id, no hint that a session exists.
 *
 * What an owner gets is their own: their display name, what the business they
 * are looking at is called, and the list of their own Whops so they can point
 * the city at a different one. All of it came back from Whop about them.
 */

import { readAccountName, readOwningAccountId, type Env } from "./whop-client";
import { viewerFor } from "./viewer";

export const PROFILE_PATH = "/api/city/profile";

export type PublicProfile = {
  readonly signedIn: boolean;
  readonly name?: string;
  /** What the city is currently reading. */
  readonly business?: { readonly id: string; readonly name: string; readonly route: string | null };
  /** Every Whop this user runs, including the one above. */
  readonly shops?: ReadonlyArray<{ readonly id: string; readonly name: string; readonly readable: boolean }>;
  /** True when the business being read is the one this deployment is bound to. */
  readonly bound?: boolean;
};

const SIGNED_OUT: PublicProfile = { signedIn: false };

function json(body: PublicProfile): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store, max-age=0",
      vary: "Cookie",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function handleProfileRequest(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return new Response(null, { status: 405, headers: { allow: "GET" } });

  // A fixture build has an invented business behind it, so it gets an invented
  // owner to match — otherwise every screenshot and browser test of the game
  // shows a signed-out corner over a fully playable city. The literal is what
  // lets the bundler delete this branch from a deployable build.
  if (__CITY_FIXTURES_BUILD__ && env.CITY_FIXTURES) {
    return json({
      signedIn: true,
      name: "Fixture Owner",
      business: { id: "biz_fixture", name: "Fixture Whop", route: "fixture-whop" },
      shops: [
        { id: "biz_fixture", name: "Fixture Whop", readable: true },
        { id: "biz_other", name: "Second Whop", readable: false },
      ],
      bound: true,
    });
  }

  try {
    const viewer = await viewerFor(request, env);
    if (viewer.audience !== "owner" || !viewer.viewing || !viewer.session) return json(SIGNED_OUT);

    const bound = await readOwningAccountId(env);
    const named = await readAccountName(env, viewer.viewing);

    const shops = (viewer.session.shops ?? []).map((shop) => ({
      id: shop.id,
      name: shop.name,
      // Only the deployment's own business is guaranteed readable: a hosted
      // Website's credential is scoped to the app's account. Saying which is
      // which is better than offering a switch that quietly shows noughts.
      readable: bound.ok && shop.id === bound.data,
    }));

    return json({
      signedIn: true,
      ...(viewer.session.name ? { name: viewer.session.name } : {}),
      business: {
        id: viewer.viewing,
        name: named.ok ? named.data.name : "Your Whop",
        route: named.ok ? named.data.route : null,
      },
      shops,
      bound: bound.ok && viewer.viewing === bound.data,
    });
  } catch {
    return json(SIGNED_OUT);
  }
}
