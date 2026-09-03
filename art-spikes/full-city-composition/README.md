# Whop City — full-city composition spike

A throwaway visual-production spike. One contiguous, bright, sunlit modern-SF
waterfront city, authored entirely in code and rendered in the browser with
Three.js, in the rendering grammar approved on the Offer Forge block.

Nothing here is product code. There are no fetches, no assets on disk, no
credentials, no adapters and no Whop bindings. Every mesh is generated at boot
and every texture is drawn into a canvas. The point is to settle what the world
looks like and to prove the architecture that will build it, before any of it is
pointed at real data.

<!-- Artifacts land in ./artifacts. See "Capture" below. -->

## What is in the frame

The city is a **promontory**: water to the north and to the west, meeting at a
headland, with the built city filling the wedge of land between them.

That shape is doing real compositional work rather than being scenery. In a
fixed 45-degree isometric, an axis-aligned shoreline always crosses the frame on
a diagonal — a single coast therefore leaves half the picture dry no matter
where you put the camera. Two coasts meeting at a point put water along both top
edges, give the horizon somewhere to be, and hand the entire lower frame to the
city. It is also, conveniently, roughly how San Francisco is shaped.

Districts are placed by where they land on screen, not by tidy grid logic:

- **Commerce Core** on the headland, where a setback tower reads against water.
- **Offer Forge** on the west quay, where the yard, gantry and crane get clear
  sky behind them.
- **Creator Quarter** in the foreground, where the camera is closest and the
  fine grain is legible.

Between them: a north quay road, a west quay road, a planted boulevard, two
cross streets, a service lane, a canal inlet cut south out of the bay and
crossed by a bridge, a ferry terminal on the point, piers, moored barges,
surrounding massing that continues the city off-frame, and far banks across both
bays.

## District programs

All three compose from the same building vocabulary in
`src/city/districts/buildings.ts` — plinth, pilasters, punched reveals with
cills, string course, cornice, and something authored on the roof. What
separates them is grain and program, never a recolour.

| District | Grain | Program | Roofs | Landmark |
| --- | --- | --- | --- | --- |
| Commerce Core | Deep plots, 4–8 storeys | Retail at grade, glazed office above, transit stop, loading bay | Parapet, stepped, monitor | Setback tower with crown and beacon |
| Offer Forge | Wide shallow waterfront plots, rear lane | Brick street unit, sawtooth workshop, loading yard, display plaza | Sawtooth | Brick vent stack, tower crane while rising |
| Creator Quarter | Fine-grain bays, 2–3 storeys | Shopfronts, balconies, rear mews workshops round a shared yard, market, venue, park | Occupied terraces, pitched | Venue fly tower and bandstand |

The Offer Forge yard is **earned by frontage**. The approved block was 34m wide
and could afford a full loading yard behind a gantry; a 22m plot cannot, and
forcing one on it squeezed the workshop down to a shed. Plots under 28m get the
workshop across the full width and put their activity on the street instead.

## Progression states

State changes the physical place, not a colour ramp. The default configuration
is the visual proof asked for:

| Parcel | State | What that looks like |
| --- | --- | --- |
| `core-*` | healthy | Lit fascias, open shopfronts, traffic, delivery at the loading bay, people at the transit stop |
| `forge-hero` | rising | Slab and footings poured, two bays clad, tower crane with a swinging load, site hoarding, cones, spoil heaps, crew in hi-vis |
| `forge-north`, `forge-south` | healthy | Finished sawtooth sheds, lit rooflights, roller door open, forklift shuttling, steam from the vent |
| `creator-*` | healthy, quieter | Market stalls, café spill, occupied roof terraces, bandstand, no vehicles in the yards |
| `creator-struggling` | struggling | Shuttered frontage, dead signage, faded render, rusted stalled frame under a flapping tarp, skip left too long, weeds through the paving |

One struggling sub-lot, in frame, next to healthy neighbours — poor health reads
as a specific place going wrong rather than the city being switched off.

## Reusable city composition architecture

This is the part meant to survive the spike.

### Parcels

```ts
type Parcel = {
  id: string;
  centre: { x: number; z: number };
  width: number;
  depth: number;
  yaw: number;                  // 0 means the frontage looks toward +Z
  edges: { front; back; left; right };  // street | boulevard | alley | water | neighbour | park
  level: number;
};
```

