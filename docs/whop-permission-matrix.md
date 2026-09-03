# Whop permission matrix

What Whop City is allowed to read, allowed to write, and cannot do at all.

**Status: Task 1 is NOT signed off.** Everything below is verified against
Whop's published API contract and against the live production API, but nothing
has been verified against a real Whop business, because this environment has no
Whop credentials and the Whop MCP server is unauthenticated. The blocking items
are listed under [Open items](#open-items-blocking-task-1-sign-off). Do not
start Task 2 until they are closed.

- Generated: 2026-09-03
- API version pin: `2026-09-02-2`
- Probe: `packages/whop-client/src/capability-probe.ts`
- Contract tests: `tests/contracts/whop-sandbox.spec.ts`

## How to read the verification column

| Level | Meaning |
| --- | --- |
| `spec` | Declared in Whop's published OpenAPI document. Machine-checked against `tests/fixtures/whop-openapi-scopes.json`, and re-checked against the live document by the `WHOP_LIVE_UNAUTH` test layer. |
| `live-anon` | Exercised against `https://api.whop.com` with no credential. Proves the operation exists at the pinned version and how it refuses an unauthorized caller. |
| `live-business` | Exercised against the dedicated test business with a real user OAuth token. **No row has reached this level yet.** |

`spec` is a strong signal — Whop states the docs and OpenAPI documents are the
source of truth for API behaviour — but it is not proof that a *seller's user
OAuth token* can perform the operation. That distinction is the entire point of
Task 1, and it is what remains open.

## Environment

| Setting | Value | Verification |
| --- | --- | --- |
| Production API | `https://api.whop.com/api/v1` | `live-anon` |
| Sandbox API | `https://sandbox-api.whop.com/api/v1` | `spec` |
| OAuth endpoints | `https://api.whop.com/oauth/{authorize,token,userinfo,revoke}` | `spec` |
| Version header | `Api-Version-Date` | `live-anon` |
| Version pin | `2026-09-02-2` (latest of 33 advertised) | `live-anon` |
| Unknown version | `400`, response names every supported version | `live-anon` |
| No version sent | Served as pre-versioning `2025-01-01` behaviour | `spec` |
| Rate limit | 600 requests/minute per operation per credential | `spec` |
| Error envelope | `{"error":{"type":"...","message":"..."}}` | `live-anon` |

The pin is not optional. A request with no `Api-Version-Date` and no API-key
pin is served the original `2025-01-01` shape, which predates the changes City
depends on — including `2026-09-02-1`, where payments became a native resource
and money fields became objects rather than bare numbers. The pin lives in one
config value (`WHOP_API_VERSION`) and is asserted by the contract tests.

## OAuth

City signs sellers in with OAuth 2.1 + PKCE and never holds a seller's API key.

| Element | Value |
| --- | --- |
| Authorize | `GET https://api.whop.com/oauth/authorize` |
| Token / refresh | `POST https://api.whop.com/oauth/token` |
| Identity | `GET https://api.whop.com/oauth/userinfo` |
| Revoke | `POST https://api.whop.com/oauth/revoke` |
| PKCE | `code_challenge_method=S256`, plus `state` and `nonce` |
| Access token lifetime | 1 hour |
| Refresh tokens | Rotate on every use; store the new one every time |
| Business scoping | Optional `company_id` on authorize; **the same `company_id` must be sent on every refresh** |
| Client secret | Not exposed by `apps.create` in the SDK — copy it from the Dashboard |

### OIDC scopes City requests

| Scope | Requested | Why |
| --- | --- | --- |
| `openid` | Yes | Required. Yields `sub`, the `user_` tag City keys the player record on. |
| `profile` | Yes | Name, username, and picture for the signed-in header. |
| `email` | **No** | The leaderboard is anonymous and no v1 feature sends mail. Requesting it would be asking for data City has no use for. |

### App permissions City requests

Whop separates OIDC scopes from *app permissions*, which are declared in the
app's Permissions tab, justified per permission, marked required or optional,
and approved by the seller at install. Adding one later forces every existing
install to re-approve, and calls needing it fail until they do.

| Permission | Required? | Unlocks | Verification |
| --- | --- | --- | --- |
| `access_pass:basic:read` | Required | Offer Forge reads products | `spec` |
| `access_pass:create` | Required | The one v1 write | `spec` |
| `plan:basic:read` | Required | Offer Forge reads pricing | `spec` |
| `member:basic:read` | Required | Commerce Core customer count | `spec` |
| `payment:basic:read` | Required | Commerce Core revenue fallback | `spec` |
| `stats:read` | Optional | Commerce Core revenue series | `spec` |
| `affiliate:basic:read` | Optional | Creator Quarter | `spec` |
| `developer:manage_webhook` | Optional | Event-led live updates | `spec`, **feasibility unproven** |

Listing the seller's businesses and checking permissions need **no** app
permission at all — a bare authenticated bearer is sufficient. That keeps the
consent screen at sign-in minimal.

Whop publishes no enumerable list of requestable permissions: the
`PATCH /apps/{app_id}/permissions` body takes a free-form `action` string, and
the picker only exists in the Developer Dashboard. `GET /permissions` with the
`actions` parameter omitted returns the complete vocabulary for a resource, so
the probe calls it that way and records the result as `allPermissions`.

### Permissions City deliberately does not request

`payment:charge`, `payment:manage`, `membership:cancel`, `member:email:read`,
`member:phone:read`, `company:balance:read`, `payout:account:read`,
`access_pass:delete`, `access_pass:update`, `affiliate:create`. A contract test
fails if any of them appears in the requested set. Money movement, contact
details, and destructive edits are v1 non-goals; `company:balance:read` is
declined even though it would enrich the business picker, because balance is
not something City shows.

## Capability matrix

`Surface` distinguishes the versioned API (`native`, under `/api-reference/beta`,
where new integrations belong) from the legacy proxy (`legacy`, correct only
where a resource has no versioned successor).

| Capability | Operation | Surface | Least scope | Powers | Verification |
| --- | --- | --- | --- | --- | --- |
| Identity | `GET /oauth/userinfo` | oauth | `openid` | Sign-in | `spec` |
| Permission check | `GET /permissions` | native | bearer only | Diagnostics, district gating | `spec`, `live-anon` (401) |
| List businesses | `GET /accounts` | native | bearer only | Business selection | `spec`, `live-anon` (401) |
| Read products | `GET /products` | native | `access_pass:basic:read` | Offer Forge | `spec`, `live-anon` (200 public marketplace) |
| Read plans | `GET /plans` | native | `plan:basic:read` | Offer Forge pricing | `spec`, `live-anon` (401) |
| Read members | `GET /members` | native | `member:basic:read` | Commerce Core | `spec`, `live-anon` (401) |
| Read memberships | `GET /memberships` | native | `member:basic:read` | Commerce Core | `spec` |
| Read payments | `GET /payments` | native | `payment:basic:read` | Commerce Core | `spec`, `live-anon` (401) |
| Metric catalogue | `GET /stats` | native | bearer only | Metric discovery | `spec`, `live-anon` (401) |
| Metric series | `GET /stats/{metric}` | native | `stats:read` | Commerce Core revenue | `spec` |
| Read affiliates | `GET /affiliates` | **legacy** | `affiliate:basic:read` | Creator Quarter | `spec`, `live-anon` (401) |
| **Create draft offer** | `POST /products` | native | `access_pass:create` | The v1 write | `spec`, `live-anon` (401, no write occurred) |
| Read created offer | `GET /products/{id}` | native | none (public per spec) | Receipt confirmation | `spec` |
| List webhooks | `GET /webhooks` | native | `developer:manage_webhook` | Live updates | `spec`, `live-anon` (401) |
| Create webhook | `POST /webhooks` | native | `developer:manage_webhook` | Live updates | `spec`, `live-anon` (401, no write occurred) |

Every operation is declared with the cheapest security alternative Whop's spec
offers, and a contract test fails if a cheaper alternative exists.

### Confirmed readable metrics

These are the only metrics v1 may name in copy or render in a district.

**Commerce Core** — customer count from `GET /members`; active-versus-churned
from `GET /memberships` (filter `status`); revenue from `GET /stats/net_revenue`
with mandatory `from`/`to` and an explicit unit, falling back to counting
`GET /payments` rows when the seller declines `stats:read`. Payment amounts are
money objects (`{amount, currency, decimals, display_decimals}`), not numbers;
`settlement_time_at` is null on list rows and needs a retrieve.

**Offer Forge** — product count, `visibility`, `title`, `headline`, `labels`,
and the affiliate percentage fields from `GET /products`; plan count, billing
interval, price, and `visibility` from `GET /plans`.

**Creator Quarter** — affiliate count and per-affiliate status from
`GET /affiliates` (legacy, `account_id` required); whether a programme is
configured at all from `global_affiliate_status` /
`global_affiliate_percentage` on each product.

An unreadable metric is `null`, never `0`. `normalizeBusinessSnapshot` enforces
this and a contract test covers it: rendering an unreadable district as an
empty one would tell a seller their business is failing when City simply lacks
the scope.

## The confirmed safe write

**Create a hidden draft product** — `POST /products`, scope `access_pass:create`.

Nothing else. No payment, refund, price change to a live offer, membership
cancellation, payout, transfer, affiliate invitation, or bulk message.

`title` is the only required field (max 80 characters). The fields City sends:

| Field | Value | Why |
| --- | --- | --- |
| `account_id` | The selected business | Explicit rather than implied by the credential. |
| `title` | From the reviewed intent | Shown verbatim in the review step. |
| `visibility` | `hidden` | Keeps the draft off the seller's public storefront. A contract test fails if City ever sends `visible`. |
| `description` | From the reviewed intent | Optional. |
| `global_affiliate_percentage` | Optional, from the intent | The affiliate settings the plan wanted are accepted at creation, so no follow-up write is needed. |
| `metadata` | `{whop_city_idempotency_key: <sha256>}` | Durable idempotency, below. |

### Idempotency

Every authenticated `POST` on the current API accepts an `Idempotency-Key`
header. Whop stores the response for **24 hours**; a retry with the same key
replays it byte-for-byte, including the status code, with an
`Idempotent-Replayed: true` header.

The semantics City must respect:

- Same key with a different request body, path, query, or `Api-Version-Date` is
  a `400`. The version pin is part of the request identity, so changing the pin
  invalidates outstanding keys.
- Same key while the first request is still running is a `409`. Retry after it
  settles.
- Same key more than 24 hours later executes **fresh**.
- **A failed response is replayed too.** A stored `4xx` comes back on retry, so
  a corrected request needs a new key.
- Keys are scoped to the authenticated caller.

Because the guarantee expires after 24 hours and a mission can be retried days
later, City does not rely on it alone. The same key is stamped into product
`metadata`, and a pre-flight read short-circuits a replay before any write is
attempted. Both layers, plus the `Idempotent-Replayed` path, are covered by
contract tests.

## Webhook feasibility

Webhooks are technically viable and the mechanics are fully specified. Whether
a *seller* can grant City the permission to create one is unproven.

### What is settled

Whop implements the [Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks)
specification. Four headers are contractually frozen across every API version:
`webhook-id`, `webhook-signature`, `webhook-timestamp`, `content-type`.
Signature is HMAC-SHA256 over `{webhook-id}.{webhook-timestamp}.{raw body}`,
base64-encoded, presented as `v1,<signature>`. The secret is a `ws_` string
passed to the verifier as-is — not stripped of its prefix and not
base64-decoded. Reject anything whose timestamp is more than 5 minutes old.

Delivery matches the assumptions the plan already encodes: at-least-once, so
the same event can arrive twice with the same `webhook-id`; unordered, so a
newer event can arrive before an older one and order-sensitive changes must
re-read current state; respond `2xx` in under 5 seconds or it counts as a
failure; 12 retries over roughly 71 hours; and Whop disables an endpoint after
72 hours of total failure with 10 or more failed deliveries, sending no
back-fill when it is re-enabled.

Two operational constraints follow directly:

- `webhook_secret` is returned **only** on the create response and reads back
  `null` for OAuth and API-key callers afterwards. City must capture and
  encrypt it at creation. If it is lost, the webhook must be deleted and
  recreated — this belongs in the runbook.
- City must watch `enabled`, `disabled_at`, `disabled_reason`,
  `consecutive_failures`, and `failing_since`, and reconcile by polling after a
  disable, because Whop does not replay what was missed.

Pin each webhook's `api_version_date` to the same value as the REST pin.
Webhooks pinned before `2026-08-14`, and unpinned webhooks, carry `company_id`
where newer pins carry `account_id`.

### Events City subscribes to

`product.created`, `product.updated`, `product.published`,
`product.unpublished`, `product.deleted`, `plan.created`, `plan.updated`,
`plan.deleted`, `member.created`, `membership.activated`,
`membership.deactivated`, `payment.succeeded`, `payment.failed`.

`product.created` is what closes the loop on the v1 write: the city animates
construction on the event, not on the button click.

### The unresolved question

`POST /webhooks` requires `developer:manage_webhook`. Every other `developer:*`
permission is an app-developer operation (`create_app`, `manage_api_key`,
`manage_builds`, `update_app`), which suggests the namespace may not be offered
to a seller installing a third-party app. `resource_id` does default to the
current account, so the shape is right — a seller-scoped OAuth token creating a
webhook on that seller's own account. But shape is not permission.

`child_resource_events` does **not** solve this. It sends events "only from its
connected accounts" — a platform-and-connected-accounts topology. City's
sellers are independent businesses, not accounts connected under City, so a
single app-level webhook will not fan in their events.

If the permission turns out not to be grantable, the fallback is already in the
plan and needs no redesign: bounded polling for active sessions only, with the
15-second and 60-second cadences well inside the 600-requests-per-minute limit.
The UI must then never claim "real time" — only the `live` / `refreshing` /
`delayed` freshness states.

## What Whop cannot support

Remove each of these from v1 copy and UI.

| Assumption | Reality |
| --- | --- |
| Affiliate activity streams live | There is **no** affiliate webhook event of any kind. Creator Quarter is poll-only and must be labelled as such. |
| Affiliates are on the modern API | `/affiliates` exists only on the legacy proxy — absent from the versioned document — and returns a different 401 body than native endpoints. It has no versioned successor, so legacy is the correct choice, but the adapter needs a separate error path. |
| The sandbox can validate City end to end | The sandbox explicitly does not support **apps or messaging**, so the OAuth install and consent flow cannot be rehearsed there. Payouts are also unavailable and only card payments work. City's OAuth spike must run against production with a throwaway business. |
| The CLI is a safe rehearsal tool | The CLI has **no sandbox, test, or dry-run mode**. Every command runs in production and many create real resources or move real money. It also exposes no `--api-version` or `--base-url` flag. |
| The CLI reflects the pinned API | `whop@0.16.3` speaks `2026-08-25-2`, four versions behind the `2026-09-02-2` pin — across the `2026-09-02-1` release that restructured payments. Use the CLI for scaffolding and deploys; never as the contract reference. |
| The CLI can reach affiliates | There is no `affiliates` command group. Creator Quarter cannot be probed from the CLI. |
| A Whop-hosted website can read the visitor's business | The injected key "authenticates as your business, never as the visitor". It also cannot move money. Visitor identity requires OAuth, which is why the Hetzner worker exists. |
| Server-side fetches are untouched | On Whop hosting, an outbound proxy attaches the app's own key to Whop API requests. A call meant to carry a seller's OAuth token must send `x-whop-inject-key: none`. |
| The experimental spec is downloadable | `openapi/api-v1-native.yml` returns an HTML error page. The working URL is `openapi/api-v1-native.json`. |
| Listing businesses needs a business scope | It needs none. `company:balance:read` only unlocks balance fields and `order=volume`, neither of which City shows. |

## Reproducing this

```bash
pnpm install
pnpm test                      # 50 offline contract tests
WHOP_LIVE_UNAUTH=1 pnpm test   # + 11 live tests, network only, no secrets
pnpm probe                     # capability sweep; safe with no credentials
```

Against the test business, with `.env` filled in from `.env.example`:

```bash
WHOP_LIVE_SANDBOX=1 pnpm test                 # read-only sweep + replay check
WHOP_PROBE_ALLOW_WRITES=1 pnpm probe          # creates ONE hidden draft product
```

The probe holds credentials in a closure, never returns or logs them, refuses
writes unless explicitly enabled, redacts every captured fixture, and throws
rather than emit output that still looks like a credential. Reports land in
`probe-reports/`, which is git-ignored.

## Open items blocking Task 1 sign-off

Each needs a human with Whop Dashboard access and a dedicated throwaway test
business. None can be done from this environment: there are no Whop credentials
here and the Whop MCP server reports `needsAuth`.

1. **Create the test business and development app.** Record the ids in local
   `.env` only. Configure both redirect URIs (`http://localhost:3000/...` and
   the production callback) as exact matches.
2. **Confirm the Permissions tab actually offers each permission** in the table
   above — especially `developer:manage_webhook`. This is the single largest
   open risk. Capture the picker contents; Whop publishes no machine-readable
   list.
3. **Run the sweep** with a real seller OAuth token:
   `WHOP_LIVE_SANDBOX=1 pnpm test` and `pnpm probe`. Promote every row that
   returns `verified` from `spec` to `live-business`.
4. **Run the write once** with `WHOP_PROBE_ALLOW_WRITES=1`, then run it a second
   time with the same intent and confirm exactly one product exists. Confirm the
   created product is genuinely absent from the public storefront — `hidden` is
   assumed to mean that and has not been observed.
5. **Confirm `GET /products/{id}` on a hidden product.** The spec marks retrieve
   public, but a hidden product may 404 for an anonymous caller. The receipt
   flow depends on the answer.
6. **Create one webhook against the test business** with a public tunnel URL,
   send a test event, and verify the signature with the exact `ws_` secret and
   no preprocessing. Confirm whether `POST /webhooks` succeeds under a *seller's*
   OAuth token rather than a developer credential.
7. **Confirm the affiliate response shape** on a business that actually has an
   affiliate programme, so Creator Quarter reads real fields rather than
   inferred ones.

Until items 2, 3, 4, and 6 are closed, the matrix states what Whop's contract
promises, not what a Whop seller's token delivers.

## Sources

All fetched 2026-09-03. Append `.md` to any `docs.whop.com` URL for raw
Markdown; `https://docs.whop.com/llms.txt` indexes the whole site.

- OAuth: <https://docs.whop.com/developer/guides/oauth>
- Permissions: <https://docs.whop.com/developer/guides/permissions>
- Auth and API keys: <https://docs.whop.com/developer/guides/auth-scoping>
- API versioning: <https://docs.whop.com/developer/api/versioning>
- Idempotent requests: <https://docs.whop.com/developer/api/idempotency>
- Webhooks: <https://docs.whop.com/developer/guides/webhooks>
- Sandbox: <https://docs.whop.com/developer/guides/sandbox>
- Websites hosting: <https://docs.whop.com/developer/websites/hosting>
- CLI: <https://docs.whop.com/cli/overview> and <https://docs.whop.com/cli/agent-mode>
- OpenAPI (stable): <https://docs.whop.com/openapi/api-v1-stable.json>
- OpenAPI (current): <https://docs.whop.com/openapi/api-v1-native.json>
