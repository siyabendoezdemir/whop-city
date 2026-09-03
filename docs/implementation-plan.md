# Whop City Implementation Plan

> **Architecture revision.** This plan replaces an earlier one built on seller
> OAuth, an app-install permission matrix, and an external Hetzner API. That
> model was wrong for what Whop City is. Read
> [`docs/architecture-website-blueprint.md`](architecture-website-blueprint.md)
> first — it carries the diagram, the hosting-versus-persistence split, and the
> open decisions this plan assumes.

**Goal:** Ship a Whop Website, publishable as a Blueprint, that renders the
business it is deployed into as a bright low-poly startup city — reading that
business's real commerce data, surfacing deterministic missions, and performing
exactly one real Whop write through review → confirm → execute → receipt.

**Architecture:** One Vite application of Whop app type `website`, hosted by
Whop at `<route>.whop.site`. Its server routes are the only thing that talks to
the Whop API, and they do so through Whop's outbound proxy, which attaches the
app's own business key. Browser code never receives a key or a token. The public
city is browsable by anyone and shows a privacy-safe projection; the operator
surface is gated by a minimal identity-only "Sign in with Whop" that establishes
who the visitor is and confirms they are on this deployment's team. There is no
seller-install consent model, no business picker, and no external service or
database. All city state is derived from the business snapshot; the one write
records its receipt in the created product's own metadata.

**Tech stack:** TypeScript; React 19; Vite + TanStack Start; `whop()` plugin
from `@whop/cli/vite`; React Three Fiber + Three.js + Drei; Zustand; TanStack
Query; Whop REST API pinned with `Api-Version-Date`; the Whop pixel plus
`whop.track()`; Vitest; Playwright; GitHub Actions.

OAuth 2.1 + PKCE appears exactly once, for identity-only operator sign-in with
the `openid` scope, and holds no token past the exchange. Explicitly **not** in
the stack any more: seller-install consent, refresh tokens, a token vault,
Fastify, SQLite/Drizzle/`better-sqlite3`, a job runner, Socket.IO, Docker
Compose, Caddy, and Hetzner.

---

## Product contract

### First playable release — definition of done

Anyone can open the site at its `whop.site` route with no sign-in and see a
privacy-safe city: district health, tier, direction, and freshness, with no
figures that expose the business.

Someone operating the business that deployed the City Blueprint can additionally:

1. press "Manage this city", sign in with Whop, and be recognised as a member of
   this deployment's team — with no permission grant and no business picker;
2. see a city generated from that business's current data, not mock stats;
3. inspect three functional districts:
   - **Commerce Core** — revenue and customer signal;
   - **Offer Forge** — products, plans, pricing;
   - **Creator Quarter** — affiliate readiness, to whatever depth the API allows;
4. see deterministic, self-explaining missions derived from those systems;
5. trigger one permitted Whop write — create a hidden draft offer — through a
   mandatory review → explicit confirmation → execution → receipt sequence;
6. see the city update only after the write is confirmed by reading the
   business back;
7. see honest data freshness (`live`, `refreshing`, `delayed`) and an explicit
   refresh control, with no real-time claim;
8. use it on desktop; mobile shows city health and mission text without
   promising full 3D operation.

### V1 real action

**Create a hidden draft offer** — `POST /products` with `visibility: hidden`,
optionally carrying the affiliate percentage fields, which that endpoint
accepts at creation. It runs only after the operator reviews the exact fields
and presses a concretely labelled confirmation button. It carries an
`Idempotency-Key` and stamps the same key into the product's `metadata`, so a
replay cannot create a second offer even after Whop's 24-hour idempotency
window closes.

### V1 non-goals

- No payouts, transfers, refunds, price changes to a live offer, membership
  cancellations, bulk messages, affiliate invitations, ads, or anything that
  moves money.
- No automatic execution of a business action. Every write is confirmed.
- **No cross-business leaderboard.** It needs a service that sees every
  deployed instance, which a per-business website is not. Deferred on purpose.
- **No manual mission claims.** A `claimed` state that Whop data cannot derive
  has nowhere durable to live. v1 ships `available` and `verified` only.
- **Neither may be simulated.** No placeholder ranks, no claim button that only
  sets local state, no "coming soon" surface dressed as working functionality.
  Both need shared external persistence, and adding it is its own decision.
- **No near-real-time claim.** Whop's `REALTIME` binding is a single
  undocumented line with no page behind it. Until a website-native mechanism is
  proven, City refreshes on explicit action and on navigation.
