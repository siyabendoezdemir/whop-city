import * as THREE from "three";

import {
  asphaltGrain,
  brickCourses,
  concreteGrain,
  glassPanes,
  pavingSeams,
  renderGrain,
  roofRibs,
  turfGrain,
  waterNormals,
  waterRipples,
} from "./textures";

/**
 * One shared palette for the whole block.
 *
 * Every mesh in the scene points at a material from this registry, which is
 * what keeps the draw-call count tied to the number of distinct surfaces rather
 * than the number of objects. Nothing creates a material inline.
 *
 * The colour direction is bright coastal San Francisco: warm sunlit renders and
 * brick, cool slate and zinc roofs, pale concrete, and one hot accent used
 * sparingly so the eye lands on the maker frontage.
 *
 * Worn variants are separate materials rather than a tint applied on top. The
 * struggling state swaps to them, so the change is a different surface, not a
 * filter over the healthy one.
 */

function standard(
  color: string,
  roughness: number,
  metalness = 0,
  extra: Partial<THREE.MeshStandardMaterialParameters> = {},
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
}

/**
 * The six colours a building can be, held apart from the materials made from
 * them because they are each used twice: once for the player's plots and once,
 * drained, for the backdrop.
 */
const BODY = {
  brick: "#b4664a",
  brickDark: "#8f4f39",
  renderCream: "#f1e6d3",
  renderTeal: "#3f8f92",
  renderClay: "#d9784a",
  plaster: "#e6ddcd",
} as const;

/** How far a backdrop body gives up its colour. Swept; see `pnpm own`. */
const DRAINED = 0.66;

/**
 * The same body colour, for a building that is not yours.
 *
 * The backdrop massing and the eleven playable plots were built from one set of
 * six materials, which meant a player asking "which of these are mine?" had
 * nothing in the frame to answer with: the block across the ring road was the
 * same brick as the block they owned, at the same size, finished the same way.
 *
 * Draining rather than darkening, and toward the colour's own luminance rather
 * than toward a fixed grey. Value is what carries the massing — how a city
 * reads as depth at this camera is light faces against dark ones — so a
 * backdrop that has been dimmed loses its form and flattens into a wall. One
 * that has only lost its saturation keeps every plane exactly as bright as it
 * was and just stops competing, which leaves a plain reading of the frame:
 * downtown is concrete and glass, and the warm painted quarter is yours.
 */
function drained(color: string, roughness: number): THREE.MeshStandardMaterial {
  const own = new THREE.Color(color);
  const grey = own.r * 0.2126 + own.g * 0.7152 + own.b * 0.0722;
  return standard(
    `#${own.lerp(new THREE.Color(grey, grey, grey), DRAINED).getHexString()}`,
    roughness,
  );
}

/**
 * One material for every small animated actor.
 *
 * Their colour arrives through vertex colours instead, which is what lets a
 * whole figure or vehicle collapse into a single draw call.
 */
export const ACTOR_SURFACE = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.72,
  metalness: 0.04,
  vertexColors: true,
});

