# Whop City

A Whop Website that renders a business as a city. Three districts —
Commerce Core, Offer Forge, Creator Quarter — physically reflect a
server-derived projection of how the business is doing.

This increment is the **public, read-only vertical slice**. There is no
operator mode, no write path, no OAuth flow, no leaderboard, and nothing is
deployed.

```bash
pnpm install
pnpm dev            # http://localhost:3000
pnpm build && pnpm preview --port 4173
```

## The privacy boundary

The whole point of the architecture is that the browser learns what the
business *looks like* without learning anything about the business.

```
Whop API ──► whop-client.ts ──► snapshot.ts ──► project.ts ──► PublicCityProjection
             named GET readers   sensitive       the boundary   buckets and words
             (server only)       (server only)                  (the only thing sent)
```

**The client is given only this:**

```json
{
  "schema": "whop-city.public.v2",
  "freshness": "live",
  "seed": "4b09b5d4d445a397",
  "districts": [
    { "id": "commerce-core", "state": "healthy", "direction": "steady",
      "signal": "thriving", "parcels": 5, "variant": 0 }
  ]
}
```

Four physical states (`healthy` / `rising` / `dormant` / `struggling`), coarse
direction, signal and freshness words, an opaque seed, and two small bounded
renderer integers. No revenue, no price, no product or offer title, no customer,
no Whop identifier, no timestamp, no credential, no upstream response.

Two mechanisms hold that, because a comment does not:

- `PublicCityProjection` is a closed type of string-literal unions. Widening it
  is a visible type change.
- `serializeProjection` does **not** stringify the object it is handed. It
  rebuilds one field by field from a whitelist and validates every value against
  its allowed domain. A field added to the projection without also being added
  there cannot reach the wire, and a value outside its domain throws rather than
  being sent.

`tests/projection.test.ts` plants sentinel values — an account id, a product
title, a distinctive member count, a price — in a snapshot and proves none of
them survive serialisation, that fields smuggled onto the projection object are
dropped, and that no fractional number is ever emitted.

### The layout seed

The city must look the same every time a business opens it, which means the seed
is a stable function of who they are. It must not be a way to learn who they
are.

`deriveLayoutSeed` is HMAC-SHA-256 over the account id, truncated to 64 bits and
keyed with `CITY_SEED_SECRET` when the deployment provides one. The raw id never
leaves `server/seed.ts`.

**Set `CITY_SEED_SECRET` in any real deployment.** Without it the fallback is a
domain-separated SHA-256, which is still one-way but is only as strong as the
input space — account ids are short and structured, so a determined attacker who
knows the format could grind an unkeyed digest. The keyed path removes that.

### The one endpoint

The browser may call exactly one same-origin path:

```
GET /api/city/snapshot
```

It is mounted in `src/server.ts` — a custom TanStack Start server entry — as a
pathname **equality check** ahead of the router. There is no pattern, no
parameter and no dispatch table, so the set of endpoints the browser can reach
is that one literal.

> `wrangler.jsonc` points `main` at `src/server.ts`. Pointing it back at
> `@tanstack/react-start/server-entry` silently removes the endpoint.

Account context comes only from the deployment binding (`server/env.ts`). The
caller cannot choose an account, an origin, a path, a method, a header or a
body; `tests/snapshotRoute.test.ts` attempts all of them and asserts the
outbound call is unchanged.

`whop-client.ts` has no non-GET function in it, so no product route can reach a
payment, payout, transfer, account, team, OAuth-config or app-config action —
not behind a flag, not behind a session. It holds no credential: the hosted
runtime attaches the app key in an outbound proxy.

### What is not claimed

City controls its own payload; it does not control the platform's. Whop's
hosting injects its own pixel into every HTML response and publishes the
business id through it. See `docs/architecture-website-blueprint.md`. The
boundary above is about what *City* sends.

## Data source

Fixture-backed in this increment. `server/fixtures.ts` builds five deterministic
`BusinessSnapshot`s, so they run through the real projection rather than around
it — what reaches the browser has crossed exactly the same boundary live data
would.