- No open-world terrain, multiplayer, guilds, chat, or native apps.
- No paid asset purchase until Siya approves a specific licensed pack.
- No copy that names a Whop metric or action the spike has not verified.

### Visual contract

- Original bright modern-startup city: sunlit, product-company feeling; no
  copying of Whop brand components or Clash of Clans art.
- One explorable isometric block: three built districts, three visibly locked
  future districts.
- The city is the default work surface, not a canvas surrounded by dashboard
  rails.
- Paper is the source of truth before production UI.

---

## Source constraints to preserve

- App type `website` is **permanent** and can never become a `b2c_app`.
- The injected key authenticates as the app's own business, never as a visitor,
  and cannot move money.
- The key never reaches application code. Server-side `fetch` to
  `process.env.WHOP_API_ORIGIN` is signed by the proxy; send
  `x-whop-inject-key: none` to opt a request out.
- Pin `Api-Version-Date` at the integration boundary, in one config value,
  contract-tested. An unpinned request is served pre-versioning `2025-01-01`
  behaviour.
- Reserved bindings — `APP_ID`, `BUILD_ID`, `WHOP_API_ORIGIN`,
  `WHOP_ACCOUNT_ID`, `ASSETS`, `REALTIME` — cannot be shadowed by a secret.
- `whop apps dev` and the hosted runtime are **not** the same environment. Dev
  supplies `WHOP_APP_ID` and a short-lived `WHOP_API_KEY`; production supplies
  the proxy and the bindings above. One server code path must handle both.
- A `whop.site` route is publicly browsable and has no automatic visitor
  identity — `x-whop-user-token` exists only for iframe apps. Nothing sensitive
  renders publicly, and no write executes without a verified operator session
  plus a fresh action-specific confirmation.
- No server route forwards an arbitrary path, method, or body to the Whop API.
- OAuth is identity-only, `openid` alone, with the token discarded after the
  exchange. It never reaches the browser and is never persisted.
- `has_access` is not an authorization signal: `access_level` includes
  `customer`, so a buyer would pass. Require `access_level === "admin"`, or
  better, an explicit `role` from `GET /team_members`.
- Rate limit: 600 requests per minute per operation per credential.

---

## Repository

Single package at the repository root, so `whop apps deploy` archives exactly
the site and a Blueprint cloner receives exactly the site.

```text
whop-city/
├── src/
│   ├── routes/
│   │   ├── index.tsx                 # the city
│   │   └── api/                      # server routes; the only Whop API callers
│   ├── components/
│   │   ├── city/                     # canvas, camera, district meshes
│   │   ├── missions/
│   │   └── operations/               # review, confirm, receipt
│   ├── server/
│   │   ├── whop-client.ts            # pinned adapter over WHOP_API_ORIGIN
│   │   ├── snapshot.ts               # normalized business snapshot
│   │   ├── operations.ts             # intent, confirm, receipt
│   │   └── guard.ts                  # operator gate for every write
│   ├── engine/                       # deterministic snapshot → city state
│   ├── lib/
│   │   ├── redaction.ts              # retained from the earlier spike
│   │   └── tracking.ts               # whop.track() wrappers
│   └── styles/
├── public/assets/                    # only redistributable assets
├── tests/
│   ├── contracts/
│   ├── e2e/
│   └── fixtures/
├── docs/
├── vite.config.ts
├── whop.app.json                     # written by whop apps init
├── package.json
└── README.md
```

---

## Data model

There is no database. State is either derived from Whop or carried by a Whop
object.

| Concept | Where it lives |
| --- | --- |
| Business snapshot | In memory per request, from the Whop API |
| District state | Derived from the snapshot by the engine |
| Missions | Derived from the snapshot by versioned rules |
| Operation intent | A signed, short-expiry token round-tripped through the browser; never trusted back as free-form input |
| Operation receipt | The created product's `metadata`, holding the intent hash and confirmation time |
| Freshness | Timestamp of the snapshot, compared at render |

### City engine

Deterministic and testable. Accepts a normalized snapshot, emits:

```ts
CityState = {
  cityLevel: number;
  vitality: 0..100;
  updatedAt: string;
  freshness: 'live' | 'refreshing' | 'delayed';
  districts: Array<{
    id: 'commerce' | 'offers' | 'affiliates' | 'traffic' | 'community' | 'growth';
    level: number;
    health: 'thriving' | 'steady' | 'blocked' | 'unbuilt' | 'unavailable';
    direction: 'up' | 'flat' | 'down';
    explanation: string;
    visualVariant: string;
  }>;
}
```

