# What a private operator surface would take

The public city is deliberately anonymous: it shows four state words per
district and nothing else, to anyone who opens the site. The obvious next
product is a private one — the owner signs in and sees their own detail. This
is the record of what that would actually require, kept separate from the game
so the two are never confused.

Nothing here was built. No credentials, permissions, redirect URIs or app
settings were changed in this run.

## The deployment model, as established

From `docs/website-auth-spike.md` and the runtime code in `src/server/`:

| Fact | Status | Evidence |
| --- | --- | --- |
| The hosted Website runtime injects a business-scoped app credential | Verified | The snapshot route reads it from the binding and reaches the Whop API with it |
| That credential identifies the **business**, not the visitor | Verified | It is the same value for every visitor; nothing in the request distinguishes them |
| Server-side reads work without any visitor involvement | Verified | The public projection is built entirely server-side |
| A visitor's identity is available to the route | **Unsupported** | Nothing in the binding or request carries a verified viewer identity |

The last row is the whole blocker. Everything a private surface needs follows
from it.

## What a private surface would require

1. **Server-verified visitor identity.** Whop OAuth: authorize, callback, and a
   server-side session. Documented by Whop; never exercised here. It needs a
   redirect URI registered against the app, which is a configuration change.
2. **Current authorisation for that specific business.** Being signed in is not
   being an owner. A buyer holds an account too. The check is a team-membership
   or role read against the business the deployment is bound to, performed
   server-side on every private read — not cached into a cookie and trusted
   later.
3. **A separate, uncacheable route.** Private data must not travel through the
   public snapshot endpoint, its single-flight cache (which is keyed by
   deployment, not by viewer), any shared cache, the served HTML, or logs.

## Classification

| Capability | Status |
| --- | --- |
| Business-scoped server-side reads | **Verified** — this is what the public city runs on |
| Whop OAuth authorize/callback | **Documented**, not verified. Needs a registered redirect URI |
| Team-membership check for the bound business | **Documented**, not verified. Needs an authorised test business |
| Private per-viewer reads | **Blocked** on the two above |
| Whop writes from the city | **Blocked**, and out of scope: no write was attempted or prepared |

## The smallest step that would unblock it

One authorised test business, plus a registered OAuth redirect URI for the app
in that business's dashboard. With those, the authorize → callback → session →
team-membership chain can be built and verified against something real.

Until then the honest product is the one in this branch: a public, read-only
city, with the operator's own work kept in their own browser. There is no
locked private panel in the interface, because a control that cannot work is
worse than an absent one — it advertises a feature that does not exist.

## What was deliberately not done

- No OAuth flow was written. Unverifiable against a real business, it would be
  code that has never once run, sitting in the security-critical path.
- No fake private mode, no client-side "operator" flag, no shared password. A
  flag the browser sets is not authorisation.
- No mutations, and no write scaffolding. When writes are approved they need
  target review, confirmation, idempotency, authoritative readback and a
  receipt — a design task in its own right, not a switch to flip.
