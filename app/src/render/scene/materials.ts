import * as THREE from "three";

import {
  asphaltGrain,
  brickCourses,
  concreteGrain,
  glassPanes,
  pavingSeams,
  renderGrain,
  roofRibs,
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
  gravel: standard("#948d80", 0.98),

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
  roofZinc: standard("#6c7683", 0.62, 0.35),
  roofZincWorn: standard("#5d646d", 0.85, 0.2),
  roofFelt: standard("#4c4a48", 0.95),
  fascia: standard("#f6f1e6", 0.8),

  // --------------------------------------------------------------- metal
  steel: standard("#8d949d", 0.5, 0.6),
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
  // World UVs are baked at half a unit per metre, which makes a 256px tile two
  // metres across — about one screen pixel on the creek at this camera. The
  // ripple map gets its own repeat so a tile spans tens of metres and can
  // actually be seen to move.
  ripples.repeat.set(0.045, 0.045);
  assign(M.water, ripples, { rough: false, roughness: 0.24 });

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
  assign(M.roofFelt, grain);
  assign(M.shutter, ribs);

  // Glazing: value variation per pane is what stops glass reading as paint.
  for (const material of [M.glass, M.glassDim, M.glassLit]) {
    material.map = panes;
    material.needsUpdate = true;
  }
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