No black-box score. `unavailable` is a first-class health state: a metric City
cannot read is `null`, never `0`, and the district says so rather than showing
a failing business.

---

## Implementation tasks

### Task 1: Website capability and operator-auth spike through `whop apps dev`

**Objective:** Prove the hosting model and the operator identity check before
any product code. Everything runs against City's own test business.
[`docs/website-auth-spike.md`](website-auth-spike.md) carries the endpoint and
permission model this task verifies.

**Requires explicit approval before running.** `--app_type` is permanent, and
step 8 creates a real product.

**Steps:**

1. `whop apps init --app_type website --name "Whop City" --route whop-city`,
   pinned with `--company_id` to the test business. Scaffold to a scratch
   directory, move to the repo root, drop the nested `.git`.
2. Assert the registered app's type is `website` via `whop apps get --format json`.
3. Add a temporary server route that prints which runtime bindings exist, so
   the dev-versus-hosted asymmetry is measured rather than assumed —
   specifically whether `WHOP_ACCOUNT_ID` and `WHOP_API_ORIGIN` are set under
   `whop apps dev`.
4. Call `GET /permissions?resource_id=$WHOP_ACCOUNT_ID` server-side and record
   the full granted/denied list for the injected credential. Note in particular
   whether `company:authorized_user:read` and `developer:update_app` are
   granted.
5. **Operator identity.** Run the identity-only OAuth flow end to end: `openid`
   only, PKCE with `state` and `nonce`, server-side exchange, token discarded
   after reading `sub`. Then resolve membership two ways and compare:
   `GET /team_members?account_id=…&user_id=…&status=joined` for the precise
   role, and `GET /users/{sub}/access/{WHOP_ACCOUNT_ID}` for `access_level`.
   Record what the owner returns, and confirm a non-member returns `no_access`
   and an empty team-member list.
6. `GET /apps/{APP_ID}` and record `route`, `hosted_url`, `redirect_uris`, and
   `oauth_client_type`, so the Blueprint bootstrap question can be answered.
7. Read products, plans, members, memberships, and payments or stats for the
   website's own business; record which succeed and which are refused.
8. Create exactly one hidden product, only behind an explicit local
   confirmation step, carrying an `Idempotency-Key` and metadata. Submit the
   same intent twice and prove one product exists.
9. Grep the built client bundle and the served HTML for any credential, token,
   or session secret.
10. `whop apps deploy --preview` and confirm the build uploads without promoting.
11. Fire `city_loaded`, `district_opened`, `mission_reviewed`,
    `operation_confirmed`, and `operation_receipt_viewed` through `whop.track()`
    and confirm they arrive.

**Verification:** one recorded `whop apps dev` session showing the app type,
the permission list, the owner's role and access level, a non-member correctly
refused, the successful reads, one product created and not duplicated, a clean
bundle scan, a successful preview upload, and the five tracking events.

**Commit:** `test: prove the whop website capability and operator auth surface`

### Task 2: Product brief and approved Paper design

**Objective:** Freeze the job, IA, city grammar, and operating surfaces.

Write `docs/product-brief.md` and `docs/design-brief.md`. Component sheet:
district focus card, mission card, neutral operation button, confirm button,
receipt, freshness indicator, locked-district marker, mobile read-only card.
Design one real desktop city state and the full click path: city → district →
mission → operation review → confirm → receipt → updated city. Design the
public-versus-operator split agreed in the architecture document.

**Verification:** one approved artboard proving the journey with no dashboard
rails and no fake controls.

**Commit:** `docs: approve whop city v1 interaction design`

### Task 3: Server data layer and normalized snapshot

**Objective:** Turn the website's own business into trustworthy city input.

One typed adapter owning the version pin, `WHOP_API_ORIGIN`, the dev-versus-
hosted auth difference, pagination, validation, and redacted errors. Normalize
only metrics Task 1 verified. Persist nothing. Compute freshness and surface it.

**Verification:** contract tests over recorded fixtures prove normalization,
the null-not-zero rule, and that an unreadable metric degrades a district to
`unavailable`.

**Commit:** `feat: read the website's business into a normalized snapshot`

### Task 4: Deterministic districts and missions

**Objective:** Map business state to explainable visuals and useful next steps.

Versioned threshold tables for Commerce Core, Offer Forge, and Creator Quarter.
Every state carries an exact explanation and at most two suggested actions.
Three future districts seeded as locked, non-clickable roadmap objects showing
no data. Verification rules turn a fresh snapshot into `verified` completion.
City level changes are bounded and cannot jump from one raw metric.

