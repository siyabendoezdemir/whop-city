# Whop City

A Whop Website that renders a business as an isometric city, and lets its owner
play it as a light city-builder. Three districts — Commerce Core, Offer Forge,
Creator Quarter — hold eleven authored parcels, and each parcel is a building
that levels from nought to five. A level is *earned* when a real figure from the
business crosses a threshold and *claimed* when the player presses the button;
nothing else moves one. The city therefore starts genuinely empty — level nought
is a vacant site with hoarding, gravel and a board saying what could go here —
and a skyline is something the business builds rather than something the
renderer hands over.

Nothing is deployed, and no deployment is to be made without explicit approval.

```bash
pnpm install
pnpm dev            # http://localhost:3000
pnpm build && pnpm preview --port 4173
```

## The game

One resource per district, which is the rule that makes the skyline readable
from the water.

| District | Resource | What it is |
| --- | --- | --- |
| Commerce Core | Gold | gross revenue this month |
| Offer Forge | Reserve | monthly recurring revenue |
| Creator Quarter | Citizens, Footfall | paying members, and visitors today |

All four come out of Whop's stats API, the same place the creator's own
dashboard gets its figures, so a level costs a thousand in revenue or fifty
members rather than fifty invented credits. There is no simulated economy and
nothing ticks up on its own. A business with good revenue and no recurring gets
a downtown and an empty forge, and can see that from the wide shot.

`game/buildings.ts` holds the eleven buildings and their five-rung ladders. The
first rung on each is within reach of a business that has just opened, so the
city moves on day one; the last is a real milestone. Plots inside a district are
staggered so they do not all light up on the same afternoon.

`game/city.ts` keeps one thing between visits: the level the player has claimed
per building, in this browser, keyed on the layout seed. Everything else is
derived from the live figures every time it is asked for, so there is nothing to
drift and nothing that could tell you your city is doing better than your
business is. Claiming is capped by what was earned, so the save file is not a
cheat sheet: hand-editing it to level five gets level five only if the figures
back it.

**Height.** `game/plots.ts` maps level to storeys, on a different curve per
district. Commerce Core climbs hardest, because downtown is where a skyline
comes from; the Forge is a working district of sheds and stacks and stays broad;
the Quarter sits in the foreground and is held low or it stands in front of
everything behind it. Grown all the way, the three read as a city with a
downtown rather than as eleven towers. The table lives there rather than in the
renderer because three things must agree with it: the buildings, the marker that
floats over a roof, and the camera.

**The founding sweep.** A first visit seeds the city to everything the business
has already earned, which for an established Whop is most of a skyline arriving
in one frame. So it rises instead, a storey at a time. Nothing is invented — it
is the same city, told over a few seconds instead of none — and it is the moment
that connects the buildings to the business without a word of copy. It is
skipped when the browser asks for reduced motion, and it never replays.

**While you were away.** A return visit compares the figures against the ones
recorded when the player last looked and lists what moved. A fall is shown as
plainly as a rise: a panel that only reported good news would be worth nothing
the first time something went wrong.

### Quests

Each district runs its own board, in `game/quests.ts`. The single global advisor
that came before meant a business with a distribution problem never heard a word
about its offer.

Four rules keep the boards honest. Every step is general enough that a
newsletter, a coaching programme, a trading group and a software product can all
act on it today. A quest finishes when the number it is about actually moves —
nothing can be ticked off, so no sense of progress is available that the business
did not earn. Anything actively going wrong outranks the next rung of the ladder,
because there is no point chasing ten thousand a month while a quarter of the
members leave. And every board ends in a standing practice, so a district can
never run out of things to say.

`readingFor` gives each district one line on how it is doing. There is no
history store beyond last month's revenue and yesterday's footfall, so nothing
there says "trending" or puts a rate on anything.

## The privacy boundary

The whole point of the architecture is that the browser learns what the business
*looks like* without learning anything that identifies it, and that the
business's own figures reach nobody but the business.

