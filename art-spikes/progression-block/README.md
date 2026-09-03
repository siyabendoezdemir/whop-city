# Offer Forge — progression block

A throwaway visual-production spike. One maker-district city block in Three.js,
authored to evolve physically through four states on the same lot, at a fixed
isometric strategy camera.

This is **not** product code. It touches no Whop data, no adapters, no auth, no
network. It exists to answer one question: can a browser-native low-poly block
carry the tactile, authored, inhabited quality of a premium city-builder?

## The four states

The same lot, the same camera, the same seed.

| | |
| --- | --- |
| ![dormant](shots/dormant.png) **Dormant** — hoarded frontage, bare slab with pad footings and starter bars, boarded shopfront, sign wrapped in a tarp, dust over the old apron | ![rising](shots/rising.png) **Rising** — tower crane, steel frame with two of six bays clad, scaffold and debris netting, excavator, haul route, mesh fencing, crew |
| ![healthy](shots/healthy.png) **Healthy** — glazed sawtooth shed, open roller door and loading dock, pergola plaza with display plinths, trees and benches, delivery under way | ![struggling](shots/struggling.png) **Struggling** — same shed, shutters down and a bay boarded, stalled extension rusting under a tarp, skip, patched road, weeds, thin footfall |

Silhouette check — architecture only, flat black on white:

![silhouette contact sheet](shots/silhouette_contact_sheet.png)

The street unit, the vent stack and the yard gantry are the persistent spine and
are recognisable in all four. Healthy and struggling share an identical roof
profile, which is the requirement that the lot stays the same place when it
declines.

## Second pass — before / after

Bounded visual refinement over the first spike. What changed:

**Capture portability.** `ART_OUT` now defaults to `art-spikes/progression-block/artifacts`,
a repository-local writable path; `/opt/cursor/artifacts` is no longer hard-coded
anywhere. Chrome is discovered by probing the usual install locations, with
`CHROME_PATH` as an explicit override and Playwright's bundled Chromium as the
final fallback. Frames go to a git-ignored `.frames/`. See `capture/env.mjs`.

**Material depth.** Every surface previously took a flat colour fill. There are
now eight procedural textures generated into canvases at boot — concrete grain,
render grain, paving with slab joints, asphalt with tyre polish, corrugated roof
ribs, brick courses, per-pane glass variation, and water ripples. They are
sampled through world-space UVs baked in `bakeWorldUv`, so texel density is
constant whether a surface is a kerb or a warehouse wall, instead of stretching
per face. Everything is deliberately low contrast; the brief was bright and
sunlit, not weathered.

**Soft occlusion.** `bakeVertexAo` writes per-vertex darkening into the merged
geometry: a smoothstep up from the ground over the first metre, undersides
knocked back, sun-facing tops lifted slightly. Props get the same over a shorter
reach, and every placed prop now lays an instanced contact-shadow disc. The sun
dropped from 3.1 to 2.5, hemisphere fill rose from 0.9 to 1.45, environment
intensity from 0.85 to 1.15, and the shadow kernel widened from 2.1 to 4.2 — so
shadows read as soft coloured shade rather than black cut-outs.

**Distinct people.** The old pedestrians were two stacked boxes and a sphere,
identical and fixed-facing. People are now built from eleven parts with posed
limbs across six poses (walk, carry, stand, point, lean, push), with varying
build, coat and trouser colour, headgear and load. Static bystanders merge into
the block geometry so they cost nothing; only movers get their own group.

**Authored neighbours.** The four buildings nearest camera were extruded boxes
with a painted window band. They are now authored with the same moulded
construction as the lot: plinth, pilasters between bays, string course, window
reveals with cills, recessed shopfronts, awnings, a signage slot, four different
rooflines (parapet, pitched, stepped setback, roof monitor) and four different
roof details (water tank, plant, stair bulkhead, roof garden), plus their own
kerb, footway and street trees.

**Motion.** Verified visible in the recording by independent review: the delivery
van reverses onto the dock and pulls away, a forklift shuttles between the van
and the workshop door, and pedestrians and site crew traverse the frame in every
state. The camera is fixed — none of that is parallax.

### What is still wrong

**Four of the intended ambient motions do not read.** The steam plume, the crane
hook swing, the tree canopy sway and the creek scroll are all implemented and all
verifiably change state frame to frame — a position probe shows the values
moving — but at this camera distance and amplitude an independent reviewer
watching the video sees none of them. They are below the threshold that matters,
which for the purpose of "does this feel alive" means they are not done. The
tree sway rotates the instanced canopies by about nine degrees and still reads as
frozen; the water tile is roughly forty metres across, so its scroll is a slow
gradient shift rather than moving water. Both need either a much larger amplitude
or a different technique — a vertex shader for foliage, and a genuine flow-map or
normal-map scroll for water rather than an albedo offset.