**Verification:** fixture tests prove determinism, self-explanation, and that
no mission reaches `verified` without snapshot evidence.

**Commit:** `feat: derive city districts and missions from business state`

### Task 5: Operator identity and the server-route policy

**Objective:** Make sure a public route cannot leak the business or act on it.

Implement identity-only sign-in: OAuth 2.1 + PKCE with `state` and `nonce`,
`openid` only, exchanged server-side, token read once for `sub` and discarded.
Verify membership of this deployment's `WHOP_ACCOUNT_ID` against a role
allowlist of `owner` and `admin`, using `GET /team_members` where the injected
credential allows and `GET /users/{sub}/access/{…}` with
`access_level === "admin"` — never `has_access` — where it does not. Issue an
`httpOnly`, `Secure`, `SameSite` cookie with a short expiry, bound to that
account id. Re-check membership before every consequential write.

Enforce the route policy in one place, so a new route cannot opt out by
omission:

- public `GET` returns the privacy-safe City projection only, built by a
  function whose return type contains no sensitive field;
- private `GET` requires a verified operator session;
- every `POST`/`PUT`/`PATCH`/`DELETE` requires a verified operator session, a
  fresh membership re-check, and an action-specific confirmation token bound to
  the intent hash, the session, and a short expiry;
- no generic proxy route to the Whop API exists — every call is a named server
  function with a fixed method and a validated payload.

A shared-secret bypass may exist only behind an explicit non-production flag,
for local development, and must be unreachable on a deployed site.

**Verification:** tests prove an anonymous request receives no sensitive field
and cannot reach any write path; a signed-in non-member is refused; a signed-in
`customer` is refused despite `has_access` being true; a revoked role fails at
the write even with a still-valid cookie; a confirmation token cannot be
replayed or reused for a different intent.

**Commit:** `feat: gate the operator surface with whop identity`

### Task 6: The one safe operation and its receipt

**Objective:** Perform one real business action safely.

Build the intent server-side from a mission context; preview title, visibility,
affiliate configuration, and expected city consequence. Require a checkbox —
"This creates a real Whop product in this business" — and a concrete confirm
label. Generate the idempotency key before the request; expire unconfirmed
intents. Execute only on confirm, after re-checking membership, then validate
the response, read the business back, and show the receipt. Animate
construction only after that read.

The receipt records actor identity, timestamp, intent hash, Whop object id,
status, and the API version pin. With no datastore, a success is stamped into
the created product's `metadata` and read back from it. Because
`GET /products/{id}` is public and returns `metadata`, store a **salted hash**
of the actor rather than the raw `user_` id, and resolve the readable identity
from the session on the gated receipt view. A failed write creates no product,
so v1 surfaces failures in-session and in `whop apps logs` and does not claim a
durable failure ledger.

**Verification:** E2E proves cancellation writes nothing, confirmation produces
one product and one receipt, retry cannot duplicate it, and a failure produces
an honest failure state and no city upgrade.

**Commit:** `feat: create a real hidden offer with review and receipt`

### Task 7: The 3D city

**Objective:** Deliver the city from approved Paper as the primary surface.

Shortlist 2–3 commercial asset packs with price, license, attribution and
resale restrictions, and polygon budgets; get approval before any purchase.
Compose an original low-poly block. Camera pan, zoom, reset; safe hit targets;
reduced-motion; keyboard fallback; HTML overlay semantics. Three states per
district. Progressive loading, instancing, a usable loading state. Desktop
responsive; mobile read-only city health with full mission controls.

**Verification:** benchmark on a mid-tier laptop and a current mobile browser;
no canvas-only controls; screenshot comparison against approved Paper.

**Commit:** `feat: render the whop city game surface`

### Task 8: Tracking

**Objective:** Measure the funnel without inventing metrics.

Rely on the pre-installed pixel for page views, checkout views, and purchases.
Add `whop.track()` for `city_loaded`, `district_opened`, `mission_reviewed`,
`operation_confirmed`, and `operation_receipt_viewed`. Pass an `event_id` on
anything that can arrive twice, derived from the intent hash for operation
events. Fire where the action completes.

**Verification:** each event appears in the Websites dashboard, and a repeated
confirmation does not double-count.

**Commit:** `feat: track the city funnel`

### Task 9: Deploy, version, and roll back

**Objective:** A repeatable release path inside Whop hosting.

`whop apps deploy --preview` first; verify; then promote. Prove rollback by
promoting an earlier build. Store any configuration in `whop apps secrets`,
never in the repo. Read `whop apps logs` for the smoke test.

