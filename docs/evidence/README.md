# Evidence

Captured against the built app on the preview server (`pnpm build && pnpm
preview`), not the dev bundle, with WebGL through SwiftShader. Regenerate with
`pnpm capture`, `pnpm capture:fly` and `pnpm aliasing-check` from `app/`.

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
