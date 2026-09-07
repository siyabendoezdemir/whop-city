# Whop City — visual design brief

Status: **the first visual implementation is rejected.** This document is the
specification the Paper artboard must realise, and the Paper artboard — once
approved — is the visual source of truth that production work follows.

Nothing in this document is implemented. No production world code may be written
against it until the artboard is approved.

## What was rejected, and why

The first attempt rendered three separate isometric pads, each holding a handful
of extruded rectangular prisms in a flat district colour, floating in a large
pale void, framed by a white SaaS header and a segmented bottom nav.

The honest diagnosis: **it is an isometric bar chart, not a city.** The buildings
encode tier as height and district as hue, which makes it a chart with a camera.
Nothing in it is inhabited, nothing is tactile, nothing has been authored. It
does not approach the emotional register of Clash of Clans, Clash Royale, or
Minecraft, and it should not be iterated into shape — the foundation is the
problem, not the polish.

Three specific failures worth naming, because the redesign has to answer each:

- **No place.** Three pads with gaps between them is a diagram of three
  categories. A city is one contiguous surface with roads that connect, ground
  that continues, and edges that mean something.
- **No authorship.** Primitives generated from a seed cannot carry silhouette.
  Landmarks have to be designed, not sampled.
- **Dashboard framing.** A white header and a bottom segmented control tell the
  viewer they are looking at an admin tool with a picture in it.

## What survives

The server work is sound and stays: the read-only Whop adapter, the business
snapshot, the public projection boundary, and their tests. The projection's
*shape* is also fine — bucketed tier, health, direction, signal, freshness, and
a stable per-business seed are the right inputs.

What changes is what those inputs drive. Today tier drives height and health
drives a colour ramp. In the redesign they drive **the state of a place**.

## World composition

**One contiguous city on real landscape.** A single ground plane with elevation,
not three pads. Districts are neighbourhoods that meet each other; the boundary
between them is a street, a river, a rail line, or a change in density — never a
gap.

Required in the overview artboard:

- A road network with real intersections, sidewalks, crossings, and at least one
  bridge or overpass where the terrain demands it.
- Terrain that varies: a slope, a waterfront or a clear urban edge, and parks or
  green space that breaks up the block grid.
- Density sufficient to read as a living place. Filler blocks and background
  massing are expected — not every building is a data-bearing building.
- **The city fills the frame.** Composition is the deliverable, not just the
  assets. No dead pale void around a small model.

**Camera.** Isometric three-quarter, with deliberate foreground, midground, and
background. Foreground gets detail and contact shadow; background gets
atmospheric haze and reduced saturation. Landmark silhouettes must be legible as
black shapes — if the skyline is unrecognisable in silhouette, it is not done.

## District identity

Each district must be identifiable from its architecture and street life alone,
with the label removed. Colour is a supporting cue, never the primary one.

**Commerce Core** — high-energy downtown financial and commercial core. Towers
with real crowns and setbacks, ground-floor storefronts with awnings and
signage, a transit line or station, delivery vehicles moving, visible cranes
where the business is growing. The busiest street life in the city.

**Offer Forge** — maker, design, and light manufacturing. Workshops and studios
with sawtooth roofs and clerestory glazing, gantry cranes, loading yards,
prototyping bays with parts and pallets outside, a plaza where product is shown
off. Colourful display energy — this is where things are made and presented.

**Creator Quarter** — lively community and media neighbourhood. Live-work homes
and studios, small venues, rooftop terraces and gardens, a park with actual
programme in it, creator infrastructure like satellite dishes, rigging, and
lighting trusses. Lower and warmer than the Core, denser with life than with
mass.

### State must change the environment

This is the core requirement. A district's projected state changes **what is
happening in the place**, not a number on a building.

| Projected state | What the city shows |
| --- | --- |
| Rising | Cranes and scaffolds on new frames, fresh paving, new trees staked, more pedestrians, delivery vans moving, lit storefronts |
| Steady | Complete buildings, mature trees, normal foot traffic, awnings out, ordinary daytime activity |
| Dormant / tier 0 | Plots hoarded off, foundations poured but bare, empty lots with weeds, streetlights dark, no crowds, no vehicles |
| Unreadable | Overcast light, no ambient life at all, the city rendered but still — honestly inert rather than falsely calm |

