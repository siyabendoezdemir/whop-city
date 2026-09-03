# Operator authentication: endpoint and permission model

Answers the question the operator gate depends on:

> Is authenticated user X currently an owner or team member of
> `WHOP_ACCOUNT_ID`?

Whop City stays an app of type `website` and a Blueprint. Whop OAuth is used
**only to learn who the visitor is**. It is not a seller-install consent model,
it grants City nothing over anyone else's business, and it does not make this a
`b2c_app`.

Status: the endpoint and permission model below is settled from Whop's current
OpenAPI document and live-verified at the pinned version. The **spike itself has
not been run** — it needs `whop apps dev` against the dedicated test business,
which needs your approval and a Whop credential.

- API version pin: `2026-09-02-2`
- Verified live 2026-09-03 against `https://api.whop.com`, no credentials sent

## The answer

Two endpoints can answer the question. Use the first; fall back to the second
only if the spike shows the injected credential cannot reach it.

### Primary — `GET /team_members`

```
GET {WHOP_API_ORIGIN}/api/v1/team_members
      ?account_id={WHOP_ACCOUNT_ID}
      &user_id={sub}
      &status=joined
Api-Version-Date: 2026-09-02-2
```

- **Permission required:** `company:authorized_user:read`
- **Live:** exists at the pin; returns `401` unauthenticated, so the endpoint is
  real and gated rather than absent
- **Returns:** `data[]` of `account_id`, `user`, `role`, `authorized_role`,
  `status`, `is_agent`, `email`, `created_at`, `updated_at`

`role` is a closed enum: `owner`, `admin`, `sales_manager`, `moderator`,
`advertiser`, `app_manager`, `support`, `manager`, `workforce`, `custom`.

This is the endpoint to build on, because it is the only one that returns the
actual role. Authorization rules that follow from it:

- Authorize the operator surface only for an explicit role allowlist. Start with
  `owner` and `admin`. Everything else — `support`, `moderator`, `workforce`,
  `advertiser`, `custom` — is denied by default and added deliberately, if ever.
- Require `status=joined`. Pending invites carry `ausri_` ids and a `null`
  user, and must never authorize anyone.
- Deny `is_agent: true` for writes. That flag marks an app-controlled account
  rather than a human.
- Do **not** request `company:authorized_user:email:read`. Without it `email`
  comes back `null`, which is exactly what City wants.

### Fallback — `GET /users/{id}/access/{resource_id}`

```
GET {WHOP_API_ORIGIN}/api/v1/users/{sub}/access/{WHOP_ACCOUNT_ID}
Api-Version-Date: 2026-09-02-2
```

- **Permission required:** none beyond an authenticated bearer
- **Live:** exists at the pin; returns `401` unauthenticated
- **Returns:** `{ has_access: boolean, access_level: "no_access" | "admin" | "customer" }`

> **Never authorize on `has_access`.** `access_level` includes `customer`, so
> `has_access` is true for anyone who merely bought something from the business.
> Treating it as an operator check would hand the operator surface — and the
> write path — to every customer. Require `access_level === "admin"`.

Even used correctly this is the weaker option: it collapses every team role into
`admin` and cannot tell an owner from a `support` or `workforce` member. Whether
those low-privilege roles report as `admin` is unknown and is a spike question.

### Rejected — `GET /permissions`

`GET /permissions?resource_id=…` answers only for the credential that made the
request: it "never describes who else can reach the resource." Called with the
injected site credential it describes the app, not the visitor, so it cannot
answer this question. It stays in the spike for a different purpose — finding
out what the injected credential itself is allowed to do.

## Identity

OAuth 2.1 + PKCE, `S256`, with `state` and `nonce`, against
`https://api.whop.com/oauth/{authorize,token}`.

**Scopes requested: `openid` only.**

- `openid` yields `sub`, the `user_` tag, which is the entire input to the
  membership check.
- `profile` is **not** requested. `GET /users/{sub}` is public — verified live,
  returning `200` with username, name, and picture and no credential at all —
  so City can resolve a display name for the receipt without asking for a
  scope.
- `email` is **not** requested. No v1 feature sends mail.

Do not pass `company_id` on the authorize request. It scopes the token to a
business, which is the cross-business integration shape being avoided. City
wants identity and nothing else.

The access token is exchanged server-side, used once to read `sub`, and
discarded. It is never stored, never refreshed, and never reaches the browser.
What the browser receives is City's own session cookie.

## Session

- `httpOnly`, `Secure`, `SameSite=Lax`, host-only, short expiry (30 minutes
  suggested, sliding on activity).
- Contents: the `sub`, the resolved role, the `WHOP_ACCOUNT_ID` it was issued
  for, and issue/expiry times — signed, not merely serialised.
- Bound to `WHOP_ACCOUNT_ID`, so a cookie from one deployed Blueprint is
  meaningless at another.
- **Re-check membership on every consequential request, not at login only.**
  A session proves who the visitor is; it does not prove they are still on the
  team. Role can be revoked between login and confirmation.

## Server-route policy

No route may call the Whop API on behalf of an unidentified visitor.

| Class | Rule |
| --- | --- |
| Public `GET` | Returns the privacy-safe City projection only: district health, tier, direction, visual variant, and freshness. No absolute revenue, customer counts, customer records, product titles or rosters, plan pricing, team details, or Whop object ids. |
| Private `GET` | Requires a verified operator session. Re-checks membership. |
| `POST` / `PUT` / `PATCH` / `DELETE` | Requires a verified operator session, a **fresh re-check** of membership against the role allowlist, and an action-specific confirmation token bound to that exact intent hash, that session, and a short expiry. |
| Generic proxy | **Forbidden.** No route may forward an arbitrary path, method, or body to the Whop API. Every Whop call is a named server function with a fixed method and a validated payload. |