`?scenario=` selects one, and it is honoured **only when the deployment
explicitly opted into fixtures** — see below.

| scenario | what it is | resulting city |
| --- | --- | --- |
| `balanced` *(default)* | established shopfront, freshly reworked pricing | Core healthy, Forge rising, Quarter healthy |
| `launch` | days old, nothing sold yet | everything rising or unbuilt |
| `thriving` | large catalogue, strong affiliate reach | all healthy, dense |
| `struggling` | built then shuttered: nothing visible | struggling and dormant |
| `unavailable` | the business could not be read | every district unbuilt, and the crest says so |

### Which source a deployment uses

`resolveSource` picks one of three, in this order:

| condition | source | what the browser sees |
| --- | --- | --- |
| `WHOP_API_ORIGIN` bound **and** `CITY_SEED_SECRET` usable | **live** | the real business |
| fixtures compiled in **and** `CITY_FIXTURES` set | **fixture** | the named scenario |
| neither | **none** | the unavailable city: every district dormant, `freshness: "unavailable"` |

Unknown scenario values fall back to the default silently rather than echoing
back, and in live mode the query string is not read at all.

### Fixtures are a build-time capability, not a runtime flag

There are two builds:

```bash
pnpm build            # deployable. No fixtures in it at all.
pnpm build:fixtures   # local visual work. vite build --mode fixtures
```

`vite.config.ts` replaces `__CITY_FIXTURES_BUILD__` with a literal. In a
deployable build it is `false`, so the fixture branch is dead code, and because
the scenario *names* live in `scenarios.ts` rather than `fixtures.ts` nothing
else references the fixture module — the bundler drops it, and the invented
business data with it. `tests/browser/production-build.spec.ts` greps the
deployable bundle for `fixture_account_`, `fixture_product_` and
`Fixture product` and requires all three absent.

`CITY_FIXTURES` is still needed on top of that, but only to decide whether a
build that *has* fixtures shows them. It cannot switch them on in a build that
does not.

This is the enforcement boundary, and it replaces an earlier version that relied
on `.dev.vars` not being uploaded. That is a convention, not a boundary: a
hosted deployment that acquired the variable by any other route could have
published an invented city as live. The regression test is the case where the
binding genuinely *is* present — `.dev.vars` still sets `CITY_FIXTURES=1` for
the local worker — and a production build ignores it, returning the unavailable
city and never `freshness: live`.

`pnpm capture`, `pnpm capture:fly` and `pnpm test:browser:fixtures` all need
`pnpm build:fixtures` first. `pnpm test:browser:production` needs `pnpm build`.

Without a live binding **no outbound request is attempted** — not a failed one,
not a timeout.

### A failed read is not an empty business

Every reader returns `{ ok: true, data }` or `{ ok: false }`, and the two never
collapse into the same `[]` on the way up. A refused connection, a timeout, a
non-OK status including 401 and 403, an unparseable body, or a 200 with no
account on it are all `ok: false`, and any one of them on a mandatory read makes
the whole capture fail and the city render unavailable.

**A 200 is not on its own a success.** Every mandatory response is checked
against the shape City actually needs, envelope *and* rows, because the failure
modes that matter are quiet ones.

The envelope must be an object with a `data` array on it — a missing `data` is
malformed, not an empty business — and every row must carry every field the
snapshot reads, in a shape the snapshot can read:

| row | validated |
| --- | --- |
| product | `id` non-empty string · `title`, `visibility` string or null · `member_count` quantity or null · `created_at` RFC 3339 or null · `default_plan` null or `{ id, plan_type }` |
| plan | `id` non-empty string · `plan_type`, `visibility` string or null · `created_at` RFC 3339 or null · `initial_price` null or `{ amount, currency }` |
| product detail | every product field, plus `global_affiliate_status` and `member_affiliate_status` string or null and `global_affiliate_percentage` quantity or null, and the `id` must be the one that was requested |