A parcel declares **what bounds each of its four edges**, and
`buildParcelGround` responds: a street edge gets a kerb, a threshold and tree
pits; a water edge gets a retaining wall, coping and mooring bollards; an alley
gets a rough service strip; a neighbour edge gets a blind party wall. The Offer
Forge creek and road are gone as hard-coded geometry — the same district code
now sits on a waterfront plot or an inland one and the ground adapts.

### Lots

```ts
createLot({ seed, district, archetype, state, parcel }, kit, target, rigs)
```

The contract the block spike had, generalised. District builders author in
**parcel-local space with the frontage at +Z** and never touch world
coordinates; `parcelMatrix` and `emitLocal` bake the result into the shared
world-space builder. That is what lets Offer Forge be rotated ninety degrees to
face the west quay without a single change to the district code.

### Batching

- One shared material palette for the whole city (`src/scene/materials.ts`).
- All static geometry merged per material by `PartsBuilder`, in four groups:
  ground, surroundings, structures, props.
- Repeated props (trees, bollards, benches, lamps, pallets, weeds, contact
  shadows) are instanced through `InstanceKit`.
- Every animated actor — people, vehicles, forklift, ferry — is collapsed to a
  **single mesh under one shared material** by `PartsBuilder.buildSingle`, which
  folds each part's material colour into its vertex colours. Roughness
  differences between a jacket and a boot are not resolvable at this camera
  distance; a draw call each is.

### Determinism

Everything derives from one seed through `Rng`, including layout jitter, skin
selection, prop scatter and actor phase. Animation is a pure function of a
supplied `t` — no clock reads inside the rigs — so frame *n* of the recording is
byte-identical on every run.

## Renderer figures

Measured from `THREE.WebGLRenderer.info` at the default 1440×900 framing, not
estimated. Run `pnpm stats` to reproduce.

| | Measured | Budget |
| --- | --- | --- |
| Draw calls | **159** | ≤ 220 |
| Triangles | **220,316** | ≤ 250,000 |
| Geometries | 158 | — |
| Textures | 15 | — |
| Parcels | 11 | — |
| Prop instances | 861 | — |

Meshes by group: city ground 25, surroundings 11, parcel ground 7, structures
45, instanced props 21, actors 49.

Draw calls move between 156 and 159 across the animation cycle, because
vehicles are culled while they are crossing the gap the bridge leaves in the
carriageway. The figure above is the peak, taken by `pnpm capture` and written
to `artifacts/renderer-stats.json`.

Getting there took two decisive changes. Actors were 142 of 243 draw calls
before `buildSingle` — more than the whole rest of the city put together —
because a figure cost one call per material it used. The
steam vent was six meshes with six cloned materials; it is one instanced mesh
with the fade on instance colour. Window bays were also put on a diet — the
transom and bevelled cill cost more triangles than the entire road network and
are invisible at this distance.

## Running it

```bash
pnpm install
pnpm dev          # http://127.0.0.1:5190
```

Query parameters: `?bare=1` hides the shell, `?capture=1` stops the animation
loop and hands control to the capture hooks, `?fh=<n>` overrides the frustum
height.

## Capture

The harness writes to **`./artifacts` inside this package by default**. Set
`ART_OUT` to send it somewhere else. The browser is discovered rather than
hard-coded: `CHROME_PATH` wins if set, otherwise the usual install locations are
probed, otherwise Playwright's bundled Chromium is used.

```bash
pnpm capture                      # stills + silhouette + stats + 14.4s MP4
ART_OUT=/tmp/proof pnpm capture   # same, written elsewhere
pnpm stats                        # renderer figures and per-group breakdown
pnpm leak-check                   # asserts repeated rebuilds return to baseline
pnpm preview city                 # one frame; also commerce | forge | creator
pnpm preview forge out.png 9.5    # framing, path, animation time
```

`pnpm capture` produces:

- `city-default.png` — the default view at 1440×900
- `district-commerce-core.png`, `district-offer-forge.png`,
  `district-creator-quarter.png` — focused framings
- `silhouette-city.png` — flat black, context hidden
- `whop-city-flythrough.mp4` — 14.4s, 30fps, default → Commerce Core → Offer
  Forge → Creator Quarter → default
- `renderer-stats.json`

## Leak check