**People slide rather than walk.** Limbs are posed at build time and the figure
translates as a rigid body with a bob and roll. There is no gait, so a walker
reads as a model on rails. Skinned or two-part leg animation is the fix and it is
not in this pass.

**State changes are hard cuts.** The whole block pops between states on a single
frame. A settle, a dust puff, or a scaffold retract would sell the progression
as time passing rather than as four slides.

**Textures leak on state change.** `disposeLot` frees geometry but not the
materials cloned by the steam vent, so the texture count climbs by one per state
switch (16 → 19 across a full cycle). Harmless at this scale, wrong in principle.

## Running it

```
cd art-spikes/progression-block
pnpm install
pnpm dev            # http://127.0.0.1:5180
```

The four states are switchable from the bar at the bottom. Useful URL params:

| Param | Effect |
| --- | --- |
| `?state=rising` | Open directly in a state |
| `?bare=1` | Hide the switcher — what the capture harness uses |
| `?fh=90` | Override the camera frustum height, for looking at the whole world |

Capture, with the dev server already running:

```
pnpm capture       # four stills + silhouette sheet + 12s MP4 -> /opt/cursor/artifacts
node capture/silhouette.mjs   # just the silhouette contact sheet
node capture/preview.mjs healthy /tmp/out.png
```

Capture runs headless Chrome on SwiftShader, so it needs no GPU. It renders
about 2 frames per second, and the 360-frame video takes roughly three minutes.

## Scene graph and asset architecture

```
createLot({ seed, district, archetype, state })
└── THREE.Group  "lot:offer-forge:maker-block:<state>"
    ├── "ground"            merged, per material     road, kerb, footway, lot,
    │                                                service lane, quay, creek
    │                                                bed, land, tree pits
    ├── "creek"             merged, per material     pier, piles, moored barge
    ├── "neighbours"        merged, per material     surrounding massing, cut by
    │                                                the frame on three sides
    ├── "offer-forge:<state>"  merged, per material  everything on the lot
    │     ├─ persistent  street unit · vent stack · yard gantry
    │     ├─ dormant     slab, pad footings, starter bars, hoarding, wrapped sign
    │     ├─ rising      steel frame (2 of 6 bays clad), tower crane, scaffold,
    │     │              debris netting, excavator, haul route
    │     ├─ healthy     clad shed, glazed sawtooth north lights, roller door,
    │     │              loading dock + canopy, pergola plaza, display plinths
    │     └─ struggling  same shed shuttered + boarded, stalled rusting
    │                    extension under a tarp, skip, patched road, weeds
    └── "props:<state>"     one InstancedMesh per prototype
```

Two structural ideas do most of the work.

**Parts are authored small and merged per material.** `PartsBuilder` collects
every piece — a cill, a mullion, a gutter, a knee brace — into a bucket keyed by
material, then emits one merged mesh per bucket. The workshop is about forty
authored parts and lands as a handful of draw calls. All geometry is normalised
to non-indexed with matching attributes first, because mixing indexed primitives
with non-indexed `ExtrudeGeometry` makes `mergeGeometries` fail and silently
drop parts.

**Nothing is a raw box.** Every mass is a `RoundedBoxGeometry`, so edges catch
a highlight. That single substitution is most of the distance between "cubes"
and "moulded toy model".

**State is a rebuild, not a toggle.** Switching state disposes the lot and
builds a new one. A state is a different set of structures standing on identical
ground — not the same structures tinted, scaled or hidden.

## Renderer stats

Measured from `renderer.info` at 1440×900, reported by `pnpm capture`:

| State | Triangles | Draw calls | Instances | Prototypes | Geometries | Textures |
| --- | --- | --- | --- | --- | --- | --- |
| dormant | 51,022 | 97 | 126 | 13 | 98 | 16 |
| rising | 75,074 | 135 | 211 | 22 | 134 | 17 |
| healthy | 67,846 | 137 | 109 | 15 | 138 | 18 |
| struggling | 56,330 | 109 | 118 | 16 | 110 | 19 |

Up from 40k-63k triangles and 66-92 calls in the first pass. The extra triangles
are the four authored neighbours and the posed figures; the extra calls are the
animated rigs, which cannot merge into the block because they move independently.
Texture count climbs across a cycle because of the leak noted above.

Sixteen textures at rest: the sky gradient and its PMREM chain, the shadow map,
and eight procedural surface maps. **No image files are loaded** — every texture
is drawn into a canvas at boot.