**Verification:** production smoke test — city loads from live business data,
one operation reviewed and cancelled, one confirmed, receipt shown, freshness
honest — then a proven rollback.

**Commit:** `ops: ship whop city to its whop.site route`

### Task 10: Publish the Blueprint

**Objective:** Make City deployable by other businesses. **Requires explicit
approval; publication is external, public, and revenue-attributed.**

Confirm the deployed copy runs against the deployer's own business and reads
their data, not City's. Confirm no City-specific secret or identifier is baked
into the archive. Document what a deployer gets and what City reads.

**Verification:** one test deployment from the gallery into a second throwaway
business renders that business's city, not City's.

**Commit:** `ops: publish whop city as a blueprint`

### Task 11: Documentation and launch evidence

Document local development against demo fixtures without a Whop credential,
every data category read, the operator gate, and the write safety boundary. Add
a 60–90 second demo script. Record only proven behaviour. Publish licensing for
every third-party asset.

**Verification:** a fresh clone runs in demo mode and a reviewer can tell what
is real, what is fixture, and how to report a security issue.

**Commit:** `docs: prepare public whop city launch`

---

## Testing and quality gates

- **Unit:** city rules, scoring, mission transitions, intent hashing, freshness.
- **Contract:** API version pin, adapter validation against recorded fixtures,
  idempotency including `Idempotent-Replayed`, redaction, and the OAuth
  primitives — PKCE challenge, `state`, `nonce`, and that the requested scope
  set is exactly `openid`.
- **Integration:** server routes under both the dev and hosted environment
  shapes; snapshot → city state.
- **E2E:** city load, district inspect, cancel operation, confirm operation,
  receipt, refresh and freshness.
- **Visual:** approved Paper state matched by desktop screenshot; mobile state.
- **Security:** no credential, token, or session secret in the client bundle,
  served HTML, or logs; no sensitive field on an ungated response; no write
  without a verified operator session plus a fresh confirmation; a signed-in
  `customer` refused despite `has_access`; a revoked role refused at the write
  even with a live cookie; a confirmation token neither replayable nor
  transferable to another intent; no generic proxy route exists.

---

## Sequencing and stop points

1. **Do not run the Task 1 spike** — including `whop apps init` — until Siya
   approves it explicitly. The app type is permanent and the spike creates a
   real product.
2. **Do not write product code** until Task 1's spike output and Task 2's Paper
   state are approved.
3. **Do not buy assets** until Siya approves a pack, license, and cost.
4. **Do not create any Whop product** outside the test business, and never
   without the review and confirmation UI.
5. **Do not deploy to production or publish the Blueprint** without explicit
   approval. Both are public and irreversible in effect.
6. Stop after Task 9 and treat Blueprint publication as a deliberate next
   increment.

## Risks and mitigations

- **A public route exposes the business.** Addressed by the split surface and
  identity-only operator sign-in. The residual risk is an implementation slip,
  so the route policy is enforced centrally and the privacy-safe projection is
  a distinct type.
- **Blueprint OAuth bootstrap.** A fresh deployment has no registered redirect
  URI. `oauth_client_type: public` removes the secret problem; whether City can
  self-register the URI depends on `developer:update_app`, settled in Task 1.
  Worst case is one documented manual step per deployment.
- **The injected credential's reach is unknown.** Settled in one call by
  `GET /permissions` in Task 1; build only what comes back granted.
- **Dev and hosted environments differ.** Measured in Task 1; one code path
  handles both, and integration tests cover both shapes.
- **No durable storage.** All state derived; manual claims and the leaderboard
  deferred rather than faked.
- **Whop data gaps.** Encode availability states rather than inventing a weak
  metric or rendering zero as failure.
- **Asset licensing versus a public repo.** Purchased files stay out of Git;
  publish a manifest and a free placeholder pack.
- **A Blueprint clone leaking City's own configuration.** Audited in Task 10
  before publication.
- **Scope creep.** Three functional districts and exactly one write.

## Sources

- Websites overview: <https://docs.whop.com/developer/websites/overview>
- Blueprints: <https://docs.whop.com/developer/websites/blueprints>
- Hosting: <https://docs.whop.com/developer/websites/hosting>
- Quickstart: <https://docs.whop.com/developer/websites/quickstart>
- Tracking: <https://docs.whop.com/developer/websites/tracking>
- Authentication: <https://docs.whop.com/developer/guides/authentication>
- OAuth: <https://docs.whop.com/developer/guides/oauth>
- Idempotency: <https://docs.whop.com/developer/api/idempotency>
- API versioning: <https://docs.whop.com/developer/api/versioning>