```
Whop API ──► whop-client.ts ──► snapshot.ts ──► project.ts ──► PublicCityProjection
             named GET readers   the sensitive   the boundary   words, and the counts
             (server only)       shapes, and                    an owner may see
                                 stats.ts's four                (the only thing sent)
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
  ],
  "metrics": {
    "gold": 6200, "goldBefore": 5400, "recurring": 3100, "citizens": 130,
    "traffic": 340, "trafficBefore": 300, "churn": 5, "refunds": 2,
    "joined": 18, "source": "owner"
  }
}
```

Four physical states (`healthy` / `rising` / `dormant` / `struggling`), coarse
direction, signal and freshness words, an opaque seed, two small bounded
renderer integers, and the metrics block. No price, no product or offer title,
no customer, no Whop identifier, no timestamp, no credential, no upstream
response.

The metrics are counts, and they are the game's resources — a level costs five
customers, not five invented credits. Because they are the business's real
figures they are the owner's, and `CityMetrics.source` says which of three
situations produced the block: `owner`, the real figures, for a viewer Whop has
vouched for as an admin of this business; `withheld` for anyone else;
`unreadable` where the owner is looking and Whop would not answer. The last two
are both zeroes and both show as a dash, but they are kept apart, because "you
have made no money" and "we could not find out" are not the same sentence and a
city that says the first when it means the second is lying.

Two mechanisms hold the boundary, because a comment does not:

- `PublicCityProjection` is a closed type of string-literal unions and bounded
  integers. Widening it is a visible type change.
- `serializeProjection` does **not** stringify the object it is handed. It
  rebuilds one field by field from a whitelist and validates every value against
  its allowed domain; `sealMetrics` does the same for the counts and refuses
  anything that is not a bounded integer. A field added to the projection
  without also being added there cannot reach the wire, and a value outside its
  domain throws rather than being sent.

`tests/projection.test.ts` plants sentinel values — an account id, a product
title, a plan id, a distinctive member count, a price — in a snapshot and proves
none of them survives serialisation on the public wire or on the owner's, that
fields smuggled onto the projection object or onto a district are dropped, and
that no fractional number is ever emitted.

### The layout seed

The city must look the same every time a business opens it, which means the seed
is a stable function of who they are. It must not be a way to learn who they
are.

`deriveLayoutSeed` is HMAC-SHA-256 over the account id, truncated to 64 bits and
keyed with `CITY_SEED_SECRET`. The raw id never leaves `server/seed.ts`.

**The key is not optional.** The unkeyed fallback used to live here and is gone.
A domain-separated SHA-256 is one-way but only as strong as its input space, and
account ids are short and structured, so a determined attacker who knows the
format could grind one and recover the business from a public page. An
account-bound projection now either gets a keyed seed or is not served at all.
Anything under sixteen characters is refused, which is a typo guard rather than
a cryptographic threshold: a two-character secret is a misconfiguration that
would otherwise look correctly configured. Fixtures and the unavailable city are
not account-bound, so they carry inert seeds and need no secret.

### The endpoints

The browser may call exactly two same-origin paths:

```
GET /api/city/snapshot     the public projection, with the figures gated inside it
GET /api/city/profile      owner-only: who is signed in, and which Whop this is
```

Two documents with two audiences, which is why the profile is not a field on the
snapshot: they must not share a cache entry. A visitor gets exactly
`{"signedIn": false}` and learns nothing else — not the business name, not the
route, not the id, not whether a session exists at all.
`tests/browser/data-safety.spec.ts` asserts that body verbatim.

Sign-in adds four more fixed paths: `/api/auth/start`, `/api/auth/callback`,
`/api/auth/logout` and `/api/auth/view`. All seven are mounted in `src/server.ts`
— a custom TanStack Start server entry — as pathname **equality checks** ahead of
the router. There is no pattern, no parameter and no dispatch table, so the set
of endpoints the browser can reach is those seven literals, and the framework's
`/_serverFn` prefix is closed outright rather than left answering with whatever
its error shape is, since City registers no server functions to serve.

