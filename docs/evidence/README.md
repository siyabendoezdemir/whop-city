# Evidence

Captured against the built app on the preview server (`pnpm build && pnpm
preview`), not the dev bundle, with WebGL through SwiftShader. Regenerate with
`pnpm capture`, `pnpm capture:fly` and `pnpm aliasing-check` from `app/`.

### The operator loop

Captured with `pnpm capture:loop` against a fixtures build, by clicking markers
in the world rather than by calling the camera hook — so what is photographed is
the product being used.

| file | what it shows |
| --- | --- |
| `operator-1-signal.jpg` | Two districts asking urgently and one unbuilt. Lit masts in the world, the same ranking in the queue. Nothing selected yet. |
| `operator-2-focus.jpg` | Commerce Core, selected by clicking its mast. Camera glided in, briefing open with three moves. |
| `operator-3-resolved.jpg` | Every move reviewed. The queue says Reviewed, the progression pip filled, the mast stopped asking. |
| `operator-4-changed.jpg` | Reviewed while shuttered, reopened when the city read healthy: "reads differently than when you reviewed it", and City cannot say why. |
| `operator-5-unavailable.jpg` | No reading. Grey markers, no ranking, no moves, and the reason stated. |
| `operator-6-default.jpg` | The approved world with markers, at the default framing. 157 draw calls, 221,184 triangles. |

### The world

| file | what it shows |
| --- | --- |
| `city-default.jpg` | The default city. Commerce Core healthy, Offer Forge rising, Creator Quarter healthy — the states the default fixture projects. |
| `city-offer-forge-selected.jpg` | Offer Forge selected by clicking the district button: the camera has glided in and the contextual explanation has opened. |
| `city-states.jpg` | The same city under three different projections. Nothing but the projection changed. |
| `city-silhouette.jpg` | Flat black, context removed, to check the landmarks read without material help. |
| `city-unavailable.jpg` | What a business that cannot be read looks like: districts unbuilt, and the crest says so. The surrounding city context is authored and does not belong to any district, so it stays. |
| `city-flythrough.mp4` | 12.3s: the city, then each district in turn, then back out. Driven by clicking the buttons, so the panels and the camera glide are part of the recording. |
| `ambient-motion.jpg` | Everything that moved during two seconds of a static camera hold, as an amplified frame difference. Vehicles, tree canopies, harbour craft and pedestrians. |
| `renderer-stats.json` | Draw calls, triangles, geometries and textures for each captured state. |
| `aliasing-check.json` | Sub-pixel camera walk over the road network. |

Worst case across all eight captured states: **148 draw calls** against a budget
of 220, and **213,110 triangles** against 250,000.

## On the ambient life

A review of the fly-through reported the world as completely frozen. It is not,
and `ambient-motion.jpg` is the check: over two seconds of a held camera, the
vehicles, tree canopies, harbour craft and pedestrians all move, and the actor
transforms confirm it in the scene graph — a bus travels about 39 world units
between t=0 and t=6.

The reading is understandable though. At the wide framing a car is roughly
twelve pixels across and a canopy sways two or three, so at a glance the city
reads more still than it is. That is a composition question about the default
zoom rather than a bug, and it is worth a decision rather than a silent tweak.

## The operator session (`pnpm capture:play`)

A recorded playthrough. Every scenario named below is a **fixture**, not a live
business: `pnpm build:fixtures` serves deterministic states so each condition
can be shown. A live deployment runs the same code with a real projection.

Captured at 1440×900, supersampling 1.

| Frame | Scenario | What it shows |
| --- | --- | --- |
| `play-1-orientation` | struggling | First visit: whose business the city depicts, and that local actions do not operate it |
| `play-2-signal` | struggling | Two districts reading wrong, one never built on — before reading a word of panel |
| `play-3-reading` | struggling | The reading, its ambiguity, and the limit of what City can know |
| `play-4-finding` | struggling | A finding recorded; an action lands in the plan |
| `play-5-worked` | struggling | **The key frame.** Worked and still reading wrong: two chips, and the hazard beacon still standing |
| `play-6-optional` | struggling | Affiliates asked about rather than assumed |
| `play-7-declined` | struggling | "Deliberately not" recorded as a decision |
| `play-8-blank` | blank | A brand-new business gets a different session |
| `play-9-decision` | blank | A branching pricing decision, not a checklist |
| `play-10-branch` | blank | The answer chose what comes next |
| `play-11-plan` | thriving | The round finishes; the plan is the payoff |
| `play-12-return` | struggling | Returning to a changed reading: kept, flagged, not claimed as caused |
| `play-13-unavailable` | unavailable | No reading, so no work proposed |

`city-playthrough.mp4` — 33.6s, the thirteen beats in order.

### Renderer, measured at the default framing

| Scenario | Draw calls | Triangles |
| --- | --- | --- |
| struggling | 133 | 151,530 |
| thriving | 152 | 213,910 |
| blank | 136 | 152,178 |
| unavailable | 121 | 151,602 |

Budgets are 220 draw calls and 250,000 triangles.