`pnpm leak-check` cycles every framing, toggles silhouette mode, and rebuilds
all eleven lots three times over, then asserts the renderer's texture and
geometry counts return to baseline. Both stay flat.

This is the same class of bug fixed on the block spike: `registerProps` was
building a fresh contact-shadow canvas texture on every rebuild, and the steam
vent was cloning six materials. Anything that outlives a lot is now a
process-wide singleton, shared geometry is flagged so teardown skips it, and
`disposeCity` never touches materials because they all come from the palette.

## Camera

The angle is fixed at 45° azimuth, 31° elevation. District framing is a **dolly
and a zoom, never an orbit** — `stage.frame(focus, frustumHeight)` moves the
focus point and the frustum height and nothing else. Every silhouette is
authored against exactly one view direction, so an orbit would invalidate all of
them at once.

The shadow camera travels with the focus and resizes with the frustum. Without
that, framing a district at the edge of the plan walks the whole city out of the
4096² shadow map.

## Route from this spike to the production renderer

This is a spike, not a foundation, but the pieces are in the order they need to
be lifted:

1. **Lift as-is.** `lib/geom.ts`, `lib/rng.ts`, `scene/textures.ts`,
   `scene/materials.ts`, `city/props.ts`, `city/actors.ts`. These have no
   knowledge of Whop City and are the expensive part to re-derive.
2. **Lift with an interface change.** `city/parcel.ts` and `city/districts/*`.
   Today a parcel is a literal in `cityPlan.ts`; in production it comes from the
   safe public projection. The `Parcel` shape is deliberately the boundary — it
   carries geometry and edges only, never a metric, a count or an identifier.
3. **Replace.** `city/cityPlan.ts`. A hand-authored eleven-parcel plan is the
   right answer for a composition proof and the wrong one for a real city; it
   becomes a generator that lays streets and subdivides blocks from the district
   set the projection returns.
4. **Rewrite for React.** `main.ts` and `scene/stage.ts`. The stage logic is
   sound and should move into an R3F canvas with the framings as state; the
   capture hooks become the interaction API.
5. **Wire progression.** `DEFAULT_STATES` becomes the projection's per-district
   health. `__rebuild` already proves a full re-lot is clean and cheap; a
   production version should diff and rebuild only changed parcels.

What must **not** be lifted: the spike-only district jump control in
`index.html`, the `__*` capture hooks, and the hard-coded seed.

## Self-critique

Blunt, and only the things that actually matter.

**No pathfinding, so the life is on rails.** Vehicles run fixed loops along one
carriageway and pass through each other at junctions; walkers traverse a
straight run and teleport back to the start. At this camera distance it reads,
but nothing yields, nothing queues, and nothing turns a corner. A production
version needs a real network with junctions before anyone looks closely.

**The Creator Quarter still has dead ground.** The rear mews fixed the worst of
it, but `creator-park` is 26m wide with buildings on only nine of them, and the
paving between the park and the street does nothing. The park is also smaller
than it should be for a district whose whole character is public space.

**Surrounding massing is extruded boxes and looks it.** Everything beyond the
eleven authored parcels is a rectangle with a window grid, a parapet and
occasional roof clutter. It holds up in the deep background and on the far
banks; in the near foreground at the bottom of the frame it is visibly the
weakest thing in the picture, and it is what the eye lands on first at the
bottom-left and bottom-right corners.

**Struggling is under-represented.** The brief asked for one struggling sub-lot
and got exactly one, at the right-hand edge of the Creator Quarter where it is
easy to miss at the default framing. It reads clearly at district framing. If
the point is to prove poor health changes a real place, it should be somewhere
the eye already goes.

**The facade system only wraps three faces.** `punchedFacade` glazes the front
and both flanks; the rear is blank. Correct for a terrace, wrong for the
free-standing commerce blocks, and it would show immediately from any other
camera angle. The pilasters and string course are front-only too.

**No time of day, no weather, no seasons.** One sun position, one sky, one
palette. The lighting is authored for exactly this angle and hour, and a
different time of day would need the whole thing re-balanced rather than a
parameter changed.

**Water is a scrolling texture on a flat plane.** No reflection, no shoreline
foam, no depth gradient at the quay walls. It is fine at this distance and would
not be at any closer framing.

**Nothing here is tested.** There are no unit tests, no visual regression
baselines, and the only automated check is the leak check. That is defensible
for a throwaway spike and indefensible for anything that ships.
