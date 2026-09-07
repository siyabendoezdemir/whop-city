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
  water: standard("#4d90b8", 0.28, 0.1),
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
  brick: standard("#b4664a", 0.86),
  brickDark: standard("#8f4f39", 0.88),
  renderCream: standard("#f1e6d3", 0.82),
  renderCreamFaded: standard("#d9cebb", 0.94),
  renderTeal: standard("#3f8f92", 0.8),
  renderTealFaded: standard("#5b7f80", 0.93),
  renderClay: standard("#d9784a", 0.8),
  renderClayFaded: standard("#b3785c", 0.94),
  plaster: standard("#e6ddcd", 0.88),

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
  // World UVs are baked at half a unit per metre, which makes a 256px tile two
  // metres across — about one screen pixel on the creek at this camera. The
  // ripple map gets its own repeat so a tile spans tens of metres and can
  // actually be seen to move.
  ripples.repeat.set(0.045, 0.045);
  assign(M.water, ripples, { rough: false, roughness: 0.24 });
  drifting = ripples;

  // The second layer. Its own repeat and its own angle, so that when the two
  // scroll at different rates the crossing pattern shifts instead of sliding.
  const shimmer = waterNormals();
  shimmer.repeat.set(0.031, 0.031);
  shimmer.center.set(0.5, 0.5);
  shimmer.rotation = 0.72;
  M.water.normalMap = shimmer;
  M.water.normalScale.set(0.5, 0.5);
  M.water.needsUpdate = true;
  shimmering = shimmer;

  // Walls.
  assign(M.brick, brickTex);
  assign(M.brickDark, brickTex);
  for (const material of [
    M.renderCream,
    M.renderCreamFaded,
    M.renderTeal,
    M.renderTealFaded,
    M.renderClay,
    M.renderClayFaded,
    M.fascia,
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
export function waterOffset(t: number): [u: number, v: number] {
  return [t * 0.0054, t * 0.024];
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
  return [t * -0.0031, t * 0.0162];
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