Presence is checked, not only type: a field the API declares as `string | null`
and simply omits is a malformed response rather than a null. `{ id: "prod_1" }`
would otherwise become a complete product with an empty title, an invisible
shopfront and no members — a live city built out of nothing.

A "quantity" is a finite number or a cleanly numeric string, matching what
`toNumber` accepts. Everything else is refused rather than normalised:
`parseFloat` would quietly turn `"12 members"` into 12 and `{}` into 0, and a
zero invented that way is indistinguishable from a real one by the time it
decides a district's state. Timestamps are checked for shape *and* calendar, and
`Date.parse` is not consulted at all: it accepts `"2026"`, and it silently rolls
an impossible date forward, so `2026-02-29` arrives as March 1st. Every
component is range-checked and the day is checked against the real length of its
month in its own year.

One malformed row fails the whole page: a partially-understood catalogue is not
a smaller catalogue.

`{ "data": [] }` is valid and stays a **live**, genuinely empty result, and so
is a row whose nullable fields are all genuinely null.

A business that genuinely has nothing in it is the opposite: a successful read,
a **live** city with every district `dormant` and signalling `unbuilt`. The
operator can therefore tell an empty shop from a broken city, which is the whole
point of the distinction — the failure mode is silent otherwise.

Every read is mandatory, including the per-product affiliate detail reads. That
is the strict choice: a failed detail read would otherwise render Creator
Quarter dormant, which reads as "nobody is affiliating" when the truth is that
we could not look.

### Request amplification

`/api/city/snapshot` is public and unauthenticated, and one call fans out into
up to twenty-seven upstream reads. `server/snapshotCache.ts` puts two things in
front of that and nothing else: concurrent requests resolving to the same
deployment wait on one capture, and a **successful** result is reused for a
bounded ten seconds.

The window is measured from when a capture *settles*, never from when it
started. An in-flight entry is shared however long it runs — measuring from the
start meant a capture slower than the window got joined by a second upstream
fan-out at exactly the moment the upstream was least able to take one.

It is deliberately not a shared or CDN cache. Entries are keyed by deployment
context built from bindings only — never from anything a caller sends — and held
in the isolate's memory, and the response is `private, no-store, max-age=0`. A
shared cache in front of this endpoint would be a way to serve one business's
city to another. A rejected capture is dropped the instant it settles, and so is a
result the route declines to keep — which is any unavailable projection. A
failed capture is therefore retried on the very next request rather than pinned
for the window, while callers already waiting on it still share that one
attempt.

## Deploying

Not done yet, and not to be done without explicit approval.

```bash
pnpm build            # produces dist/whop-build.zip
pnpm deploy           # whop apps deploy — uploads and promotes
pnpm deploy --preview # uploads a non-production build only
```

The target is fixed by `whop.app.json`: app `app_USXOBX9htLTka7`, route
`city-spike`, so the deployed URL is `https://city-spike.whop.site`.

**Required for a live city:** `WHOP_API_ORIGIN`, injected by the hosted Website
runtime. The business is derived from `APP_ID` via the public
`GET /api/v1/apps/{id}`, and `WHOP_ACCOUNT_ID` is an optional override. Without
the origin the city deploys and renders, honestly unavailable.

The origin is checked before use: https only, host `api.whop.com` or a
`.whop.com` subdomain, and no credentials, path or query on it. The bare
`whop.com` apex is refused — it is the marketplace website, not an API host.
Pinning to the single literal `https://api.whop.com` is a follow-up: the hosted
runtime supplies this value and its exact form is not documented, so narrowing
further is not verifiable without a live deployment.

**Also required:** `CITY_SEED_SECRET`, a stable random string of at least 16
characters. It keys the layout seed. Without it the deployment serves the
unavailable city rather than a real one, so a live City needs both bindings or
neither.

**Must not be set on a deployment:** `CITY_FIXTURES`. It is local-only by
construction, and setting it on a hosted City would publish invented business
state.