> `wrangler.jsonc` points `main` at `src/server.ts`. Pointing it back at
> `@tanstack/react-start/server-entry` silently removes the endpoints.

Account context comes only from the deployment binding (`server/env.ts`) and,
for an owner who runs several Whops, from their own signed session. The caller
cannot choose an account, an origin, a path, a method, a header or a body;
`tests/snapshotRoute.test.ts` attempts all of them and asserts the outbound call
is unchanged.

`whop-client.ts` has no non-GET function in it, so no product route can reach a
payment, payout, transfer, account, team, OAuth-config or app-config action —
not behind a flag, not behind a session. It holds no credential: the hosted
runtime attaches the app key in an outbound proxy.

### What is not claimed

City controls its own payload; it does not control the platform's. Whop's
hosting injects its own pixel into every HTML response and publishes the
business id through it. See `docs/architecture-website-blueprint.md`. The
boundary above is about what *City* sends.

City reads the Whop API. It does not browse the storefront and does not try a
purchase, so nothing on screen reports an outcome City did not observe.

## Which Whop

A Whop Website has no iframe and no injected user token — the hosting docs are
explicit that the runtime authenticates as the business and never as the visitor
— so visitor identity means OAuth. `server/oauth.ts` runs OAuth 2.1 with PKCE
and no library: a public client, so the deployment holds no secret it could
leak, and scope `openid profile` rather than `email`, because nothing here sends
mail and an address is the one field worth not holding. The access token is used
once, server-side, to ask Whop who signed in, and is then thrown away.

Signing in is not the same as running the place: the callback checks the user
against `GET /api/v1/users/{id}/access/{account}` and only `admin` counts. What
survives is a small signed cookie — `HttpOnly`, `Secure`, `SameSite=Lax`, an
hour long — carrying a user id, the business id, a display name and the
businesses they run. No token, no email, nothing that would matter if it leaked.

The corner used to hold a link that said "Sign out", which answered a question
nobody had and left the one that matters — *whose business am I looking at?* —
unanswered. So at sign-in the user's own token lists the Whops they run
(`GET /api/v1/accounts`, sent with the proxy's key injection turned off so the
answer is about them rather than about the app), and those names and ids go into
the session. `/api/auth/view` switches between them, and only ever honours an id
Whop itself listed for that user: the query string cannot name a business, only
pick one already in the signed session.

**The honest limitation.** A hosted Whop Website's injected credential is scoped
to the account the app was published under, so that is the only business
actually readable. The others are listed in the profile menu and marked "not
this deployment" rather than offered as a switch that would quietly show a city
full of noughts. This has not been verified against a second live business.

## Reading the figures

`server/stats.ts` reads revenue, recurring revenue, members, traffic, new
members, churn and refund rate. Product counts and commission rates are gone:
they described a shape of business rather than a business.

**Scope.** Every query names its `account_id`. The parameter is optional in the
API, and omitting it means "whatever the credential defaults to" — a quiet way
to read the wrong business, or an arbitrary one where the credential has more
than one.

**Zero is not silence.** A metric that cannot be read is `null`, never zero. The
reads are independent, so one slow node costs a figure rather than the city; but
where none of the four the game runs on answered, `metricsFor` returns
`source: "unreadable"` and the interface shows a dash. A row of noughts is a
claim about the business; a dash is a claim about the reading.

## Data source

`resolveSource` picks one of three, in this order:

| condition | source | what the browser sees |
| --- | --- | --- |
| `CITY_SEED_SECRET` usable | **live** | the real business |
| fixtures compiled in **and** `CITY_FIXTURES` set | **fixture** | the named scenario |
| neither | **none** | the unavailable city: every district dormant, `freshness: "unavailable"` |

The API origin is no longer part of that decision. The hosted runtime does not
inject `WHOP_API_ORIGIN` — measured, and recorded in
`docs/website-auth-spike.md` — so requiring it meant every deployed City failed
closed and no business was ever read. `apiOrigin` defaults to
`https://api.whop.com` and an override still has to survive the permitted-host
check below. With neither an app id nor a seed key, which is local development,
**no outbound request is attempted** — not a failed one, not a timeout.

