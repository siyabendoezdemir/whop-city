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

A later review made the same complaint but named the water, and that one was
right. Every moving thing in the city was an object with a position — the
ferry, the traffic, the walkers, the steam — which left the bay, about a third
of the frame, perfectly still next to a boat under way. Calm water beside a
moving hull does not read as calm; it reads as a bug.

The ripple map had been drawn strong enough to scroll and never scrolled: the
texture's own comment says "a texture you cannot see is a texture you cannot
animate", and the animation was never wired to it. It scrolls now, off the
terrain tick that every caller already drives, so the live loop, the plot
sheets and the film all get it. No mesh, no material, no triangle, no draw
call — the numbers below are unchanged.

The direction is the whole trick. `waterRipples` lays its streaks as
full-width bands along `u`, so the first attempt, which travelled mostly in
`u`, slid every streak along its own length and moved the map five metres to
no visible effect whatsoever. Frames captured before and after differed by
36dB either way, which is the trap: the pixels change, and nothing reads as
motion. The travel is in `v` now, across the bands. `tests/geom.test.ts` pins
the axes for the same reason the wedge orientation is pinned — no screenshot
catches it being wrong.

The speed took a second pass too. Half a metre a second is right for a bay and
wrong for a screen: at the framing the game is played at the water is two or
three pixels a metre, so the streaks crossed about two pixels a second, and a
reviewer watching ten seconds of held camera reported the surface as
"completely static" — correctly, as far as the eye goes. The measurement
agreed with them and with the code at once: the water region of two frames
five seconds apart differed, but by 35dB, which is change without motion. It
runs at about a metre a second now, a fifth of the ferry's speed, which
survives both the zoom and the encoder.

`waterfront_in_motion.mp4` is the check — camera locked, clock advancing, so
everything that moves is the world. It also has to warm up before it records:
the founding sweep raises its cap on a React interval, and with the render
loop stopped for capture those updates only flush when a frame is asked for,
so the first version of the shot spent half its length watching the city grow.

## The round (`pnpm capture:round`)

A recorded playthrough of the release build. Every scenario named below is a
**fixture**, not a live business: `pnpm build:fixtures` serves deterministic
states so each condition can be shown. A live deployment runs the same code
against a real projection.

Captured at 1440x900 (the phone frames at 390x780), supersampling 1.

| Frame | Scenario | What it shows |
| --- | --- | --- |
| `ui-1-rest` | struggling | The resting city: seal, one command bar, camera. Nothing else |
| `ui-2-about` | struggling | What this is and whose, on demand rather than on arrival |
| `ui-3-district` | struggling | Entering a district: identity, condition, one next action |
| `ui-4-evidence` | struggling | The observation and its ambiguity, one click away |
| `ui-5-survey` | struggling | A survey: the answered step collapses, carrying what was said |
| `ui-5b-note` | struggling | The operator's own line, added to the plan and kept locally |
| `ui-6-worked` | struggling | **The key frame.** Worked and still not adding up: the hazard mark still stands |
| `ui-7-optional` | struggling | A fork: affiliates asked about, not assumed |
| `ui-8-declined` | struggling | Set aside deliberately: an outcome, not a gap |
| `ui-9-blank` | blank | A new business gets a different round |
| `ui-10-decision` | blank | A pricing decision composed as a fork, not a form |
| `ui-11-plan` | thriving | The deliverable, with observed and reported kept apart |
| `ui-11b-newround` | thriving | Filed, and a fresh round open — the finished one is kept |
| `ui-11c-filed` | thriving | Earlier rounds, still copyable and downloadable |
| `ui-12-return` | struggling | Returning to a changed reading: kept, flagged, not claimed |
| `ui-13-unavailable` | unavailable | No reading, so nothing suggested |
| `ui-14-phone-rest` | struggling | A phone: the city fills the window |
| `ui-15-phone-district` | struggling | A phone: the sheet takes the lower part, the city keeps the top |
| `ui-16-phone-note` | struggling | A phone: typing, with the last line clear of the command bar |

`city-round.mp4` — 42.7s. **These are the sixteen captured frames held at
reading pace, not a live screen recording.** This machine has no GPU and
presenting a WebGL frame costs seconds, so a live capture would misrepresent
the timing. Every frame is a real capture of the built app; the film proves the
sequence and the states, not motion quality.

### Before and after, same camera framing