City holds no credential in any environment: the hosted runtime attaches the app
key in its outbound proxy.

## The renderer

Ported from the approved full-city art spike into `src/render`. Copied and
adapted, never imported: `art-spikes/` is isolated art evidence and is not a
runtime dependency.

Preserved as approved: the connected promontory composition, the fixed 45°
three-quarter camera, the world-fixed sun and shadow volume, 2× supersampling,
the physical progression grammar, merged static geometry and instanced props.

Changed: the spike's hard-coded state table is gone, including its hand-placed
struggling lot. `buildCity` takes a `PublicCityProjection`. The authored parcel
layout stays fixed — it is the approved composition — and the projection decides
how much of each district is built. The first `parcels` lots take the district's
state and the rest stand as dormant ground, rotated by `variant` so two
businesses in the same state do not develop the identical corner first.

### Why the sun does not move

`stage.frame()` moves the render camera and nothing else. The sun position, its
target and the six shadow-camera planes are set once, in world space, and never
touched again. Anything that varies them during a camera move remaps every
shadow texel to a different patch of world, and the whole city shimmers under a
dolly. `pnpm shadow-check` asserts the rig holds a single state across every
framing and zoom on the fly path.

### Budgets

Measured on the built app, worst case across all eight captured states:

| | measured | budget |
| --- | --- | --- |
| draw calls | 148 | 220 |
| triangles | 213,110 | 250,000 |

`artifacts/renderer-stats.json` carries the per-state figures.

## The shell

The world owns the viewport. What sits on it is a crest, a read-only marker,
district navigation and camera controls, all edge-anchored.

Selecting a district glides the camera into the neighbourhood and opens **one
sentence about what is physically visible there** — no cards, no charts, no
numbers, no generated text. The copy is a fixed line per district and state in
`city/explain.ts`, written against what the renderer actually builds so the
words and the world cannot drift apart. `tests/browser/shell.spec.ts` asserts
there is no digit anywhere in the shell.

## Verification

```bash
pnpm typecheck
pnpm test              # 27 node tests: the boundary and the route
pnpm build
pnpm preview --port 4173 &
pnpm test:browser      # 18 browser tests: data safety, the world, the shell
pnpm leak-check        # texture count returns to baseline after a state cycle
pnpm shadow-check      # shadow rig holds one state across the fly path
pnpm aliasing-check    # sub-pixel camera walk over the road network
pnpm capture           # stills + renderer stats -> ./artifacts
pnpm capture:fly       # deterministic fly-through -> ./artifacts
```

Captures target the **preview server**, so the evidence is of the built app
rather than a dev bundle. `CITY_URL` points them elsewhere; `ART_OUT` moves the
output; `SS` pins the supersampling factor.

The capture harness needs a Chrome or Chromium. It looks in the usual places and
falls back to Playwright's bundled build; `CHROME_PATH` overrides.

### Why capture is slow without a GPU

Rendering a frame of this city costs about six milliseconds under software
WebGL. *Presenting* one costs seven to fourteen seconds, and that cost is the
same whether the frame is reached through Playwright's screenshot, through
`canvas.toDataURL`, or by simply letting the page's own animation loop run —
which manages about 0.1 frames per second on a machine with no GPU. It is not
the resolution, the shell's blurred panels, or `preserveDrawingBuffer`; all
three were measured and none of them account for it.

The practical consequences: `SHOT_TIMEOUT` is generous, the fly-through is
composed and photographed frame by frame rather than screencast live, and it is
recorded at 960x600 (same 16:10 aspect, so the composition is unchanged) because
presenting a frame there is 7.7s against 13.2s at full size.

`preserveDrawingBuffer` is enabled only in capture mode, since only the harness
reads pixels back and the flag denies the browser its fast swap path.

## Not in this increment

No operator mode, no writes, no OAuth or team-role flow, no generic API proxy,
no leaderboard or manual claims, and no deployment. Live Whop reads are wired
but unexercised: the code path exists and is typed, and nothing calls it without
a binding.