### Fixtures

`server/fixtures.ts` builds six deterministic `BusinessSnapshot`s and the stats
to go with them, so they run through the real projection rather than around it:
what reaches the browser has crossed exactly the same boundary live data would.
A test that depends on a real business is not a test.

`?scenario=` selects one, and it is honoured **only when the deployment
explicitly opted into fixtures** — see below.

| scenario | what it is | resulting city |
| --- | --- | --- |
| `balanced` *(default)* | $6.2k this month, 130 members, up on both | every plot standing, the city at Borough |
| `blank` | just created; nothing readable at all | eleven vacant plots and four dashes |
| `launch` | days old, 420 visitors, nothing sold | two plots in the Quarter, nothing else |
| `thriving` | $48k a month, 1,240 members, wide reach | all eleven built, the city at Downtown |
| `struggling` | selling, but 28% churn and down on last month | urgent quests in Core and the Quarter |
| `unavailable` | the business could not be read | every district dormant, and the crest says so |

Unknown scenario values fall back to the default silently rather than echoing
back, and in live mode the query string is not read at all.

Each scenario gets a **seed of its own**, from `fixtureSeed`. The browser keys
the saved city on the seed, so one shared anonymous seed meant loading
`thriving` after `blank` showed `blank`'s empty city with `thriving`'s figures.
The seeds are obviously fake, and unreachable from a deployable build.

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
business data with it. The same literal removes the fixture owner from
`profileRoute.ts`. `tests/browser/production-build.spec.ts` greps the deployable
bundle for `fixture_account_`, `fixture_product_`, `fixture_plan_` and
`Fixture product`, requires all four absent, and asserts the profile endpoint
carries no trace of `Fixture Whop`.

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

`{ "data": [] }` is valid and stays a **live**, genuinely empty result, and so is
a row whose nullable fields are all genuinely null. A business that genuinely has
nothing in it is the opposite of a failure: a successful read, a **live** city
with every district `dormant`. The owner can therefore tell an empty shop from a
broken city, which is the whole point of the distinction — the failure mode is
silent otherwise.

Every read in the capture is mandatory, including the per-product affiliate
detail reads. That is the strict choice: a failed detail read would otherwise
render Creator Quarter dormant, which reads as "nobody is affiliating" when the
truth is that we could not look. The stats read sits outside the capture for the
opposite reason: a business with no products still has traffic, and a stats node
that will not answer should cost one figure rather than the whole city.

### Request amplification

`/api/city/snapshot` is public and unauthenticated, and one call fans out: the
account, the catalogue, the pricing surface, up to twenty-four per-product
affiliate detail reads, and seven stats metrics on top when the caller is the
owner. `server/snapshotCache.ts` puts two things in front of that and nothing
else: concurrent requests resolving to the same deployment wait on one capture,
and a **successful** result is reused for a bounded ten seconds.

The window is measured from when a capture *settles*, never from when it
started. An in-flight entry is shared however long it runs — measuring from the
start meant a capture slower than the window got joined by a second upstream
fan-out at exactly the moment the upstream was least able to take one.

It is deliberately not a shared or CDN cache. Entries are keyed by deployment
context built from bindings only — never from anything a caller sends — plus the
audience and the business being read, because an owner's city and a visitor's
city are different documents, and so are two owners' cities. They are held in
the isolate's memory, and the response is `private, no-store, max-age=0`. A
shared cache in front of this endpoint would be a way to serve one business's
city to another. A rejected capture is dropped the instant it settles, and so is
a result the route declines to keep — which is any unavailable projection. A
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

**Required for a live city:** `CITY_SEED_SECRET`, a stable random string of at
least 16 characters. It keys the layout seed, and without it the deployment
serves the unavailable city rather than a real one. The business is derived from
the injected app id via the public `GET /api/v1/apps/{id}`, and
`WHOP_ACCOUNT_ID` is an optional override.

