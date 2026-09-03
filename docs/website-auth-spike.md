# Operator authentication: endpoint and permission model

Answers the question the operator gate depends on:

> Is authenticated user X currently an owner or team member of
> `WHOP_ACCOUNT_ID`?

Whop City stays an app of type `website` and a Blueprint. Whop OAuth is used
**only to learn who the visitor is**. It is not a seller-install consent model,
it grants City nothing over anyone else's business, and it does not make this a
`b2c_app`.

Status: **the spike has now been run.** Results are in
[Spike results](#spike-results) below, and they change the design in four
places. The endpoint and permission model in this section survived contact with
the live API; the *runtime* assumptions underneath it did not.

- API version pin: `2026-09-02-2`
- Run 2026-09-03 against `https://api.whop.com`
- Test business `biz_xPy7WHYB7QGju5`, app `app_USXOBX9htLTka7`
- Reproduce with `node scripts/auth-spike.mjs`, which is read-only by
  construction and writes a redacted report to the git-ignored `probe-reports/`

> **The headline caveat.** The credential used was a **business API key**, not
> the credential a hosted Whop site is handed at runtime. Those are not the same
> thing, and the difference is not cosmetic — see
> [What this spike could not answer](#what-this-spike-could-not-answer). Every
> permission number below describes the API key, so none of them can be quoted
> as "what the injected credential can do."

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
- Do **not** request `company:authorized_user:email:read` — but do not rely on
  that alone. The spike found the test credential already holds it, and `email`
  came back **populated**. Not requesting a permission is not the same as not
  having it: an API key minted from the dashboard carries the business's whole
  authority regardless of what City asks for. The membership check must
  therefore *discard* `email` explicitly at the parse boundary rather than
  assume the API withheld it.

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

| Need | Status after the spike |
| --- | --- |
| `client_id` | Free. It is the app id, and `WHOP_APP_ID` is confirmed present in the runtime. |
| Registered redirect URI | Confirmed empty on a fresh app, and confirmed blocking: `GET /oauth/authorize` fails on `redirect_uri is invalid` before it even looks at `scope`. |
| Client secret | **Not avoidable for free.** A fresh `website` app is `oauth_client_type: confidential`. Moving it to `public` is itself a `PATCH /apps/{id}`. |

`GET /apps/{id}` is public — confirmed live, a fake id returns `404` and a real
one returns `200` with no credential — and exposes `route`, `hosted_url`,
`redirect_uris`, `oauth_client_type`, `required_scopes`, and `account.id`, while
withholding `secrets`. So a deployed City really can read its own configuration
at boot with no permission and detect whether it still needs bootstrapping. That
part of the plan survives, and it is also how City should learn its own business
id now that `WHOP_ACCOUNT_ID` is known to be absent.

Registering the URI needs `PATCH /apps/{id}`, which requires
`developer:update_app`. So:

- **If the injected credential holds `developer:update_app` on its own app,**
  City self-registers `https://{route}.whop.site/auth/whop/callback` and sets
  `oauth_client_type: public` on first boot, and Blueprint deployment stays a
  one-step operation.
- **If it does not,** every deployer performs one documented manual step before
  the operator surface works. The public city still renders.

The spike narrowed this but did not close it. A business API key holds
`developer:update_app` and `developer:manage_oauth`, so the two writes are
possible in principle. Whether the *runtime* credential holds them is still
unknown, for the reason in
[What this spike could not answer](#what-this-spike-could-not-answer). Note also
that the bootstrap now needs **two** writes rather than one, since the client
type has to be flipped as well as the URI registered.

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

## Spike results

Run against `biz_xPy7WHYB7QGju5` with app `app_USXOBX9htLTka7`, API version
`2026-09-02-2`. Nothing was deployed, published, or written.

### 1. The runtime bindings are not what the architecture assumed

Measured by running a probe as the dev script under `whop apps dev` and printing
variable *names* only:

| Binding | Under `whop apps dev` |
| --- | --- |
| `WHOP_APP_ID` | present |
| `WHOP_API_KEY` | present |
| `WHOP_ACCOUNT_ID` | **absent** |
| `WHOP_API_ORIGIN` | **absent** |

The architecture treats `WHOP_ACCOUNT_ID` as the spine of the whole design — the
membership query filters on it, the session is bound to it, and the privacy-safe
projection is scoped by it. It is not injected in dev, so nothing that reads it
can work locally as written.

**The fix is cheap and makes the app more portable, so adopt it regardless.**
Derive the business from the app: read `WHOP_APP_ID`, call `GET /apps/{id}`, and
take `account.id`. The spike confirmed that endpoint is public and returns
`account.id`, so this works at boot with no credential and no extra permission.
`WHOP_ACCOUNT_ID` becomes an optional override rather than a requirement, and
one code path then serves dev and hosted alike.

`WHOP_API_ORIGIN` should be treated the same way: default to
`https://api.whop.com` and let the variable override it, rather than requiring it.

### 2. `whop apps dev` does not scope the credential it injects

The CLI's own help states it: *"An explicitly exported `WHOP_API_KEY` is used
as-is."* The spike confirmed it by comparing SHA-256 fingerprints of the
exported and injected values in memory — they are identical. So:

| How the CLI is credentialed | What the dev runtime receives |
| --- | --- |
| `WHOP_API_KEY` exported | that same key, verbatim, unscoped |
| Logged in via `whop login`, nothing exported | a short-lived minted token |
| Neither | nothing — `whop apps dev` refuses to start with `NOT_AUTHENTICATED` |

This matters because the documented safety property of Whop hosting — *"the key
never reaches your code, so it can't be read, logged, or bundled"* — describes
the **hosted** proxy. It is not true of local dev, where the key sits in
`process.env` and any server route can read it. Treat dev as the weaker
environment and never let a local convenience become a deployed behaviour.

### 3. The operator gate works, and the deny path is a 200

Both endpoints behaved exactly as the model needs:

| Subject | `GET /team_members` | `GET /users/{id}/access/{biz}` |
| --- | --- | --- |
| Business owner | one row, `role: owner`, `status: joined`, `is_agent: false` | `has_access: true`, `access_level: admin` |
| Non-member (`@whop`, `@jack`) | `data: []` | `has_access: false`, `access_level: no_access` |

Two implementation notes fall out of this:

- **Denial is an empty array with HTTP 200, not a 404 or a 403.** Code that
  branches on the response status will authorize everyone. The check must be on
  `data.length === 1` *and* the role allowlist *and* `status === "joined"` *and*
  `is_agent === false`.
- **`email` came back populated**, because this credential holds
  `company:authorized_user:email:read`. Discard it explicitly; do not assume the
  API withheld it.

`authorized_role` was `null` for the owner, so the ten-value `role` enum remains
the only field worth authorizing on.

### 4. Both decisive permissions are granted — but on the wrong credential

`GET /permissions?resource_id=biz_…` returned 257 actions, 246 granted:

| Action | State |
| --- | --- |
| `company:authorized_user:read` | granted |
| `developer:update_app` | granted |
| `developer:manage_oauth` | granted |
| `developer:manage_webhook` | granted |

Only 11 actions were denied, all of them about editing team roles and app
authorizations: `authorized_user:update`, the four `authorized_role:*` verbs, the
three `app_authorization:*` verbs, `developer:manage_api_key`,
`developer:update_app_authorization`, and `crypto_wallet:manage`.

Read that list the other way and it is alarming: the credential is granted
`company:delete`, `company:transfer_ownership`, `payout:withdraw_funds`,
`payout:transfer_funds`, and `payment:charge`. A dashboard API key is **not** a
scoped app credential — it is the business's full authority in one string. It
directly contradicts the documented property that the injected key "can't move
money", which is further evidence the two credentials are different things.

So the answer to "does the injected credential hold `developer:update_app`?" is
still **unknown**. What the spike established is that a *business API key* holds
it, which tells us the Blueprint bootstrap is solvable by *someone*, not that it
is solvable by the deployed site itself.

### 5. The address is `.whop.site`, now confirmed from a live record

`GET /apps/app_USXOBX9htLTka7` returns `hosted_url: "https://city-spike.whop.site"`.
The CLI's `*.whop.app` help text is stale. This is no longer an inference from a
field description — it is the live value on a real app.

### 6. Two OAuth assumptions were wrong

| Field | Assumed | Actual on a fresh `website` app |
| --- | --- | --- |
| `oauth_client_type` | `public`, avoiding a per-deployment secret | **`confidential`** |
| `required_scopes` | `openid` | **`["read_user"]`** |
| `redirect_uris` | empty, needs registering | empty — confirmed |

`oauth_client_type` defaulting to `confidential` is the more serious of the two:
the plan to avoid per-deployment client secrets by using a public PKCE client is
not free, and needs an explicit `PATCH /apps/{id}` per deployment — the very call
whose availability to the runtime is still unknown.

Whether `openid` is even an accepted scope for this app could not be settled.
`GET /oauth/authorize` rejects on `redirect_uri is invalid` before it validates
`scope`, and it does so identically for `openid`, `read_user`, and a deliberately
bogus scope. Registering a redirect URI is a mutation, so the question waits.

### 7. `whop apps init` creates a product, and the route cannot say "whop"

Two side effects worth writing down, because neither is documented on the
`apps init` help:

- **Registering the app created `prod_Yp7lnTxi59wlD` ("City Spike") and a $0
  one-time plan `plan_vC6MfecfPGMGP`, both `visibility: visible`.** An app is
  backed by a product on Whop; you do not get to register one without the other.
- **A route containing the word "whop" is rejected** with
  `Username can't contain word whop`. So `whop-city` is not a claimable
  subdomain and never was. The spike used `city-spike` deliberately, so that the
  throwaway test business does not squat whatever route the real deployment
  eventually wants.

The product is world-readable, and `GET /products/{id}` returns `metadata` with
no credential — confirmed live against the product the init created. The receipt
design's actor-hashing requirement is therefore load-bearing, not precautionary.

### 8. Both error envelopes confirmed

Unchanged from the earlier desk check, now re-confirmed against live responses:

```
API    404  {"error":{"type":"not_found","message":"Resource not found"}}
OAuth  400  {"error":"unsupported_grant_type","error_description":"grant_type is not supported"}
```

## What this spike could not answer

Three questions remain open, and each is blocked by something outside the
approved scope. None should be quietly assumed in either direction.

**What the hosted runtime actually injects.** Everything above measures
`whop apps dev`. The hosted environment is documented to differ — that is the
whole reason the question was asked — and settling it requires a deploy.

**What the injected credential is granted.** Answering it needs
`whop apps dev` to mint a token from an OAuth CLI login rather than pass an API
key through, which needs an interactive browser login the Cloud Agent cannot
perform. Until then, the 246-of-257 figure describes a dashboard API key and
nothing else.

**What a plain customer reports.** The fallback gate is only safe because
`access_level` distinguishes `admin` from `customer`, and that distinction is
exactly what was not exercised: the test business has one member and no
customers. Manufacturing one means creating a product and a membership. The same
gap covers low-privilege roles — whether `support` or `workforce` collapses to
`admin` is still unverified, and inviting a second member is a mutation too.

Until a real `customer` has been observed returning `access_level: "customer"`,
**the fallback gate should not be shipped as the only check.** Build on
`GET /team_members`, which returns the actual role and needed no such inference.

## Reproducing this

```
WHOP_API_KEY=… node scripts/auth-spike.mjs --account biz_… --app app_…
```

The script refuses to run anything but read-only CLI verbs, never puts the
credential on a command line, and scrubs both the credential and e-mail local
parts from everything it prints or saves. Its report goes to `probe-reports/`,
which is git-ignored.

## Verified facts and their sources

Everything marked **run** below was exercised against the live test business on
2026-09-03 and appears in the report `scripts/auth-spike.mjs` regenerates.

| Fact | How |
| --- | --- |
| `GET /team_members` answers the gate: owner returns `role: owner`, `status: joined`, `is_agent: false`; a non-member returns `data: []` under HTTP `200` | **run** |
| `GET /users/{id}/access/{resource_id}` returns `admin` for the owner and `no_access` for non-members | **run** |
| A credential can hold `company:authorized_user:email:read` without asking, and then `email` is populated | **run** |
| A business API key is granted 246 of 257 actions, including `company:delete`, `company:transfer_ownership`, and `payout:withdraw_funds` | **run** |
| `whop apps dev` injects `WHOP_APP_ID` and `WHOP_API_KEY`, and neither `WHOP_ACCOUNT_ID` nor `WHOP_API_ORIGIN` | **run** |
| An exported `WHOP_API_KEY` is passed to the dev runtime verbatim, not minted | **run**, by SHA-256 fingerprint comparison in memory |
| `whop apps dev` refuses to start with `NOT_AUTHENTICATED` when no key is exported and no profile is saved | **run** |
| The address is `<route>.whop.site` | **run** — a live app record returns `hosted_url: https://city-spike.whop.site`, settling the `.whop.app` wording in the CLI's help |
| A fresh `website` app is `oauth_client_type: confidential` with `required_scopes: ["read_user"]` and no `redirect_uris` | **run** |
| `GET /oauth/authorize` rejects on `redirect_uri` before validating `scope` | **run** — identical error for `openid`, `read_user`, and a bogus scope |
| A route may not contain the word "whop" | **run** — `Username can't contain word whop` |
| `whop apps init` also creates a product and a $0 one-time plan, both `visibility: visible` | **run** |
| `GET /apps/{id}` is public, exposes `redirect_uris`, `oauth_client_type`, and `account.id`, and withholds `secrets` | **run** — `200` with no credential, `404` for an unknown id |
| `GET /products/{id}` is public and returns `metadata` | **run** — `200` with no credential |
| `GET /users/{id}` is public | **run** — `200` with no credential |
| Both error envelopes | **run** — `{"error":{"type":…,"message":…}}` and `{"error":…,"error_description":…}` |
| `GET /permissions` answers only for the calling credential | Whop docs, verbatim |
| `PATCH /apps/{id}` accepts `redirect_uris`, needs `developer:update_app` | OpenAPI — not exercised, it is a mutation |
| `app_type` cannot change once `website` | OpenAPI: "Cannot be changed on an app whose type is already `website`" — not exercised |

One inconsistency worth knowing about: the nested `account.route` on
`GET /apps/{id}` reported `city-9fc5`, while `GET /accounts/{id}` reported
`biz_xPy7WHYB7QGju5` for the same business at the same moment. Treat the
account endpoint as canonical and do not build links from the nested projection.