export const M = {
  // ---------------------------------------------------------------- ground
  asphalt: standard("#54585f", 0.96),
  asphaltPatched: standard("#4a4d53", 0.99),
  roadLine: standard("#e8e2cf", 0.85),
  sidewalk: standard("#c9c6bd", 0.92),
  sidewalkWorn: standard("#b4b1a7", 0.97),
  kerb: standard("#d8d5cb", 0.86),
  concrete: standard("#c2beb4", 0.9),
  concreteDark: standard("#a09c93", 0.93),
  yardApron: standard("#b3aea3", 0.94),
  dirt: standard("#a98f6d", 0.98),
  dirtDry: standard("#bda57f", 0.99),
  grass: standard("#7fa860", 0.92),
  /**
   * The bay, the creek and the canal.
   *
   * Matte and barely reflective, which is the opposite of the obvious setting
   * and the whole reason this used to look like marble. At a roughness of a
   * quarter with a full environment reflection, almost every pixel of the bay
   * was sky rather than water: pale where it caught the bright part of the
   * dome, navy where it caught the dark, and the base colour so nearly absent
   * that changing it did not move the render. A mirror laid flat under an
   * overcast sky is a white sheet, and that is exactly what was on screen.
   *
   * Dropping the environment to a fifth and taking the metalness off hands the
   * surface back to its own colour, so the swell in the map is what you see.
   * The sun still glints off it through the normal map — water needs that or it
   * reads as painted concrete — but as a highlight on water rather than as the
   * whole of it.
   */
  water: standard("#63b1d6", 0.42, 0, { envMapIntensity: 0.2 }),

  /**
   * The foot of every quay wall and bank.
   *
   * Water met the land on a razor line: the plane simply stopped against the
   * masonry with no shallows, no foam and no change of tone, which is the tell
   * that gives away a flat plane pretending to be a body of water. Real water
   * against a wall is paler where it is shallow and breaking, and the eye reads
   * that band as depth even when there is none.
   *
   * A shade of the water rather than white, and narrow. Wide and bright, it
   * stops being shallows and becomes a stripe painted round the coast.
   */
  shallows: standard("#8ec9e2", 0.44, 0, {
    envMapIntensity: 0.2,
    // Laid in the same plane as the water rather than a few centimetres proud
    // of it. Standing it proud is the obvious way to win the depth test and it
    // leaves the strip's own side wall poking above the surface — a hairline of
    // shadow tracing the whole coast, and the more visible the closer the
    // camera gets. A depth bias wins the same argument without the step.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  }),
  /**
   * Disturbed water behind the ferry.
   *
   * The wake was `sidewalk` — an opaque paving colour — which put a nine-metre
   * pale slab on the bay wherever the boat was, hard-edged and reading as a
   * pontoon rather than as water. Foam is white and it is mostly transparent.
   */
  foam: standard("#e9f2f7", 0.92, 0, { transparent: true, opacity: 0.34 }),
  gravel: standard("#948d80", 0.98),

  // ------------------------------------------------------------- farmland
  // The plain the city stands on. Deliberately close together in value: the
  // point is that the distance reads as worked land rather than as one flat
  // fill, not that anybody counts the crops. Anything with real contrast out
  // here competes with the city, which is the thing you are meant to look at.
  meadow: standard("#7ba55d", 0.94),
  pasture: standard("#86ad64", 0.94),
  cropGreen: standard("#8fb262", 0.95),
  cropYoung: standard("#9cb96c", 0.95),
  stubble: standard("#bdb47e", 0.96),
  fallow: standard("#93a367", 0.96),
  ploughed: standard("#9d8563", 0.97),

  // ------------------------------------------------------------ structure
  brick: standard(BODY.brick, 0.86),
  brickDark: standard(BODY.brickDark, 0.88),
  renderCream: standard(BODY.renderCream, 0.82),
  renderCreamFaded: standard("#d9cebb", 0.94),
  renderTeal: standard(BODY.renderTeal, 0.8),
  renderTealFaded: standard("#5b7f80", 0.93),
  renderClay: standard(BODY.renderClay, 0.8),
  renderClayFaded: standard("#b3785c", 0.94),
  plaster: standard(BODY.plaster, 0.88),

  // Six bodies for buildings the player does not own. Only `buildSurroundings`
  // uses these; a playable plot reaching for one is a bug.
  //
  // The four with colour in them are drained from the player's own, so the
  // backdrop is recognisably the same city and not a different one pasted in
  // behind. The two pale ones are not, because they cannot be: `renderCream`
  // and `plaster` are within a few per cent of neutral already, so draining
  // them returns almost the colour they started at, and a cream block across
  // the water went on looking exactly like the cream landmark you own. What
  // separates two pale surfaces at the same value is temperature, so these are
  // the cool of concrete against the warm of painted render.
  backdropBrick: drained(BODY.brick, 0.86),
  backdropBrickDark: drained(BODY.brickDark, 0.88),
  backdropTeal: drained(BODY.renderTeal, 0.8),
  backdropClay: drained(BODY.renderClay, 0.8),
  backdropCream: standard("#dee3e7", 0.86),
  backdropPlaster: standard("#c8cfd5", 0.9),

  // ------------------------------------------------------------- roofing
  //
  // The camera looks down at thirty-one degrees, which makes roofs somewhere
  // near half of everything on screen — more than that over the sheds and the
  // mews, where the pitch is the building. They were the darkest surfaces in
  // the palette and carried enough metalness to mirror the sky, so a zinc
  // pitch came out a near-black navy and every shed, hall and mews range in
  // the city read as a hole with walls round it.
  //
  // Lifted twice now, and taken most of the way off metal. The sun sits at
  // twenty-seven degrees, so an upward-facing surface gets it at a grazing
  // angle and is lit mainly by the sky — which means a roof always renders a
  // long way under its own albedo. The first lift of fifteen per cent got the
  // sheds out of the near-black; this one gets the mews and hall pitches out
  // of navy. Still clearly the cool half of the palette against warm brick and
  // render — the roofs are meant to be slate, not silver.
  roofZinc: standard("#949fad", 0.72, 0.12),
  roofZincWorn: standard("#7d838d", 0.88, 0.08),
  /**
   * Built-up felt, for the flat decks between the plant on them.
   *
   * Real felt is nearly black, and on a building seen from the side that is
   * fine because you never see it. This camera looks down at thirty-one
   * degrees, which makes the deck the largest single surface on every
   * flat-roofed block in the city, and at #5c5a57 each one finished in a hole.
   * Lifted to the colour of weathered mineral chippings, which is what a deck
   * that has been rained on for ten years actually looks like from above.
   */
  roofFelt: standard("#6e6a64", 0.95),
  /**
   * Profiled sheeting, for the big industrial decks.
   *
   * A sawtooth over a fourteen-metre shed is the largest single plane on the
   * Offer Forge, and putting slate on it made the whole district read as
   * derelict. Factory roofs are pale galvanised sheet, which is also what
   * keeps the sawtooth's own glazing legible against it.
   */
  roofSheet: standard("#9ba1a6", 0.8, 0.06),
  fascia: standard("#f6f1e6", 0.8),

  // --------------------------------------------------------------- metal
  /**
   * Structural and fabricated steel: frames, gantries, stairs, handrails.
   *
   * This was authored as a metal — sixty per cent metalness at half roughness —
   * and a metal has almost no diffuse term, so what it shows is whatever it
   * reflects. A column standing in the open reflects the horizon and the ground
   * back at a camera looking down at it, and both of those are dark. Every
   * piece of steel in the city that was not lying against a pale wall came out
   * near-black: the Offer Forge's portal frames read as a burnt fence, the
   * plant-deck props as hairs drawn over the building, the venue's fire escape
   * as a ladder floating in front of nothing.
   *
   * Real structural steel is painted or galvanised, and neither behaves like a
   * mirror. Mostly diffuse, with enough sheen left to catch the sun on a top
   * flange.
   */
  steel: standard("#98a0aa", 0.62, 0.16),
  steelPainted: standard("#e0e4e8", 0.6, 0.25),
  steelRust: standard("#8a5236", 0.92, 0.15),
  ironDark: standard("#3c4148", 0.7, 0.4),
  aluminium: standard("#b9c0c7", 0.4, 0.7),

  // --------------------------------------------------------------- glass
  glass: standard("#9fc6dd", 0.12, 0.1, {
    transparent: true,
    opacity: 0.78,
    envMapIntensity: 1.5,
  }),
  /**
   * Glazing that lies down.
   *
   * `glass` is authored for a wall: sharp, mirror-smooth, and reflecting the
   * environment at one and a half times, which on a vertical face picks up the
   * blue above the horizon and reads as glass. Lay the same material nearly
   * flat — a rooflight in a mews pitch, daylight in a hall roof — and the
   * reflected ray goes to the warm haze band instead, at a grazing angle where
   * Fresnel is strongest. Every rooflight in the city was coming out as an
   * opaque cream rectangle: from above, which is most of what this camera sees,
   * the Creator Quarter's mews ranges looked like somebody had stuck post-its
   * to the tiles.
   *
   * Rooflights are patent glazing, wired or diffusing, over a dark interior.
   * Rough and barely reflective — but not dark.
   *
   * Third time. Cutting `envMapIntensity` to three tenths did stop the haze
   * reflection, and took the diffuse sky with it: this scene is lit at
   * `environmentIntensity` 1.15, so a tenth of the environment is a tenth of
   * the light. The mews glazing measured 26,43,64 against a roof at 74,98,127 —
   * two fifths the brightness of the slate it was set into, which from above
   * is a hole in the roof, and eight of them per range.
   *
   * What a diffusing rooflight actually does is scatter: it is the brightest
   * thing on a workshop roof, and it is bright because it is rough, not because
   * it is mirroring anything. Pale and matte, lit by the sky like everything
   * else, with just enough environment left off to keep the horizon out of it.
   */
  glassRoof: standard("#b5c6d2", 0.68, 0.02, {
    transparent: true,
    opacity: 0.95,
    envMapIntensity: 0.8,
  }),
  glassDim: standard("#6f8391", 0.35, 0.1, { transparent: true, opacity: 0.85 }),
  glassLit: standard("#ffe9b8", 0.25, 0, {
    emissive: new THREE.Color("#ffca63"),
    emissiveIntensity: 0.75,
  }),
  shutter: standard("#8e949b", 0.75, 0.25),
  boarding: standard("#b99a6f", 0.95),

  // --------------------------------------------------------------- timber
  timber: standard("#c08a4f", 0.9),
  timberPale: standard("#dcb987", 0.9),
  timberDark: standard("#8a6236", 0.92),

  // ------------------------------------------------------- signs + accent
  accent: standard("#ff6a3d", 0.6),
  accentDeep: standard("#d24a20", 0.7),
  signLit: standard("#fff4dd", 0.4, 0, {
    emissive: new THREE.Color("#ffb648"),
    emissiveIntensity: 0.9,
  }),
  signDead: standard("#b9b2a4", 0.9),
  signBoard: standard("#22303c", 0.75),
  canvasAwning: standard("#e4573d", 0.85),
  canvasAwningFaded: standard("#b8776a", 0.95),
  hoarding: standard("#cfd6dd", 0.9),
  hoardingRail: standard("#9aa3ac", 0.8),

  // ------------------------------------------------------- site + hazard
  hazard: standard("#f0a92c", 0.8),
  hazardDark: standard("#c9821c", 0.85),
  netting: standard("#4fa06d", 0.9, 0, { transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
  tarp: standard("#5b7fa8", 0.9),

  // -------------------------------------------------------------- planting
  foliage: standard("#5f8f4a", 0.95, 0, { flatShading: true }),
  foliageDeep: standard("#4a7a3c", 0.95, 0, { flatShading: true }),
  foliageDry: standard("#8a8a4e", 0.97, 0, { flatShading: true }),
  planter: standard("#9c6f52", 0.92),

  // --------------------------------------------------------------- actors
  personBody: standard("#31527a", 0.85),
  personAlt: standard("#7a3150", 0.85),
  personHiVis: standard("#e8dc45", 0.8),
  personSkin: standard("#d8a184", 0.85),
  vanBody: standard("#f2f4f6", 0.55, 0.1),
  vanAccent: standard("#2f6fb5", 0.5, 0.15),
  tyre: standard("#2a2c30", 0.95),
  plantMachine: standard("#f2c020", 0.62, 0.2),
} as const;

export type MaterialKey = keyof typeof M;

/**
 * Every surface says what it is.
 *
 * Costs nothing and pays for itself the first time something is in the wrong
 * place: geometry here is merged aggressively, so a mesh in the inspector is a
 * whole district's worth of boxes and tells you nothing about which one you are
 * looking at. A named material lets a raycast answer "what is lying on this
 * road" with a word instead of a hex colour to go and look up.
 */
for (const [key, material] of Object.entries(M)) material.name = key;

/** The ripple map, held so the bay can be made to move. Null before boot. */
let drifting: THREE.Texture | null = null;

/** The shimmer on top of it, which travels at its own rate. Null before boot. */
let shimmering: THREE.Texture | null = null;

/**
 * Attaches procedural detail to the palette.
 *
 * Called once, after the renderer exists, because the textures are drawn into
 * canvases at boot. Grain goes on as a colour map and again as a roughness map
 * so surfaces vary in both value and sheen — a wall that is uniformly rough
 * reads as paper, and one that varies reads as material.
 *
 * Deliberately restrained: the strongest map here shifts value by about a tenth.
 * The brief is bright and sunlit, not weathered.
 */
export function applySurfaceDetail(): void {
  const grain = concreteGrain();
  const render = renderGrain();
  const paving = pavingSeams();
  const asphalt = asphaltGrain();
  const ribs = roofRibs();
  const brickTex = brickCourses();
  const panes = glassPanes();
  const ripples = waterRipples();

  const assign = (
    material: THREE.MeshStandardMaterial,
    map: THREE.Texture,
    options: { rough?: boolean; roughness?: number } = {},
  ) => {
    material.map = map;
    if (options.rough !== false) material.roughnessMap = map;
    if (options.roughness !== undefined) material.roughness = options.roughness;
    material.needsUpdate = true;
  };

  // Ground surfaces.
  assign(M.asphalt, asphalt);
  assign(M.asphaltPatched, asphalt);
  assign(M.sidewalk, paving);
  assign(M.sidewalkWorn, paving);
  assign(M.kerb, grain);
  assign(M.concrete, grain);
  assign(M.concreteDark, grain);
  assign(M.yardApron, paving);
  assign(M.plaster, render);
  assign(M.gravel, grain);
  assign(M.dirt, grain);
  assign(M.dirtDry, grain);
  const turf = turfGrain();
  for (const material of [
    M.grass,
    M.meadow,
    M.pasture,
    M.cropGreen,
    M.cropYoung,
    M.stubble,
    M.fallow,
    M.ploughed,
  ]) {
    assign(material, turf);
  }
  // World UVs are baked at half a unit per metre, so a repeat of 1 puts a 256px
  // tile two metres across — one screen pixel on the creek at this camera. The
  // water maps get their own repeat, worked back from how wide a swell should
  // be in metres rather than picked as a number.
  ripples.repeat.setScalar(2 / RIPPLE_TILE);
  assign(M.water, ripples, { rough: false });
  // The shallows carry the same swell as the water they are part of. Sharing
  // the texture object rather than a copy is the point: one offset moves both,
  // so the band at the wall can never drift out of step with the bay.
  M.shallows.map = ripples;
  M.shallows.needsUpdate = true;
  drifting = ripples;

  // The second layer. Its own repeat and its own angle, so that when the two
  // scroll at different rates the crossing pattern shifts instead of sliding.
  const shimmer = waterNormals();
  shimmer.repeat.setScalar(2 / SHEEN_TILE);
  shimmer.center.set(0.5, 0.5);
  shimmer.rotation = 0.72;
  M.water.normalMap = shimmer;
  M.shallows.normalMap = shimmer;
  M.shallows.normalScale.set(0.3, 0.3);
  // Swept against the render rather than guessed. Half of this turned the bay
  // into a dark, blown-out, oil-slick sea; a fifth of it was invisible and the
  // surface went back to sliding as one rigid sheet. This is the band where
  // the light moves on the water and the day still reads as a bright one.
  M.water.normalScale.set(0.42, 0.42);
  M.water.needsUpdate = true;
  shimmering = shimmer;

  // How far a wave can drag the swell sideways, in metres.
  //
  // Enough to see the crests work and no more. At the eighty-five centimetres
  // this started at, the displacement stopped reading as a surface moving and
  // started reading as one being smeared — a reviewer called it gloopy, like a
  // distortion brush dragged over the picture, which is a fair description of
  // what stretching a texture too far looks like.
  flow(M.water, 0.5);
  flow(M.shallows, 0.5);

  // Walls. The backdrop bodies take the same maps as the colours they came
  // from: a drained brick is still brick, and a backdrop that lost its courses
  // along with its colour would read as a different material rather than as
  // the same city further away.
  assign(M.brick, brickTex);
  assign(M.brickDark, brickTex);
  assign(M.backdropBrick, brickTex);
  assign(M.backdropBrickDark, brickTex);
  for (const material of [
    M.renderCream,
    M.renderCreamFaded,
    M.renderTeal,
    M.renderTealFaded,
    M.renderClay,
    M.renderClayFaded,
    M.fascia,
    M.backdropCream,
    M.backdropTeal,
    M.backdropClay,
    M.backdropPlaster,
  ]) {
    assign(material, render);
  }

  // Roofs and metalwork.
  assign(M.roofZinc, ribs);
  assign(M.roofZincWorn, ribs);
  assign(M.roofSheet, ribs);
  assign(M.roofFelt, grain);
  assign(M.shutter, ribs);

  // Glazing: value variation per pane is what stops glass reading as paint.
  for (const material of [M.glass, M.glassRoof, M.glassDim, M.glassLit]) {
    material.map = panes;
    material.needsUpdate = true;
  }
}

/**
 * Sets the bay moving.
 *
 * Everything else in the city that lives — the ferry, the traffic, the walkers,
 * the steam — is an object with a position, so the water was the last large
 * surface with nothing happening on it. Sat next to a moving ferry, a mirror-
 * still bay reads as a bug rather than as calm, and it is the largest single
 * area on screen: a third of the frame doing nothing drags the whole picture
 * toward diorama.
 *
 * A scrolling map rather than a new mesh or a shader, because the water is
 * already one box per stretch of the plane and this adds no triangle, no draw
 * call and no material to it. One tile spans about forty-four metres, so the
 * rate below works out at a sixth of a metre a second — a current, not a
 * conveyor. Deterministic in `t`, so a still captured at a given clock is the
 * same still every time.
 */
export function driftWater(t: number): void {
  const [u, v] = waterOffset(t);
  if (drifting) drifting.offset.set(u, v);
  const [su, sv] = waterSheenOffset(t);
  if (shimmering) shimmering.offset.set(su, sv);
}

/**
 * Where the ripple map sits at `t`, in tiles.
 *
 * Split out from the drift itself so the one fact that matters here can be
 * asserted without a canvas: the travel is mostly in `v`, across the grain.
 * `waterRipples` draws its streaks as full-width bands along `u`, so a map
 * scrolled in `u` slides every streak along its own length and the surface
 * sits perfectly still no matter how fast the number climbs — which is exactly
 * what the first version of this did. Getting it backwards costs nothing that
 * a screenshot would catch, so the axes are pinned in `geom.test.ts`.
 *
 * `u` is not zero only so the current runs at a slight angle to the bands and
 * does not read as marching scanlines.
 *
 * One tile spans about forty-four metres, putting the rate below near a metre
 * a second. Half that was the first honest attempt and it failed a viewing
 * test: at the framing the game is played at the bay is a couple of pixels per
 * metre, so half a metre a second is two pixels a second of very low-contrast
 * streak, which video compression removes entirely. A metre a second is about
 * a fifth of the ferry's speed — still plainly a current rather than a rapid,
 * but fast enough to survive the zoom and the encoder.
 */
/**
 * Let the wave field push the swell around instead of only carrying it.
 *
 * Two scrolling maps are still two translations, and a viewer sees straight
 * through that: however many layers slide, if each one only slides then the
 * whole surface is a printed sheet on a conveyor. It survived a review twice,
 * described both times as a pattern moving as one locked unit — which it was.
 *
 * So the colour is looked up through the normal map rather than beside it. The
 * wave slope at a point displaces where that point samples the swell, and
 * because the two maps scroll at different rates and angles, the displacement
 * field drifts across the crests rather than with them. Lines bulge, thin and
 * knit back together instead of marching. It is also roughly what water does
 * to what you see through it, which is presumably why it reads.
 *
 * One extra texture fetch on one material, no geometry and no draw call. The
 * alternative — averaging a second sample of the swell — evolves just as well
 * and costs the contrast that makes a crest a crest.
 */
function flow(material: THREE.MeshStandardMaterial, metres: number): void {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `
      #ifdef USE_MAP
        vec2 swellUv = vMapUv;
        #ifdef USE_NORMALMAP
          swellUv += ( texture2D( normalMap, vNormalMapUv ).xy - 0.5 ) * ${(metres / RIPPLE_TILE).toFixed(5)};
        #endif
        diffuseColor *= texture2D( map, swellUv );
      #endif
      `,
    );
  };
  material.needsUpdate = true;
}

/**
 * Metres across one tile of the ripple map.
 *
 * The number that decides whether the bay reads as water at all. It used to be
 * forty-four, which put the whole canal inside a single tile: what reached the
 * screen was not a swell but one enormous soft gradient, stretched until it
 * looked like weather on a marble slab. Nothing in the material could rescue
 * that, because there was no ripple in frame to see. Around fourteen puts three
 * or four crests across the canal and a field of them on the bay, which is
 * what a swell looks like from this height.
 */
export const RIPPLE_TILE = 14;

/**
 * Metres across one tile of the shimmer.
 *
 * Deliberately not a multiple of the swell: the two maps have to disagree, or
 * their crossing pattern locks and the surface slides as one sheet.
 */
export const SHEEN_TILE = 19;

/**
 * How fast the current runs across the bands, in metres a second.
 *
 * Held here in metres rather than in tiles so that retuning the tile size
 * cannot quietly change the speed of the water — which is precisely what
 * shrinking the tile from forty-four metres to fourteen would otherwise have
 * done, slowing the current to a third without anyone touching it.
 */
const CURRENT_ACROSS = 1.06;

export function waterOffset(t: number): [u: number, v: number] {
  return [(t * CURRENT_ACROSS * 0.22) / RIPPLE_TILE, (t * CURRENT_ACROSS) / RIPPLE_TILE];
}

/**
 * Where the shimmer sits at `t`, in tiles.
 *
 * Deliberately not a multiple of the ripple rate, and crossing it rather than
 * following it: two layers travelling the same way at the same speed are one
 * layer, and the point of the second is that the surface should not move all
 * of a piece. Slower, because the swell carries the current and this only has
 * to keep the light from sitting still.
 */
export function waterSheenOffset(t: number): [u: number, v: number] {
  return [(t * CURRENT_ACROSS * -0.13) / SHEEN_TILE, (t * CURRENT_ACROSS * 0.68) / SHEEN_TILE];
}

/** Used by the README stats pass. */
export function materialCount(): number {
  return Object.keys(M).length;
}

// Occlusion is baked per-vertex across the whole scene, so every material in
// the palette has to read it.
for (const material of Object.values(M)) {
  (material as THREE.MeshStandardMaterial).vertexColors = true;
}