Low health in an otherwise built district reads as **disrepair**: closed
shutters, cracked and patched roadway, unlit signage, scaffolding that is
repairing rather than building, fewer people. High health reads as
**prosperity**: full patios, market stalls, banners, fountains running, gardens
in flower.

## Game feel

**Chunky, but authored.** The silhouette language is bold and readable at small
scale, in the family of Clash and Minecraft. That is a language, not a shortcut:
every building is designed, with a roof that is a roof, bevelled edges, window
mullions, awnings, signage, parapets, and props at its base. Extruded rectangles
are not in the vocabulary.

**Materials and light.** Warm key sunlight at a low enough angle to throw long,
readable shadows. Soft contact shadows anchoring every object to the ground —
nothing floats. Distinguishable materials: brick, painted render, glass, metal
roofing, timber, asphalt, grass, water. Atmospheric depth with distance.

**Small moving life.** The city must be alive before anything is clicked:
pedestrians on sidewalks, vehicles following the road network, a train on the
transit line, smoke from a workshop stack, flags and banners in wind, a fountain,
crane jibs slewing, birds, and light ambient particulate in the sun shafts.
Movement should be small, looping, and cheap — presence, not spectacle.

**Selection feels like entering a neighbourhood.** The camera glides down and in
rather than cutting. Local activity responds — more pedestrians visible, signage
legible, a storefront opens. Information is anchored to the place it describes,
not parked in a floating panel.

**Labels are diegetic.** District identity is carried by physical signage in the
world: a gateway sign, a painted gable end, a water tower, a station name board,
a banner across a street. Where a map label is genuinely needed it is restrained
and typographic, sitting in the world's plane. No floating dashboard text over
the city.

## Product shell

**The city owns the viewport.** Remove the white header. Remove the bottom
segmented navigation. There is no chrome band above or below the world.

What remains, quiet and at the edges, in a game register rather than a SaaS one:

- **City level** — the overall tier, as a small crest or badge, not a stat chip.
- **Privacy state** — a discreet indicator that this is the public view, and that
  what is shown is a projection. It must stay visible; it is a promise, not a
  decoration.
- **District navigation** — a compact way to move between neighbourhoods that
  reads as a map control or compass, not tabs.
- **Camera controls** — zoom and reset, minimal, edge-anchored.

**No dashboard panels until a place is selected.** The default state is the city
and nothing else. Selecting a district reveals its information anchored to that
district. Operator Mode remains visible-but-locked when a place is selected, and
must keep reading as genuinely disabled rather than pending.

## Deliverables in Paper

### 1. Overview artboard — three states

Each state is the full frame, at the intended aspect, composed as it would ship.

1. **Approved default city view.** The whole city, no selection, no panels.
   This is the state the product opens in and the one everything else is judged
   against.
2. **Commerce Core focus.** Camera glided into the downtown core, surrounding
   districts falling back through depth and atmosphere rather than a flat dim,
   district information anchored in place.
3. **Construction / low-health state.** A district visibly under construction or
   in disrepair — scaffolds, hoardings, patched road, dark signage, thin crowds —
   proving that projected state changes the environment and not a bar.

### 2. Component and asset sheet

The kit the city is built from, drawn at consistent scale and light:

- **Buildings** — per district: two landmark silhouettes, three mid-blocks, three
  filler blocks, one under-construction frame, one hoarded empty plot.
- **Ground** — road segments, intersection, crossing, sidewalk, kerb, plaza,
  park, water edge, bridge deck, rail.
- **Props** — trees in three sizes, streetlight, bench, planter, market stall,
  awning, banner, sign types, crane, scaffold, hoarding, fountain, transit stop.
- **Actors** — pedestrian, delivery van, car, train — each at the scale they read
  at in the default camera.
- **State overlays** — the construction, disrepair, and prosperity treatments
  applied to one identical block so the difference is directly comparable.
- **Shell** — city level crest, privacy indicator, district navigation, camera
  controls, and the anchored district information treatment.

### 3. What the artboard must prove

- The default view reads as one inhabited city, full-frame, with no dead void.
- Each district is identifiable with its label hidden.
- The same block, in three states, is unmistakably different in the world.
- The shell is quiet enough that the city is the product.

## Process

1. Build the artboards and the asset sheet in Paper.
2. Review and approve, or return with changes.
3. Only then plan implementation, which will be a fresh world layer. The current
   world and component implementation is disposable and is not the starting
   point.

The data adapter and privacy boundary carry forward unchanged.
