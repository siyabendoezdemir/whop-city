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
| `WHOP_API_ORIGIN` is bound | **live** | the real business |
| no origin, but `CITY_FIXTURES` is set | **fixture** | the named scenario |
| neither | **none** | the unavailable city: every district dormant, `freshness: "unavailable"` |

The third row is the one that matters for deployment. Fixtures used to be the
fallback, which meant a hosted City whose binding was missing or renamed would
answer with a healthy invented business and label it "Reading the business now".
Fixtures are now opt-in: `CITY_FIXTURES` lives in `.dev.vars`, which wrangler
reads for the local worker and never uploads, so a deployed City cannot serve
invented state even if every other binding is wrong.

Unknown scenario values fall back to the default silently rather than echoing
back, and in live mode the query string is not read at all.

Without a live binding **no outbound request is attempted** — not a failed one,
not a timeout.

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
runtime. Nothing else is required — the business is derived from `APP_ID` via
the public `GET /api/v1/apps/{id}`, and `WHOP_ACCOUNT_ID` is an optional
override. Without the origin the city deploys and renders, honestly unavailable.

**Recommended:** `CITY_SEED_SECRET`, any stable random string. It keys the
layout seed so the account id cannot be recovered by grinding an unkeyed digest.

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