The privacy-safe projection is built by a dedicated function whose output type
contains no sensitive field, so a leak is a type error rather than a review
miss.

## Blueprint bootstrap — the open problem

Each Blueprint deployment registers a **new app** with its own `app_` id and its
own route. OAuth needs three things per deployment, and only one of them is free.

| Need | Status |
| --- | --- |
| `client_id` | Free. It is the app id, available at runtime as the `APP_ID` binding. |
| Registered redirect URI | Must be an exact match, and a new deployment has none. |
| Client secret | Avoidable — `oauth_client_type` can be `public`, which is PKCE-only with no secret. |

`GET /apps/{id}` is public — a fake id returns `404`, not `401` — and exposes
`route`, `hosted_url`, `redirect_uris`, `oauth_client_type`, and `app_type`. So
a deployed City can read its own configuration at boot with no permission and
detect whether it still needs bootstrapping.

Registering the URI needs `PATCH /apps/{id}`, which requires
`developer:update_app`. So:

- **If the injected credential holds `developer:update_app` on its own app,**
  City self-registers `https://{route}.whop.site/auth/whop/callback` and sets
  `oauth_client_type: public` on first boot, and Blueprint deployment stays a
  one-step operation.
- **If it does not,** every deployer performs one documented manual step before
  the operator surface works. The public city still renders.

This is the single largest unknown in option C and the spike must settle it.

## Receipts

Each receipt records actor identity, timestamp, intent hash, Whop object id,
status, and the API version pin.

There is no datastore, so a successful receipt is stamped into the created
product's own `metadata` and read back from it.

> **Privacy hazard.** `GET /products/{id}` is public and its response includes
> `metadata`. An actor's raw `user_` id written there would be world-readable to
> anyone who learns the product id. Store a salted hash of the actor instead,
> and render the readable identity only on the gated receipt view, resolved from
> the session.

Suggested metadata keys: `whop_city_intent_hash`, `whop_city_actor_hash`,
`whop_city_confirmed_at`, `whop_city_api_version`, `whop_city_status`. The Whop
object id is the product's own id.

A **failed** write creates no product to stamp. v1 surfaces failures in the
session and in `whop apps logs`, retained 7 days, and does not claim a durable
failure ledger.

## What the spike must run

All of it through `whop apps dev` against the dedicated test business. No
deploy, no publication, no product creation without a separate approval.

1. Print the runtime environment and record which bindings exist in dev versus
   hosted — specifically whether `WHOP_ACCOUNT_ID` and `WHOP_API_ORIGIN` are
   set, since the quickstart documents only `WHOP_APP_ID` and `WHOP_API_KEY`.
2. `GET /permissions?resource_id={WHOP_ACCOUNT_ID}` with the injected
   credential. Record the full granted list. Specifically: is
   `company:authorized_user:read` granted? Is `developer:update_app`?
3. `GET /team_members?account_id={WHOP_ACCOUNT_ID}&status=joined` — does it
   succeed, and what `role` does the business owner return?
4. `GET /users/{owner_sub}/access/{WHOP_ACCOUNT_ID}` — what `access_level`?
   Then repeat for a user who is **not** on the team, and confirm `no_access`.
   If a low-privilege team role can be arranged, record what it reports.
5. `GET /apps/{APP_ID}` — record `route`, `hosted_url`, `redirect_uris`,
   `oauth_client_type`, and confirm `app_type` is `website`.
6. Confirm both error envelopes are handled: the API uses
   `{"error":{"type":…,"message":…}}` and the OAuth endpoints use
   `{"error":…,"error_description":…}`. Both verified live.

**Expected output:** a table of granted permissions for the injected
credential, the concrete role and access level the test owner reports, the
non-member's result, and a yes/no on `developer:update_app` — which decides
whether Blueprint deployment stays one-step.

## Verified facts and their sources

| Fact | How |
| --- | --- |
| `GET /users/{id}/access/{resource_id}` needs only a bearer; returns `has_access` and `access_level` of `no_access`/`admin`/`customer` | OpenAPI; live `401` unauthenticated |
| `GET /team_members` needs `company:authorized_user:read`; `role` enum has ten values; `status` is `joined`/`pending`; `is_agent` marks app accounts | OpenAPI; live `401` unauthenticated |
| `GET /permissions` answers only for the calling credential | Whop docs, verbatim |
| `GET /users/{id}` is public | Live `200` with no credential |
| `GET /apps/{id}` is public and exposes `redirect_uris` and `oauth_client_type` | OpenAPI; live `404` for an unknown id, not `401` |
| `oauth_client_type` is `public` or `confidential` | OpenAPI |
| `PATCH /apps/{id}` accepts `redirect_uris`, needs `developer:update_app` | OpenAPI |
| The address is `<route>.whop.site` | OpenAPI field description: "Claimed subdomain route where hosted web builds are served (`myapp` for myapp.whop.site)" — this also settles the `.whop.app` wording in the CLI's help |
| `app_type` cannot change once `website` | OpenAPI: "Cannot be changed on an app whose type is already `website`" |
| OAuth token endpoint is live and uses the OAuth error envelope | Live `400 unsupported_grant_type` |