The draw-call count is dominated by material variety, not object count. There
are 60-odd materials in the palette and roughly one call per material actually
used per merged group, plus one per instanced prototype. Halving it is mostly a
matter of merging the palette with a vertex-colour atlas, which is the obvious
next optimisation and was not worth it at this scale.

## What is instanced

`InstanceKit` registers prototypes and places them by matrix; each prototype
becomes one `InstancedMesh`. Multi-material props register one prototype per
material and are placed with a shared matrix, so `Prop.tree(...)` is one call at
the authoring layer and two batches on the GPU.

Instanced: trees (trunk, canopy, dry canopy), planters, weeds, bollards,
benches, bins, lamp posts and heads, cones, barriers, pallets, crates, drums,
sacks, dirt and gravel piles, mesh fence panels with frames and ballast feet,
hoarding panels and rails, scaffold posts, decks and rails, pedestrians,
hi-vis workers, delivery vans, and the vent-stack signage brackets.

Not instanced, because there is exactly one of each: the excavator, the tower
crane, the barge, and all architecture. The excavator is authored with the same
`PartsBuilder` and then folded into the parent's material buckets, so a posed
one-off still costs no extra draw call.

## How a second district reuses this

The district-specific surface is deliberately thin. `src/city/lot.ts` holds a
registry:

```ts
const BUILDERS = {
  "offer-forge": { "maker-block": buildOfferForge },
};
```

A second district is one new entry and one new builder module. Everything else
is shared unchanged: the ground system, the creek and neighbour massing, the
material palette, the whole prop kit, the camera and lighting, the seeded RNG,
the four-state vocabulary, and the capture harness.

A builder receives `(kit, state, seed)` and does two things — author structures
into a `PartsBuilder`, and scatter props through the `InstanceKit`. So
**Commerce Core** would author towers with setbacks, a transit canopy and
storefront bays instead of a sawtooth shed, and lean on the existing kit for
street trees, lamps, bollards, pedestrians and vehicles. **Creator Quarter**
would author live-work terraces, a small venue and rooftop rigging, and would
want perhaps four new prototypes — a satellite dish, a lighting truss, a market
umbrella, a roof planter.

The rough split observed here: about 700 lines of district-specific authoring
against about 750 lines of reusable system. A second district should cost the
first number, not both.

The ground currently hard-codes one street and one creek. Generalising it to a
parameterised parcel — frontage direction, depth, and which edges are street,
alley, water or neighbour — is the one piece of real work a second district
would force, and it is the right time to do it.

## Self-critique — the three largest gaps against a polished strategy game

**1. Every surface is a flat colour fill.** There is not one texture in the
scene. No albedo variation, no normal maps, no roughness breakup, no decals, no
grime in the corners, no edge wear on the kerbs, no lettering on the signs. A
shipped game gets most of its tactility from surface, and this gets none — which
is why it still reads closer to clean vector illustration than to a physical
model. The signage is the most visible symptom: the sign boards are coloured
rectangles because there is no text rendering, so the maker frontage has no
identity beyond its shape.

**2. There is no ambient occlusion, and the shading is thinner than it looks.**
Lighting is one directional sun with a soft shadow map, a hemisphere term, and an
image-based fill from a canvas sky gradient. What is missing is contact darkening
where surfaces meet — under awnings, inside window reveals, in the gutter valleys,
where a planter meets paving. Without it, forms sit *in front of* each other
rather than nestling into each other, and the whole image stays slightly flat.
An SSAO pass, or baked vertex AO at build time, is the single highest-value
addition and I did not get to it. The contact-shadow texture helper exists in
`geom.ts` and is currently unused.

**3. Nothing moves at all.** The brief asked for walkers, vehicles, smaller
moving life, smoke, flags and fountains, and the spike delivers a static frame.
There is a camera sway in the capture loop but its amplitude is a few pixels
over twelve seconds, which is to say it is not there: an independent review of
the video reported no camera motion whatsoever, and that is the honest reading.
The pedestrians make it worse — two stacked rounded boxes with a sphere on top,
identical, facing fixed directions, no gait, no arms, no height variation, two
body colours between them. In Clash or Townscaper the ambient life is most of
what sells a place as inhabited; here a still and a moving frame are the same
image, and the state changes are instant hard cuts with no dust, settle or
transition between them. Animation was scoped out to get the four states
standing up, and it is the most obvious absence the moment you watch rather than
look.

Three smaller ones worth recording: the building vocabulary is still
fundamentally prismatic — no curves, no chamfered corners at the urban scale, no
material changes partway up a facade; the creek is a flat opaque polygon with no
movement, transparency or shoreline detail, which stands out badly against the
density of the block; and there is no post-processing at all, so no bloom on the
lit signage, no vignette, and no colour grading pulling the frame toward a
coherent warm key.