**Required for sign-in:** `CITY_SESSION_SECRET`, at least 24 characters. It
signs the session cookie. Without it sign-in returns the player to the city
saying the deployment is not set up for it, and the public city is what they get.

**Optional:** `WHOP_API_ORIGIN`, checked before use — https only, host
`api.whop.com` or a `.whop.com` subdomain, and no credentials, path or query on
it. The bare `whop.com` apex is refused: it is the marketplace website, not an
API host. Pinning to the single literal `https://api.whop.com` is a follow-up
for the first deployment that observes what the runtime actually supplies.

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
three-quarter camera angle, the world-fixed sun and shadow volume, 2×
supersampling, merged static geometry and instanced props. The authored parcel
layout stays fixed — it is the approved composition — and the game decides what
stands on it.

### Terrain and lots

`buildTerrain` is the ground, both bays, the road network, the surrounding
massing, the traffic and the ferry. None of it depends on what the player has
built, so it is built once for the life of the page. `buildLots` is the eleven
plots and everything standing on them, and it is the only thing a level change
rebuilds. Rebuilding the whole city to change the height of one tower meant
re-merging every road, every kerb and every far-bank block, and the frame it
cost was plainly visible.

Measured by `capture/bench.mjs` on the CI machine under SwiftShader, which has
no GPU and is therefore the pessimistic case:

| | measured |
| --- | --- |
| terrain, built once | 40 ms |
| lots, every plot at level five | 228 ms |
| lots, every plot vacant | 8 ms |

The worst case was 414 ms before geometry prototypes were cached and the two
per-vertex bake passes — world UVs and vertex ambient occlusion — were rewritten
over raw `Float32Array`s rather than three.js vector objects.

### The attention markers are world geometry

A gold bubble floats over any plot with something waiting: a chevron on a built
plot, a plus on empty ground. They used to be HTML positioned from a projected
point on a 300 ms timer, which meant that during any camera move they lagged the
world by up to a third of a second and visibly swam.

They are instanced billboards in the scene now, placed once in world space at
the measured top of whatever is actually standing on the plot — `emitLocal`
returns the real bounding-box top rather than a predicted height, which is what
had markers sitting inside chimneys and behind fly towers. There is no per-frame
reprojection to get wrong and nothing to drift out of sync with the camera. They
cannot jitter because nothing moves them. Hiding one scales it to nothing rather
than removing it, so the instance count never changes and neither does the draw
count.

### The camera

Free pan by dragging, wheel or pinch to zoom, a little coasting after the
pointer lifts, and clamped to the island: you may roam the promontory, not the
void. The angle is the art and never rotates; the position is the player's.

Both ground axes are read off the camera's own matrix rather than reconstructed
from the azimuth. Reconstructing them is how the vertical axis ended up
inverted, with a drag downward pulling the city up. The pixel-to-world
conversion then divides by the horizontal length of each camera axis, because a
metre travelled north is not a metre up the screen — it is `sin(elevation)` of
one, about a half at this angle. Ignoring that made a vertical drag move the
world at half the speed of the hand while a horizontal drag tracked it exactly,
which is the "sluggish, fighting me" feeling that has nothing to do with speed
settings: the ground was simply not staying under the cursor.
`tests/browser/game.spec.ts` drags the canvas and asserts the ground follows the
cursor on both axes.

### Why the sun does not move

`stage.frame()` moves the render camera and nothing else. The sun position, its
target and the six shadow-camera planes are set once, in world space, and never
touched again. Anything that varies them during a camera move remaps every
shadow texel to a different patch of world, and the whole city shimmers under a
dolly. `tests/browser/world.spec.ts` asserts the rig holds a single state across
every framing and zoom on the fly path.

### Budgets

Measured across the fixture scenarios, worst case:

| | measured | budget |
| --- | --- | --- |
| draw calls | 142 | 220 |
| triangles | ~205,000 | 250,000 |

The same spec asserts the budget on every scenario, and that cycling through all
of them and back does not leak textures or geometries.