| File | Pair |
| --- | --- |
| `before-after-rest.jpg` | The resting city, struggling, city framing |
| `before-after-district.jpg` | Commerce Core selected, struggling |
| `before-after-plan.jpg` | The finished round, thriving |

### Renderer, measured at the default framing

| Scenario | Draw calls | Triangles |
| --- | --- | --- |
| struggling | 133 | 151,530 |
| thriving | 152 | 213,910 |
| blank | 136 | 152,178 |
| unavailable | 121 | 151,602 |
| struggling, 390x780 | 108 | 146,072 |

Budgets are 220 draw calls and 250,000 triangles. The desktop figures are
unchanged from before the interface work: at the authored aspect and wider the
projection is identical.

## The building pass

A survey of every plot at every level, then eye-level shots of whatever looked
wrong, then the code behind it. `capture/plots.mjs` lays the contact sheet,
`capture/eye.mjs` takes the follow-up close-ups and `capture/survey.mjs` walks
the whole world.

Most of what read as broken came from one mistake. `wedge` puts its tall edge
at `+z`; every roof was authored as though the ridge were at `-z`, so ridge
caps floated over the eaves, chimneys sat half-buried at the low end and
gutters ran along the top. `tests/geom.test.ts` now asserts the orientation, so
the next roof is written against a fact rather than an assumption.

The second was material rather than geometry: rooflights borrowed the wall
glazing, which is dark because that is what a window looks like from outside.
Laid flat under the sky it read as a hole in the deck. `M.glassRoof` is its own
pale, matte, sky-lit material now.

### The wall that started at the roof

Two readers came back off the film with the same note — pale caps floating
over the Creator Quarter's low roofs — and both explained it as the pitches
still being reversed and the build being stale. Neither was true, and it is
worth writing down how that was settled, because "the artefact is old" is
cheap to say and expensive to chase. The timeline the fly-through records is a
pure function of time, so `frame(at, clock)` reproduces any frame of it
exactly. Rebuilding from `HEAD` and re-shooting `frame("offer-forge", 7)` gave
a frame that matched the film at 39.5 dB across the world, against 24.6 dB over
the full image — the whole difference being a HUD panel the still does not open.
39.5 dB is H.264 at CRF 18 and nothing else. The build was current; the
geometry was not.

What was floating is the party wall, and the readers were pointing at something
real. `capture/eye.mjs` on `creator-terrace`, with the wall and its coping
temporarily painted magenta, put it beyond argument in one frame: the magenta
was the artefact.

A level wall under a level coping cannot carry a plate that falls at 0.17. It
is right at one point along the run and wrong everywhere else, and this one was
right near the middle — the plate cut down into the wall head at the back and
lifted a metre and a half clear of it at the front, so what showed was a brick
wedge tapering out of the tiles with a pale bar riding it and open air
underneath. The plate now lands on a wall cut to the pitch, and the wall runs
to the ground and stands the same height proud along the whole range.

The terrace bays in `pitchedRoof` had the same fault waiting behind a dice
roll. The wall there was a 0.66 bar centred 0.06 outside the bay line, so a
third of its width overhung the neighbour — and bays in that run deliberately
step a storey off each other, so the overhang was over a lower roof. It stands
on the line now, with the flank below the eaves and the triangle under the rake.

Three of the six things flagged did not reproduce at close range: the
rooflights are pale and kerbed and seated in the slope, the sawtooth verges
carry their coping, and the ferry passes the moored barge in clear water. The
dithered band on the mews roofs is the shadow map's edge at 4096 over a 236m
extent, about 5.8cm a texel, which is the documented cost of welding the
shadow rig to the world so it does not crawl under the camera.

### Renderer, after the pass

| Scenario | Draw calls | Triangles |
| --- | --- | --- |
| balanced | 193 | 172,452 |
| launch | 174 | 141,238 |
| thriving | 195 | 172,752 |
| struggling | 198 | 172,920 |
| unavailable | 143 | 130,298 |
| every plot at level 5 | 207 | 219,636 |

The last row is the one that matters and the one nothing used to measure. No
fixture stands every plot at the top of its ladder, but a player who grows the
whole board does, and that world came in at 261,000 triangles against the
250,000 ceiling. `bevelBox` falling back to a plain box under 1.6m, cheaper
bollards, octahedron canopies on distant trees and single-sided window bands on
the far bank brought it to 219,472. Cutting the party walls to the pitch put
164 back. `tests/browser/world.spec.ts` holds it there.