## The interface

The world is the product; everything over it is a heads-up display, built the
way restrained city-builder HUDs are built. Anchored to the screen edges rather
than floating in the middle, dark and muted so it never competes with the
render, bright only where something is actually wrong, and one dominant surface
at a time. The regions never overlap at any width the game runs at:

- **the crest**, top left — how grand the city is, and how far to the next tier
- **the resource bar**, top centre — the four figures, or four dashes
- **the profile**, top right — who you are and which Whop this is
- **the district rail**, lower left — the three districts: what is built, what
  is waiting to be claimed, and one line on how that part of the business reads
- **one contextual panel**, bottom right — the building card when a plot is
  selected, otherwise the quest card. Never both.
- **the camera**, bottom centre — small, and out of the way of both side panels

The loop is short: a bubble appears over a plot, you click the plot, the card
says what the business reached and what the next level needs, and you press the
button. Plots are picked through an invisible box over the whole parcel, tall
enough to cover the building, so a player aiming at the fortieth storey of a
tower is aiming at the tower; the architecture itself stays merged.

**Desktop only.** Below 900×560 the game shows a gate saying to come back on a
computer, and does not start a WebGL context at all. It is a city you fly around
and read at a glance, and on a phone it would be neither. The check is a
measurement rather than a sniff: what matters is whether there is room for a
city and a card side by side, not what the device calls itself.

## Verification

```bash
pnpm typecheck
pnpm test                     # 202 unit tests: the boundary, the routes, the game
pnpm test:browser:fixtures    # 16 specs: the world and the game, on a fixtures build
pnpm test:browser:production  # 17 specs: data safety, on a deployable build
pnpm build
```

Both browser suites build first and each runs against the build it is about, on
the preview server, so the evidence is of the built app rather than a dev
bundle. The fixtures suite compares built geometry, roof heights and screen
positions across scenarios, because a static city would pass a suite that only
read panel text; the production suite watches the wire and greps the deployable
bundle. `CITY_URL` points them elsewhere.

Three capture scripts photograph the running dev server:

```bash
node capture/shot.mjs <name> [scenario]   # one still
node capture/play.mjs [scenario]          # walks the loop, a still per step
node capture/bench.mjs                    # terrain and lot rebuild timings
```

They need a Chrome or Chromium, look in the usual places and fall back to
Playwright's bundled build; `CHROME_PATH` overrides. `SS` pins the supersampling
factor and `ART_OUT` moves the output.

### Why capture is slow without a GPU

Rendering a frame of this city costs about six milliseconds under software
WebGL. *Presenting* one costs seven to fourteen seconds, and that cost is the
same whether the frame is reached through Playwright's screenshot, through
`canvas.toDataURL`, or by simply letting the page's own animation loop run —
which manages about 0.1 frames per second on a machine with no GPU. It is not
the resolution, the shell's blurred panels, or `preserveDrawingBuffer`; all
three were measured and none of them account for it.

The practical consequences: timeouts are generous, the fly-through is composed
and photographed frame by frame rather than screencast live, and it is recorded
at 960x600 (same 16:10 aspect, so the composition is unchanged) because
presenting a frame there is 7.7s against 13.2s at full size. It is also why the
browser tests ask for reduced motion by default: that is the product's own way
of skipping the founding sweep, which otherwise takes the better part of a
minute here, and only the one test that is about it should pay for that.

`preserveDrawingBuffer` is enabled only in capture mode, since only the harness
reads pixels back and the flag denies the browser its fast swap path.

## Not built

No write path of any kind, no generic API proxy, no leaderboard, no manual claim
of anything the figures do not support, and no deployment.

Two things are implemented but unverified against anything live. The
multi-business profile menu has only been exercised against fixtures, so the
claim that a second Whop is listed and correctly marked unreadable has not been
checked against a real account that runs two. And nothing here has run on a
hosted Website, so what the runtime actually injects — and therefore whether the
API origin can be pinned to one literal — is still unobserved.
