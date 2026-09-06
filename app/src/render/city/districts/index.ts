import * as THREE from "three";

import { PartsBuilder, bevelBox, box, post, slab, wedge } from "../../lib/geom";
import { Rng } from "../../lib/rng";
import { M } from "../../scene/materials";
import { Prop, type InstanceKit } from "../props";
import {
  addPersonTo,
  makeBanner,
  makeForklift,
  makeSteamVent,
  makeVan,
  makeWalker,
  type PersonSpec,
  type Pose,
  type Rig,
} from "../actors";
import { localPlace, localProp, parcelBounds, type Parcel } from "../parcel";
import { STOREY_HEIGHT } from "../../../game/plots";
import {
  authoredBlock,
  facesInView,
  glazingBand,
  roofOf,
  shedCladding,
  shopfront,
  skinFor,
  type Skin,
  type StateName,
} from "./buildings";

/**
 * District programs.
 *
 * Each builder authors into parcel-local space with the frontage at +Z. What
 * separates the three is grain and program, not colour: Commerce Core is deep
 * plots with tall glazed masses and a transit stop; Offer Forge is wide shallow
 * plots with sawtooth sheds and a working yard; Creator Quarter is fine-grained
 * live-work bays with occupied roofs, a venue and a park.
 */

export type Ctx = {
  local: PartsBuilder;
  kit: InstanceKit;
  matrix: THREE.Matrix4;
  parcel: Parcel;
  state: StateName;
  rng: Rng;
  rigs: Rig[];
  /** 0..5. Nought is vacant ground; five is a tower. */
  level: number;
  /** How many floors this plot stands at this level. Zero means vacant. */
  storeys: number;
};

/**
 * A plot with nothing on it yet.
 *
 * A new city is entirely made of these, so it has to look deliberate rather
 * than unfinished: hoarding along the street, a gravelled site behind it, a
 * survey peg, and enough weeds and left equipment that it reads as ground
 * waiting for something rather than a hole in the render.
 *
 * Nothing here animates and nobody stands in it. An empty plot should be the
 * quietest thing in the frame — the eye is supposed to go to what *is* built.
 */
export function buildVacantLot(ctx: Ctx): void {
  const { local, kit, matrix, rng, parcel } = ctx;
  const { x0, x1, z0, z1 } = parcelBounds(parcel);
  const y = parcel.level;

  // Cleared and grassed, with a hardstanding apron inside the gate.
  //
  // Everything here is sized against one fact: a business that has just arrived
  // owns eleven of these and nothing else, so this is the whole city on a first
  // visit. It has to read as land waiting for a building — mown, set out, and
  // obviously somebody's — rather than as a demolition site. The gravel used to
  // take half the plot with a mud track through it and the flanks were fenced
  // in grey mesh, which from the wide shot made a new city look condemned.
  local.add(M.grass, box(parcel.width - 1.2, 0.08, parcel.depth - 1.2), [0, y + 0.04, 0]);
  local.add(M.gravel, box(Math.min(14, parcel.width - 12), 0.05, parcel.depth * 0.24), [
    0,
    y + 0.09,
    z1 - parcel.depth * 0.22,
  ]);

  // Hoarding along the frontage, with a gate left open in the middle. The
  // frontage alone: it is the edge the street sees, and it is enough to say the
  // plot is held. The flanks are the parcel's own boundary treatment.
  const gate = 3.2;
  for (let x = x0 + 1.2; x < x1 - 1.0; x += 2.45) {
    if (Math.abs(x) < gate) continue;
    localProp(kit, matrix, Prop.hoarding, [x, y, z1 - 0.7], 0);
  }

  // Site board on the hoarding: the one bright thing on an empty plot.
  local.add(M.timberDark, post(0.1, 2.4, 5), [-gate - 1.4, y + 1.2, z1 - 0.55]);
  local.add(M.timberDark, post(0.1, 2.4, 5), [-gate - 4.4, y + 1.2, z1 - 0.55]);
  local.add(M.signBoard, box(3.4, 1.9, 0.12), [-gate - 2.9, y + 2.1, z1 - 0.5]);
  local.add(M.accent, box(2.8, 0.34, 0.06), [-gate - 2.9, y + 2.62, z1 - 0.43]);
  local.add(M.plaster, box(2.8, 0.9, 0.05), [-gate - 2.9, y + 1.86, z1 - 0.43]);

  // Set out ready: pegs on the building line, materials stacked on the apron.
  for (let i = 0; i < 4; i++) {
    const px = x0 + 3 + ((parcel.width - 6) / 3) * i;
    localPlace(kit, matrix, "peg", [px, y + 0.06, z1 - parcel.depth * 0.52], 0, 1);
  }
  localPlace(kit, matrix, "gravelPile", [x1 - 5.5, y, z1 - parcel.depth * 0.22], rng.range(0, 3), 0.9);
  for (let i = 0; i < 2; i++) {
    localPlace(kit, matrix, "pallet", [rng.range(x0 + 4, x1 - 4), y, z1 - rng.range(parcel.depth * 0.16, parcel.depth * 0.28)], rng.range(0, 1.4));
  }
  // Self-seeded, on the half nobody has driven over.
  for (let i = 0; i < 5; i++) {
    localProp(kit, matrix, (k, p, yw) => Prop.tree(k, p, yw, rng.range(0.7, 1.05)), [
      rng.range(x0 + 3, x1 - 3),
      y + 0.08,
      rng.range(z0 + 2.5, z0 + parcel.depth * 0.5),
    ], rng.range(0, 6));
  }
  for (let i = 0; i < 9; i++) {
    localPlace(
      kit,
      matrix,
      "weeds",
      [rng.range(x0 + 2, x1 - 2), y + 0.09, rng.range(z0 + 2, z1 - 2)],
      rng.range(0, 3),
      rng.range(0.8, 1.35),
    );
  }
  for (let i = 0; i < 2; i++) {
    localPlace(kit, matrix, "cone", [rng.range(-gate, gate), y, z1 - rng.range(1.6, 3.0)], 0, 1.0);
  }
}

const COATS = [M.personBody, M.personAlt, M.renderTeal, M.accentDeep, M.renderClay, M.timberDark];
const TROUSERS = [M.ironDark, M.steel, M.timberDark, M.personBody];

function person(rng: Rng, pose: Pose, extras: Partial<PersonSpec> = {}): PersonSpec {
  return {
    pose,
    build: rng.range(0.88, 1.12),
    body: rng.pick(COATS),
    legs: rng.pick(TROUSERS),
    hat: rng.chance(0.26) ? "cap" : "none",
    seed: rng.int(1, 1e6),
    ...extras,
  };
}

/** Places a static posed figure in parcel-local space. */
function stand(ctx: Ctx, spec: PersonSpec, at: [number, number, number], yaw = 0): void {
  addPersonTo(ctx.local, spec, at, yaw);
  localPlace(ctx.kit, ctx.matrix, "contact", [at[0], at[1] + 0.018, at[2]], 0, [0.75, 1, 0.75]);
}

/** Adds a world-space walker rig from two parcel-local points. */
function walker(ctx: Ctx, spec: PersonSpec, a: [number, number, number], b: [number, number, number], speed: number, offset = 0): void {
  const pa = new THREE.Vector3(...a).applyMatrix4(ctx.matrix);
  const pb = new THREE.Vector3(...b).applyMatrix4(ctx.matrix);
  ctx.rigs.push(makeWalker(spec, [pa.x, pa.y, pa.z], [pb.x, pb.y, pb.z], speed, offset));
}

function toWorld(ctx: Ctx, p: [number, number, number]): [number, number, number] {
  const v = new THREE.Vector3(...p).applyMatrix4(ctx.matrix);
  return [v.x, v.y, v.z];
}

function worldYaw(ctx: Ctx): number {
  return Math.atan2(ctx.matrix.elements[8], ctx.matrix.elements[10]);
}

// ---------------------------------------------------------------------------
// COMMERCE CORE
// ---------------------------------------------------------------------------

const CORE_SKIN: Skin = {
  body: M.renderCream,
  trim: M.fascia,
  base: M.concreteDark,
  glass: M.glass,
  roof: M.roofZinc,
  accent: M.accent,
};

/**
 * Downtown is not one colour. A run of blocks in a single cream render reads as
 * one extruded mass, so the perimeter blocks draw from a set of commercial
 * skins — stone, brick, glass curtain wall, painted render — while the landmark
 * keeps the pale stone so it stays the one thing the eye goes to.
 */
const CORE_SKINS: Skin[] = [
  CORE_SKIN,
  { body: M.brick, trim: M.plaster, base: M.brickDark, glass: M.glass, roof: M.roofZinc, accent: M.accentDeep },
  { body: M.plaster, trim: M.aluminium, base: M.concreteDark, glass: M.glass, roof: M.roofFelt, accent: M.renderTeal },
  { body: M.renderTeal, trim: M.fascia, base: M.concreteDark, glass: M.glass, roof: M.roofZinc, accent: M.accent },
  { body: M.renderClay, trim: M.fascia, base: M.brickDark, glass: M.glass, roof: M.roofZinc, accent: M.accent },
];

export function buildCommerceCore(ctx: Ctx): void {
  const { local, rng, state, parcel, storeys } = ctx;
  const { x0, x1, z0, z1 } = parcelBounds(parcel);
  const y = parcel.level;
  const skin = skinFor(state, CORE_SKIN);
  const landmark = parcel.id === "core-landmark";
  const storeyH = STOREY_HEIGHT["commerce-core"];
  /** Everything on this plot has to add up to this, or the markers float wrong. */
  const target = storeys * storeyH;

  local.add(M.plaster, box(parcel.width - 1, 0.06, parcel.depth - 1), [0, y + 0.03, 0]);

  if (landmark) {
    // The civic silhouette: a setback tower with a crown, on a retail podium.
    // The podium is a fixed two storeys of retail; the tower above it is
    // however much height the business has earned, split into up to three
    // diminishing stages so a small one still reads as a building rather than
    // as a stub.
    const podiumH = Math.min(7.2, Math.max(4.2, target * 0.24));
    const towerH = Math.max(0, target - podiumH);
    const pw = parcel.width - 2;
    const pd = parcel.depth - 2;
    local.add(skin.body, bevelBox(pw, podiumH, pd, 0.12), [0, y + podiumH / 2, 0]);
    local.add(M.concreteDark, box(pw + 0.4, 0.8, pd + 0.4), [0, y + 0.4, 0]);
    local.add(skin.trim, box(pw + 0.6, 0.4, pd + 0.6), [0, y + podiumH, 0]);
    // A glazed mezzanine right round the podium, with piers. It used to be one
    // band on the frontage, emitted four times at the same height, so the two
    // side elevations of a civic building at a crossroads were bare stone.
    glazingBand(local, skin, y + podiumH * 0.62, pw, pd, 1.6, Math.round(pw / 4));
    for (const sz of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        const px = -pw / 2 + (pw / 4) * i;
        local.add(skin.trim, box(0.5, podiumH * 0.5, 0.6), [px, y + podiumH * 0.25, (sz * pd) / 2]);
      }
    }
    shopfront(local, skin, parcel.width - 6, z1 - 1.0, state);
    // The podium roof is a public terrace at the tower's foot, and it is the
    // largest single surface the camera looks down on anywhere in the city:
    // twenty-six metres by twenty, seen from above. It carried two planters and
    // an air handling unit, which on that much felt is a car park with a shed
    // in the corner.
    const deckY = y + podiumH + 0.2;
    local.add(M.roofFelt, box(pw - 1.2, 0.14, pd - 1.2), [0, deckY + 0.07, 0]);
    local.add(M.timberPale, box(pw - 3.4, 0.1, 5.6), [0, deckY + 0.19, pd * 0.24]);
    // Planting along the parapet, and a hedge line the tower stands behind.
    for (let i = 0; i < 4; i++) {
      const px = -pw * 0.36 + (pw * 0.72 * i) / 3;
      local.add(M.planter, box(pw * 0.15, 0.52, 1.2), [px, deckY + 0.4, pd * 0.38]);
      local.add(M.foliageDeep, box(pw * 0.13, 0.42, 0.95), [px, deckY + 0.82, pd * 0.38]);
    }
    for (const px of [-pw * 0.32, pw * 0.32]) {
      local.add(M.planter, post(0.7, 0.8, 8), [px, deckY + 0.5, pd * 0.08]);
      local.add(M.foliageDeep, new THREE.SphereGeometry(0.95, 7, 5), [px, deckY + 1.5, pd * 0.08]);
    }
    // Parapet rail right round, so the deck has an edge.
    for (const sz of [-1, 1]) {
      local.add(M.ironDark, box(pw - 1.0, 0.06, 0.06), [0, deckY + 1.05, (sz * (pd - 1.4)) / 2]);
      local.add(M.ironDark, box(0.06, 0.06, pd - 1.0), [(sz * (pw - 1.4)) / 2, deckY + 1.05, 0]);
    }
    for (let i = 0; i <= 8; i++) {
      const px = -(pw - 1.0) / 2 + ((pw - 1.0) / 8) * i;
      for (const sz of [-1, 1]) local.add(M.ironDark, post(0.03, 0.95, 4), [px, deckY + 0.6, (sz * (pd - 1.4)) / 2]);
    }
    // Plant and the stair head, pushed to the back where the service core is.
    local.add(M.ironDark, box(6.0, 0.14, 2.4), [-pw * 0.26, deckY + 0.2, -pd * 0.3]);
    for (const ox of [-1.5, 1.5]) {
      local.add(M.steelPainted, bevelBox(2.4, 1.0, 1.8, 0.08), [-pw * 0.26 + ox, deckY + 0.72, -pd * 0.3]);
      local.add(M.aluminium, box(2.0, 0.06, 1.5), [-pw * 0.26 + ox, deckY + 1.25, -pd * 0.3]);
    }
    local.add(M.plaster, bevelBox(2.6, 2.2, 2.4, 0.1), [pw * 0.34, deckY + 1.1, -pd * 0.3]);
    local.add(M.roofZinc, wedge(2.9, 0.55, 2.7), [pw * 0.34, deckY + 2.48, -pd * 0.3]);

    // Tower: up to three diminishing stages with a lantern.
    let base = y + podiumH;
    const stageCount = towerH >= 24 ? 3 : towerH >= 11 ? 2 : towerH > 0 ? 1 : 0;
    const share = [0.42, 0.34, 0.24];
    const plans: Array<[number, number]> = [
      [13, 11],
      [10.5, 9],
      [8, 7],
    ];
    const scale = stageCount === 0 ? 0 : share.slice(0, stageCount).reduce((a, b) => a + b, 0);
    const stages: Array<[number, number, number]> = [];
    for (let i = 0; i < stageCount; i++) {
      stages.push([plans[i][0], plans[i][1], (towerH * share[i]) / scale]);
    }
    // The shaft.
    //
    // Pale stone with pale trim and pale glass: a cream tower whose piers were
    // 18cm of #f6f1e6 against a wall of #f1e6d3, glazed with a blue that is
    // three-quarters transparent. Every one of those is within a few per cent
    // of its neighbour, so the tallest and most important building in the city
    // came out as a smooth beige stick with faint lines on it. The glass needs
    // something dark behind it and the piers need to be structure — half a
    // metre of the wall's own stone, standing proud, casting their own shadow.
    for (let s = 0; s < stages.length; s++) {
      const [w, d, h] = stages[s];
      local.add(skin.body, bevelBox(w, h, d, 0.12), [0, base + h / 2, -1.2]);
      const floors = Math.floor(h / 3.1);
      for (let f = 0; f < floors; f++) {
        const yy = base + 1.7 + f * 3.1;
        if (yy > base + h - 1.1) break;
        local.add(M.ironDark, box(w * 0.95, 1.82, d + 0.03), [0, yy, -1.2]);
        local.add(M.ironDark, box(w + 0.03, 1.82, d * 0.95), [0, yy, -1.2]);
        local.add(skin.glass, box(w * 0.94, 1.7, d + 0.07), [0, yy, -1.2]);
        local.add(skin.glass, box(w + 0.07, 1.7, d * 0.94), [0, yy, -1.2]);
        local.add(skin.trim, box(w + 0.14, 0.16, d + 0.14), [0, yy + 0.95, -1.2]);
      }
      // Piers on all four elevations, in stone, standing clear of the glass.
      for (let i = 1; i < 4; i++) {
        local.add(skin.body, box(0.6, h - 0.4, d + 0.4), [-w / 2 + (w / 4) * i, base + h / 2, -1.2]);
      }
      const sidePiers = Math.max(2, Math.round((4 * d) / w));
      for (let i = 1; i < sidePiers; i++) {
        local.add(skin.body, box(w + 0.4, h - 0.4, 0.6), [0, base + h / 2, -1.2 - d / 2 + (d / sidePiers) * i]);
      }
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          local.add(skin.body, box(1.1, h - 0.3, 1.1), [(sx * w) / 2, base + h / 2, -1.2 + (sz * d) / 2]);
        }
      }
      local.add(skin.trim, box(w + 0.9, 0.55, d + 0.9), [0, base + h - 0.1, -1.2]);
      local.add(M.fascia, box(w + 1.15, 0.16, d + 1.15), [0, base + h + 0.22, -1.2]);
      base += h;
      // The setback shoulder is a working roof: the ring of deck left when the
      // next stage steps in is where a tower of this kind keeps its plant.
      const next = stages[s + 1];
      if (next) {
        local.add(M.roofFelt, box(w - 0.4, 0.12, d - 0.4), [0, base + 0.36, -1.2]);
        const shelf = (w - next[0]) / 2;
        local.add(M.steelPainted, bevelBox(1.7, 0.8, 1.3, 0.06), [w / 2 - shelf * 0.5, base + 0.8, -1.2 + d * 0.24]);
        local.add(M.aluminium, post(0.28, 1.3, 6), [-w / 2 + shelf * 0.5, base + 1.05, -1.2 - d * 0.2]);
        local.add(M.ironDark, box(w - 0.6, 0.05, 0.05), [0, base + 1.05, -1.2 + (d - 0.6) / 2]);
      }
    }
    // Crown: stepped cap, mast and a beacon. Only a finished tower gets one —
    // it is the visible reward for the top of the ladder.
    local.add(skin.trim, box(6.6, 0.7, 7.0), [0, base + 0.35, -1.2]);
    local.add(skin.body, bevelBox(4.4, 2.4, 4.8, 0.14), [0, base + 1.6, -1.2]);
    for (const sx of [-1, 1]) {
      local.add(skin.glass, box(0.1, 1.5, 3.4), [(sx * 4.4) / 2, base + 1.6, -1.2]);
      local.add(skin.glass, box(3.1, 1.5, 0.1), [0, base + 1.6, -1.2 + (sx * 4.8) / 2]);
    }
    local.add(skin.roof, wedge(4.8, 1.5, 5.2), [0, base + 3.5, -1.2]);
    if (ctx.level >= 5) {
      local.add(M.steel, post(0.14, 5.0, 6), [0, base + 6.5, -1.2]);
      local.add(M.signLit, box(0.5, 0.5, 0.5), [0, base + 9.1, -1.2]);
    }
    return;
  }

  // Perimeter commercial blocks: deep, glazed, with retail at grade. The first
  // slot always takes the plot's full height so the level is legible from the
  // wide shot; the rest step down from it, which is what stops a block of
  // identical extrusions.
  const slots = Math.max(2, Math.round(parcel.width / 13));
  const slotW = (parcel.width - 2) / slots;
  // A headland block bounded by streets on all four sides has two street
  // elevations — the long ones — and party walls to its neighbours across the
  // short ones.
  const seen = facesInView(worldYaw(ctx));
  for (let i = 0; i < slots; i++) {
    const cx = x0 + 1 + slotW * (i + 0.5);
    const inner = new PartsBuilder();
    const slotStoreys = i === 0 ? storeys : Math.max(1, storeys - rng.int(0, Math.min(3, storeys - 1)));
    authoredBlock(inner, {
      skin: skinFor(state, CORE_SKINS[(i + parcel.id.length * 2) % CORE_SKINS.length]),
      w: slotW - 1.0,
      d: parcel.depth - 4,
      storeys: slotStoreys,
      storeyH,
      bays: rng.int(3, 5),
      roof: rng.pick(["parapet", "stepped", "monitor"] as const),
      clutter: rng.pick(["plant", "tank", "stair", "vent"] as const),
      seen,
      retail: ["front", "back"],
      state,
      banding: slotStoreys >= 5 && rng.chance(0.7) ? "always" : "auto",
      rng,
    });
    const group = inner.build("core-block");
    group.position.set(cx, y, (z0 + z1) / 2 - 0.5);
    group.updateMatrixWorld(true);
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        local.add(child.material as THREE.Material, child.geometry.clone().applyMatrix4(child.matrixWorld));
      }
    });
  }

  // ---------------------------------------------------------- transit stop
  if (parcel.id === "core-north") {
    const sx = x1 - 3.0;
    local.add(M.concrete, box(4.2, 0.28, 14), [sx, y + 0.14, 0]);
    local.add(M.hazard, box(0.5, 0.05, 14), [sx + 1.9, y + 0.3, 0]);
    for (const oz of [-5.4, 0, 5.4]) {
      local.add(M.steelPainted, post(0.1, 3.0, 6), [sx - 1.6, y + 1.5, oz]);
      local.add(M.steelPainted, post(0.1, 3.0, 6), [sx + 1.6, y + 1.5, oz]);
    }
    local.add(M.glassDim, box(4.6, 0.12, 14.4), [sx, y + 3.05, 0]);
    local.add(M.steelPainted, box(4.8, 0.18, 0.18), [sx, y + 3.14, -7.2]);
    local.add(M.steelPainted, box(4.8, 0.18, 0.18), [sx, y + 3.14, 7.2]);
    local.add(M.signBoard, box(0.14, 0.9, 3.2), [sx - 1.9, y + 2.2, 3.0]);
    local.add(state === "healthy" ? M.signLit : M.signDead, box(0.08, 0.5, 2.6), [sx - 2.0, y + 2.2, 3.0]);
    for (const oz of [-3.2, 2.4]) {
      local.add(M.timber, slab(1.4, 0.1, 0.42, 0.03), [sx, y + 0.62, oz]);
      local.add(M.ironDark, box(0.1, 0.42, 0.36), [sx - 0.6, y + 0.4, oz]);
      local.add(M.ironDark, box(0.1, 0.42, 0.36), [sx + 0.6, y + 0.4, oz]);
    }
    if (state !== "struggling") {
      stand(ctx, person(rng, "stand"), [sx - 0.4, y, 1.2], 1.6);
      stand(ctx, person(rng, "lean", { hat: "cap" }), [sx + 0.3, y, -2.4], 1.4);
    }
  }

  // Kerbside life and a delivery at the loading bay.
  if (state === "healthy") {
    const bay = toWorld(ctx, [x0 + 4.5, y, z1 - 3.2]);
    ctx.rigs.push(makeVan(bay, toWorld(ctx, [x0 + 4.5, y, z1 + 7]), worldYaw(ctx)));
    stand(ctx, person(rng, "carry"), [x0 + 7.0, y, z1 - 3.6], 2.2);
    walker(ctx, person(rng, "walk"), [x0 + 1, y, z1 - 1.4], [x1 - 1, y, z1 - 1.4], 4.6, rng.next());
    walker(ctx, person(rng, "walk", { hat: "cap" }), [x1 - 1, y, z1 - 2.6], [x0 + 1, y, z1 - 2.6], 4.0, rng.next());
    for (let i = 0; i < 3; i++) {
      stand(ctx, person(rng, rng.pick(["stand", "point", "carry"] as const)), [rng.range(x0 + 3, x1 - 3), y, z1 - rng.range(1.2, 3.0)], rng.range(0, 6));
    }
    // Over the podium's air handling, rather than out of thin air above the
    // terrace, which is where this used to start.
    if (landmark) {
      ctx.rigs.push(
        makeSteamVent(toWorld(ctx, [-(parcel.width - 2) * 0.34, y + Math.min(7.2, Math.max(4.2, storeys * STOREY_HEIGHT["commerce-core"] * 0.24)) + 1.9, -(parcel.depth - 2) * 0.28]), 1.0),
      );
    }
  }
}

// ---------------------------------------------------------------------------
// OFFER FORGE — the approved block grammar
// ---------------------------------------------------------------------------

/**
 * Maker skins. Deliberately more saturated than downtown: a working district
 * of painted sheds sitting next to pale commercial stone is what stops the two
 * reading as the same buildings at different heights.
 */
const FORGE_SKINS: Record<string, Skin> = {
  "forge-hero": { body: M.renderCream, trim: M.fascia, base: M.concreteDark, glass: M.glass, roof: M.roofZinc, accent: M.accent },
  "forge-north": { body: M.renderTeal, trim: M.fascia, base: M.concreteDark, glass: M.glass, roof: M.roofZinc, accent: M.accent },
  "forge-south": { body: M.renderClay, trim: M.plaster, base: M.brickDark, glass: M.glass, roof: M.roofZinc, accent: M.renderTeal },
};

export function buildOfferForge(ctx: Ctx): void {
  const { local, kit, matrix, rng, state, parcel, storeys } = ctx;
  const { x0, x1, z0, z1 } = parcelBounds(parcel);
  const y = parcel.level;
  const skin = skinFor(state, FORGE_SKINS[parcel.id] ?? FORGE_SKINS["forge-hero"]);
  const hero = parcel.id === "forge-hero";
  const target = storeys * STOREY_HEIGHT["offer-forge"];

  local.add(M.yardApron, box(parcel.width - 1, 0.05, parcel.depth - 1), [0, y + 0.025, 0]);

  // ------------------------------------------------------ persistent spine
  // Brick street unit at the frontage. This is the piece that carries the
  // plot's height: a working district gets taller by stacking offices over the
  // shed, not by growing the shed. It is also, at the top of the ladder, the
  // second-largest mass on the plot, and it used to be authored by hand with
  // its windows on the +Z frontage only. Every Forge parcel is turned away from
  // the camera, so what the player actually saw was a fifteen-metre blank brick
  // slab with a lid on it — three of them, one per plot. It goes through the
  // shared block grammar now, which knows which walls are on screen.
  //
  // A mill, not a shaft. It used to take the plot's whole target height on a
  // fixed 9.5 × 6.2 footprint, so at the top of the ladder the Offer Forge —
  // a district of sheds — finished in a thirty-two-metre brick tower six
  // metres deep. Every one of the three plots had one, and from the street
  // they read as chimneys somebody had put windows in.
  //
  // A works grows the way a mill grew: the block takes more frontage and more
  // depth as it takes floors, and stops at six. Everything above that is the
  // flue's job.
  // One floor per rung, capped at six.
  //
  // Capping on the district's storey count alone meant the cap bit at level
  // three and never let go: levels three, four and five all built a five-floor
  // block, and since the shed's eave is capped too, the whole plot stood at
  // exactly the same height for the last three rungs of the ladder. The player
  // paid twice for a building that did not change.
  const seenFaces = facesInView(worldYaw(ctx));
  const suStoreys = Math.min(storeys, ctx.level + 1, 6);
  const suW = Math.min(parcel.width * 0.44, 9.0 + suStoreys * 1.4);
  // Capped at what is left between the frontage and the shed's front wall,
  // which on a twenty-metre parcel is about seven metres.
  const suD = Math.min(6.2 + Math.max(0, suStoreys - 3) * 1.2, 7.0);
  const suX = x0 + suW / 2 + 0.8;
  const suH = suStoreys * STOREY_HEIGHT["offer-forge"];
  const suSkin = skinFor(state, {
    body: M.brick,
    trim: M.fascia,
    base: M.concreteDark,
    glass: skin.glass,
    roof: M.roofZinc,
    accent: skin.accent,
  });
  const suInner = new PartsBuilder();
  authoredBlock(suInner, {
    skin: suSkin,
    w: suW,
    d: suD,
    storeys: suStoreys,
    storeyH: STOREY_HEIGHT["offer-forge"],
    bays: Math.max(3, Math.round(suW / 3.4)),
    roof: "parapet",
    seen: seenFaces,
    retail: ["front"],
    state,
    rng,
  });
  const suGroup = suInner.build("forge-street-unit");
  suGroup.position.set(suX, y, z1 - suD / 2 - 0.4);
  suGroup.updateMatrixWorld(true);
  suGroup.traverse((c) => {
    if (c instanceof THREE.Mesh) local.add(c.material as THREE.Material, c.geometry.clone().applyMatrix4(c.matrixWorld));
  });
  // Painted gable sign, the maker equivalent of downtown's lit fascia. On the
  // flank that faces the yard, which is the one the camera has.
  if (suH > 7) {
    local.add(state === "healthy" ? M.accent : M.renderClayFaded, box(0.08, 2.4, 4.6), [
      suX + suW / 2 + 0.06,
      y + 5.6,
      z1 - suD / 2 - 0.4,
    ]);
  }

  // How the plot is divided. The approved block was 34m wide and could afford a
  // full loading yard behind a gantry; a 22m plot cannot, and forcing one on it
  // squeezed the workshop down to a shed. Yard width is therefore earned by
  // frontage, and the workshop takes whatever is left.
  const hasYard = parcel.width >= 28;
  const yardW = hasYard ? 11.5 : 0;

  // Vent stack. It used to run to nine-tenths of the plot's height, which at
  // the top of the ladder put a third sixteen-metre vertical on a plot that by
  // then also has a street unit and a flue: three chimneys arguing over the
  // same silhouette. It stands down once the flue arrives.
  const vsX = x0 + 1.8;
  const vsH = ctx.level >= 5
    ? Math.max(4.2, target * 0.4)
    : Math.max(4.2, Math.min(target * (hero ? 0.9 : 0.72) + 1.6, 11.5));
  local.add(M.brick, bevelBox(1.5, vsH, 1.5, 0.07), [vsX, y + vsH / 2, z0 + 2.4]);
  for (let i = 1; i <= 3; i++) local.add(M.brickDark, box(1.62, 0.3, 1.62), [vsX, y + i * (vsH / 4), z0 + 2.4]);
  local.add(M.brickDark, box(1.86, 0.55, 1.86), [vsX, y + vsH - 0.2, z0 + 2.4]);
  local.add(M.steel, post(0.42, 0.9, 8), [vsX, y + vsH + 0.6, z0 + 2.4]);

  // Yard gantry, only where there is a yard to serve.
  const gx0 = x1 - 10.5;
  const gx1 = x1 - 1.6;
  if (hasYard) {
  const gTop = y + Math.max(5.4, Math.min(target * 0.6, 8.2));
  const gSteel = state === "struggling" ? M.steelRust : M.steelPainted;
  for (const gx of [gx0, gx1]) {
    for (const gz of [z0 + 3.0, z0 + 11.0]) {
      local.add(gSteel, box(0.42, gTop - y, 0.42), [gx, (gTop + y) / 2, gz]);
      local.add(M.concreteDark, box(0.86, 0.34, 0.86), [gx, y + 0.17, gz]);
    }
    local.add(gSteel, box(0.14, 0.14, 8.0), [gx, y + 3.2, z0 + 7.0]);
  }
  for (const gz of [z0 + 3.0, z0 + 11.0]) {
    local.add(gSteel, box(gx1 - gx0 + 0.9, 0.46, 0.46), [(gx0 + gx1) / 2, gTop, gz]);
    for (let i = 0; i < 5; i++) {
      local.add(gSteel, box(1.4, 0.12, 0.12), [gx0 + ((gx1 - gx0) / 5) * (i + 0.5), gTop - 0.42, gz], [0, 0, i % 2 ? 0.7 : -0.7]);
    }
  }
  }

  // ---------------------------------------------------------- the workshop
  const wsX0 = x0 + 4.0;
  const wsX1 = x1 - yardW - (hasYard ? 1.0 : 2.0);
  const wsW = wsX1 - wsX0;
  const wsD = parcel.depth - 9.5;
  const wsCX = (wsX0 + wsX1) / 2;
  const wsCZ = z0 + wsD / 2 + 1.2;
  // A shed stays a shed. It gains headroom as the plot grows but never turns
  // into a tower, which is what keeps the Forge reading as a working district.
  const eave = Math.max(4.6, Math.min(target * 0.62, 12.5));

  if (state === "rising") {
    // Slab, footings and a part-clad frame under a crane.
    local.add(M.concrete, box(wsW + 0.6, 0.34, wsD + 0.6), [wsCX, y + 0.1, wsCZ]);
    const bays = Math.max(3, Math.round(wsW / 3.2));
    const bayW = wsW / bays;
    for (let i = 0; i <= bays; i++) {
      const bx = wsX0 + i * bayW;
      for (const bz of [wsCZ - wsD / 2 + 0.5, wsCZ, wsCZ + wsD / 2 - 0.5]) {
        local.add(M.concreteDark, box(0.9, 0.42, 0.9), [bx, y + 0.36, bz]);
        local.add(M.steelPainted, box(0.32, eave, 0.32), [bx, y + eave / 2, bz]);
      }
      local.add(M.steelPainted, box(0.24, 0.24, wsD), [bx, y + eave, wsCZ]);
    }
    for (let i = 0; i < bays; i++) {
      const bx = wsX0 + i * bayW;
      const len = Math.hypot(bayW, 2.2);
      for (const bz of [wsCZ - wsD / 2 + 0.5, wsCZ, wsCZ + wsD / 2 - 0.5]) {
        local.add(M.steelPainted, box(len, 0.22, 0.22), [bx + bayW / 2, y + eave + 1.1, bz], [0, 0, Math.atan2(2.2, bayW)]);
      }
    }
    // Two bays clad already.
    const cladInner = new PartsBuilder();
    roofOf(cladInner, skin, "sawtooth", bayW * 2, wsD, eave, rng);
    const cladGroup = cladInner.build("clad");
    cladGroup.position.set(wsX0 + bayW, y, wsCZ);
    cladGroup.updateMatrixWorld(true);
    cladGroup.traverse((c) => {
      if (c instanceof THREE.Mesh) local.add(c.material as THREE.Material, c.geometry.clone().applyMatrix4(c.matrixWorld));
    });
    local.add(skin.body, box(bayW * 2, eave, 0.22), [wsX0 + bayW, y + eave / 2, wsCZ + wsD / 2]);

    // Tower crane. Sized to the site rather than to a constant, so it does not
    // stand twice the height of the thing it is putting up.
    const mx = wsX0 - 2.4;
    const mz = wsCZ - wsD / 2 + 3.0;
    const mastH = Math.max(7.4, target + 2.2);
    for (const [ox, oz] of [[-0.68, -0.68], [0.68, -0.68], [-0.68, 0.68], [0.68, 0.68]]) {
      local.add(M.hazard, box(0.2, mastH, 0.2), [mx + ox, y + mastH / 2, mz + oz]);
    }
    for (let i = 0; i * 2.2 + 0.8 < mastH - 1.2; i++) {
      const ly = y + 0.8 + i * 2.2;
      local.add(M.hazard, box(1.5, 0.14, 0.14), [mx, ly, mz - 0.68]);
      local.add(M.hazard, box(1.5, 0.14, 0.14), [mx, ly, mz + 0.68]);
      local.add(M.hazard, box(0.14, 0.14, 1.5), [mx - 0.68, ly, mz]);
      local.add(M.hazard, box(0.14, 0.14, 1.5), [mx + 0.68, ly, mz]);
    }
    local.add(M.concreteDark, box(3.4, 0.7, 3.4), [mx, y + 0.35, mz]);
    const jibY = y + mastH + 1.1;
    local.add(M.steel, box(1.9, 0.6, 1.9), [mx, y + mastH + 0.3, mz]);
    local.add(M.hazard, bevelBox(1.5, 1.4, 1.6, 0.14), [mx + 1.3, y + mastH + 1.2, mz]);
    local.add(M.hazard, box(17.0, 0.42, 0.42), [mx + 8.7, jibY, mz]);
    local.add(M.hazard, box(17.0, 0.14, 0.14), [mx + 8.7, jibY - 0.86, mz]);
    for (let i = 0; i < 8; i++) {
      local.add(M.hazard, box(1.8, 0.1, 0.1), [mx + 1.4 + i * 2.1, jibY - 0.44, mz], [0, 0, i % 2 ? 0.62 : -0.62]);
    }
    local.add(M.hazard, box(5.2, 0.4, 0.4), [mx - 3.0, jibY, mz]);
    local.add(M.concreteDark, box(1.6, 1.3, 2.2), [mx - 5.0, jibY - 0.2, mz]);
    local.add(M.steel, box(0.16, 3.0, 0.16), [mx, jibY + 1.6, mz]);

    // Hoist as a rig so the load swings.
    const hookLocal = new PartsBuilder();
    hookLocal.add(M.ironDark, box(0.9, 0.32, 0.7), [0, -0.4, 0]);
    hookLocal.add(M.ironDark, box(0.06, 6.0, 0.06), [0, -3.5, 0]);
    hookLocal.add(M.steel, box(2.6, 0.22, 0.5), [0, -6.7, 0]);
    hookLocal.add(M.timberPale, box(2.4, 0.5, 1.1), [0, -7.1, 0]);
    const hook = hookLocal.build("crane-hook");
    const hookWorld = toWorld(ctx, [mx + 9.5, jibY, mz]);
    hook.position.set(...hookWorld);
    ctx.rigs.push({
      group: hook,
      update: (t) => {
        hook.rotation.z = Math.sin(t * 1.1) * 0.16;
        hook.rotation.x = Math.sin(t * 0.85 + 1.1) * 0.11;
      },
    });

    // Site compound.
    for (let bx = x0 + 1; bx <= x1 - 1; bx += 2.4) {
      if (bx > x1 - 12 && bx < x1 - 4) continue;
      localProp(kit, matrix, Prop.fence, [bx, y, z1 - 0.6], 0);
    }
    for (let i = 0; i < 5; i++) localPlace(kit, matrix, "cone", [x1 - 11 + i * 1.4, y, z1 + 1.4], 0, 1.0);
    localPlace(kit, matrix, "dirtPile", [x1 - 7.5, y, z0 + 5.5], 0.4, 1.2);
    localPlace(kit, matrix, "gravelPile", [x1 - 5.0, y, z0 + 8.0], 0.2, 1.0);
    for (let i = 0; i < 6; i++) {
      localPlace(kit, matrix, "pallet", [rng.range(x1 - 10, x1 - 3), y, rng.range(z0 + 2, z0 + 12)], rng.range(0, 1.4));
    }
    const crew: Array<[number, number, Pose]> = [
      [wsX0 + 3, wsCZ + 2, "carry"],
      [wsX1 - 3, wsCZ - 3, "point"],
      [x1 - 6, z0 + 6, "stand"],
    ];
    for (const [px, pz, pose] of crew) stand(ctx, person(rng, pose, { hat: "helmet", vest: true }), [px, y, pz], rng.range(0, 6));
    walker(ctx, person(rng, "walk", { hat: "helmet", vest: true }), [x1 - 4, y, z0 + 3], [wsX0 + 2, y, z1 - 4], 3.2, 0.2);
  } else {
    // Finished shed.
    local.add(skin.body, bevelBox(wsW, eave, wsD, 0.08), [wsCX, y + eave / 2, wsCZ]);
    const shedInner = new PartsBuilder();
    shedCladding(shedInner, skin, wsW, wsD, eave, state);
    roofOf(shedInner, skin, "sawtooth", wsW, wsD, eave, rng);
    const sawGroup = shedInner.build("saw");
    sawGroup.position.set(wsCX, y, wsCZ);
    sawGroup.updateMatrixWorld(true);
    sawGroup.traverse((c) => {
      if (c instanceof THREE.Mesh) local.add(c.material as THREE.Material, c.geometry.clone().applyMatrix4(c.matrixWorld));
    });
    // Roller door onto the yard, plus a dock.
    const doorZ = z0 + 6.0;
    if (state === "struggling") {
      local.add(M.shutter, box(0.12, 4.0, 4.4), [wsX1 + 0.04, y + 2.0, doorZ]);
      for (let i = 0; i < 15; i++) local.add(M.steel, box(0.14, 0.05, 4.4), [wsX1 + 0.08, y + 0.3 + i * 0.25, doorZ]);
    } else {
      local.add(M.ironDark, box(0.3, 4.1, 4.5), [wsX1 - 0.06, y + 2.05, doorZ]);
      local.add(M.shutter, box(0.2, 0.62, 4.5), [wsX1 + 0.06, y + 3.9, doorZ]);
    }
    local.add(M.concreteDark, box(1.5, 0.95, 5.0), [wsX1 + 0.72, y + 0.48, doorZ]);
    local.add(M.hazard, box(1.55, 0.09, 0.22), [wsX1 + 0.72, y + 0.98, doorZ - 2.4]);
    local.add(skin.roof, box(2.6, 0.14, 5.6), [wsX1 + 1.4, y + 5.2, doorZ], [0, 0, -0.2]);
    // Glazed frontage to the plaza.
    local.add(M.ironDark, box(wsW * 0.5, 3.4, 0.24), [wsCX, y + 1.95, wsCZ + wsD / 2 + 0.02]);
    local.add(skin.glass, box(wsW * 0.46, 3.0, 0.08), [wsCX, y + 1.95, wsCZ + wsD / 2 + 0.1]);
    // Painted wall sign, on whichever flank is on screen. It was fixed to the
    // shed's -X wall, which on these parcels is the one turned away, so all the
    // player ever saw of it was a red plank apparently floating past the eaves.
    local.add(
      state === "healthy" ? M.accent : M.renderClayFaded,
      box(0.09, 2.2, wsD * 0.5),
      [seenFaces.includes("right") ? wsX1 + 0.05 : wsX0 - 0.05, y + Math.min(4.2, eave - 1.8), wsCZ],
    );
    // Extract stack through the sawtooth. The plume used to start in mid-air a
    // metre above the roof with nothing under it.
    const exX = wsCX - 3;
    const exZ = wsCZ - 2;
    local.add(M.steelPainted, post(0.46, 3.4, 8), [exX, y + eave + 1.5, exZ]);
    local.add(M.ironDark, post(0.58, 0.36, 8), [exX, y + eave + 3.3, exZ]);

    // ------------------------------------------------------ earned plant
    // A shed stays a shed, and capping its eave at twelve metres is what keeps
    // the district reading as workshops rather than offices. But that left the
    // last three rungs of the ladder identical apart from a taller chimney.
    // Growth shows in what the works has acquired instead.
    //
    // All of it goes on the alley side and the roof. The camera sees the shed's
    // back wall and its yard flank and nothing else, so an office added at the
    // frontage — which is where the first attempt put one — is a mass the
    // player never sees. The eaves and the sawtooth are always on screen.
    const backZ = wsCZ - wsD / 2;
    if (ctx.level >= 3) {
      // An office wing across the alley end, standing proud of the eaves so it
      // shows over the roof rather than hiding behind it. A works this size
      // gains its offices before it gains anything else.
      const aw = Math.min(wsW * 0.42, 9.5);
      const ad = 5.4;
      const ax = wsCX - wsW / 2 + aw / 2 + 0.4;
      const az = backZ + ad / 2 - 0.4;
      const ah = eave + 2.2;
      local.add(M.plaster, bevelBox(aw, ah, ad, 0.1), [ax, y + ah / 2, az]);
      local.add(M.brickDark, box(aw + 0.3, 1.1, ad + 0.3), [ax, y + 0.55, az]);
      local.add(skin.trim, box(aw + 0.44, 0.4, ad + 0.44), [ax, y + ah, az]);
      for (let f = 0; f * 3.1 + 2.4 < ah - 1.4; f++) {
        const gy = y + 2.4 + f * 3.1;
        local.add(skin.glass, box(aw * 0.86, 1.6, ad + 0.1), [ax, gy, az]);
        local.add(skin.glass, box(aw + 0.1, 1.6, ad * 0.86), [ax, gy, az]);
        local.add(skin.trim, box(aw + 0.18, 0.16, ad + 0.18), [ax, gy + 0.88, az]);
      }
      for (let i = 1; i < 3; i++) {
        local.add(skin.trim, box(0.2, ah - 1.2, ad + 0.18), [ax - aw / 2 + (aw / 3) * i, y + 1.1 + (ah - 1.2) / 2, az]);
      }
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          local.add(skin.trim, box(0.32, ah - 1.1, 0.32), [ax + (sx * aw) / 2, y + 1.1 + (ah - 1.1) / 2, az + (sz * ad) / 2]);
        }
      }
      // Staff entrance off the alley, and the name over it.
      local.add(M.ironDark, box(2.4, 2.6, 0.24), [ax, y + 1.3, az - ad / 2 - 0.02]);
      local.add(skin.glass, box(2.0, 2.2, 0.08), [ax, y + 1.25, az - ad / 2 - 0.1]);
      local.add(M.steel, box(3.8, 0.16, 1.4), [ax, y + 3.0, az - ad / 2 - 0.7]);
      local.add(state === "healthy" ? M.signLit : M.signDead, box(2.8, 0.55, 0.1), [ax, y + 3.7, az - ad / 2 - 0.06]);
      // Roofscape on the wing, since it is now the tallest flat top here.
      local.add(M.roofFelt, box(aw - 0.7, 0.14, ad - 0.7), [ax, y + ah + 0.26, az]);
      local.add(M.aluminium, bevelBox(2.0, 0.9, 1.6, 0.07), [ax + aw * 0.24, y + ah + 0.75, az]);
      local.add(M.ironDark, box(1.9, 0.12, 1.5), [ax + aw * 0.24, y + ah + 0.32, az]);
    }
    if (ctx.level >= 4) {
      // A plant deck cantilevered off the alley eaves, with the ducts running
      // down the wall. Capacity, bolted to the outside of the building, which
      // is exactly how a works acquires it.
      const dz = backZ - 1.5;
      const dw = Math.min(wsW * 0.46, 10.0);
      const dx = wsCX + wsW / 2 - dw / 2 - 0.6;
      const dy = y + eave - 1.2;
      local.add(M.ironDark, box(dw, 0.22, 2.6), [dx, dy, dz]);
      for (let i = 0; i <= 3; i++) {
        local.add(M.steel, box(0.16, 0.16, 2.2), [dx - dw / 2 + (dw / 3) * i, dy + 0.5, dz], [0.5, 0, 0]);
        local.add(M.steel, post(0.09, dy - y, 5), [dx - dw / 2 + (dw / 3) * i, (dy - y) / 2 + y, dz - 1.15]);
      }
      local.add(M.steel, box(dw, 0.06, 0.06), [dx, dy + 1.05, dz - 1.2]);
      for (const ox of [-dw * 0.26, dw * 0.26]) {
        local.add(M.aluminium, bevelBox(2.6, 1.5, 2.0, 0.08), [dx + ox, dy + 0.86, dz]);
        local.add(M.steel, box(2.2, 0.08, 1.6), [dx + ox, dy + 1.65, dz]);
        // Duct back through the wall.
        local.add(M.aluminium, post(0.42, 1.9, 8), [dx + ox, dy + 0.7, dz + 1.3], [Math.PI / 2, 0, 0]);
      }
      local.add(M.steelPainted, box(dw + 0.5, 0.3, 0.3), [dx, dy - 0.3, dz - 1.2]);
    }
    if (ctx.level >= 5) {
      // The flue: banded brick through the alley eaves, with a flashed collar
      // where it goes through. Tall enough to be the plot's landmark.
      const fx = wsCX + wsW / 2 - 3.4;
      const fz = backZ + 1.1;
      const fh = eave + 10.5;
      local.add(M.brick, post(1.05, fh, 12), [fx, y + fh / 2, fz]);
      for (let i = 1; i <= 4; i++) {
        local.add(M.brickDark, post(1.18, 0.46, 12), [fx, y + (fh / 5) * i, fz]);
      }
      local.add(M.roofZinc, post(1.5, 0.4, 12), [fx, y + eave + 1.4, fz]);
      local.add(M.steel, post(1.22, 0.7, 12), [fx, y + fh + 0.25, fz]);
      ctx.rigs.push(makeSteamVent(toWorld(ctx, [fx, y + fh + 0.9, fz]), 1.1));
      // Two silos, tight against the back wall and grouped with the flue.
      //
      // They used to stand two and a half metres clear of the building, on the
      // same centre line as the flue, which put a pair of six-metre white
      // cylinders directly in front of the only part of the shed the camera
      // can see. Plant belongs against the wall it serves, and reading as one
      // cluster with the chimney is what makes it plant rather than three
      // unrelated objects arguing over the middle of the plot.
      for (const ox of [-4.7, -2.6]) {
        const sx = fx + ox;
        local.add(M.steelPainted, post(0.95, 5.4, 12), [sx, y + 2.9, backZ - 0.85]);
        local.add(M.aluminium, new THREE.ConeGeometry(1.0, 0.9, 12), [sx, y + 6.0, backZ - 0.85]);
        local.add(M.steelPainted, new THREE.ConeGeometry(0.88, 1.1, 12), [sx, y + 0.5, backZ - 0.85], [Math.PI, 0, 0]);
        for (let i = 0; i < 3; i++) {
          local.add(M.steel, post(0.08, 1.2, 5), [sx + (i - 1) * 0.75, y + 0.6, backZ - 1.7]);
        }
      }
      // Covered conveyor from the silo heads into the flue's base.
      local.add(M.steelPainted, box(5.2, 0.8, 0.9), [fx - 3.6, y + 6.6, backZ - 0.85], [0, 0, 0.1]);
    }
  }

  // ------------------------------------------------------------ the plaza
  if (state !== "rising") {
    const px = Math.min((suX + suW / 2 + 1.6 + x1 - 1.5) / 2, x1 - 6.0);
    const pz = z1 - 3.2;
    const timber = state === "struggling" ? M.timberDark : M.timber;
    for (const ox of [-4.5, 4.5]) {
      for (const oz of [-1.8, 1.8]) local.add(M.timberDark, box(0.24, 3.3, 0.24), [px + ox, y + 1.65, pz + oz]);
      local.add(timber, box(0.2, 0.26, 4.2), [px + ox, y + 3.4, pz]);
    }
    local.add(timber, box(9.6, 0.26, 0.22), [px, y + 3.4, pz - 1.8]);
    local.add(timber, box(9.6, 0.26, 0.22), [px, y + 3.4, pz + 1.8]);
    const slats = state === "struggling" ? 5 : 11;
    for (let i = 0; i <= slats; i++) local.add(timber, box(0.12, 0.14, 3.6), [px - 4.5 + (9 / slats) * i, y + 3.56, pz]);
    if (state === "healthy") {
      for (let i = 0; i < 3; i++) {
        const dx = px - 3 + i * 3;
        local.add(M.plaster, bevelBox(1.3, 0.85, 1.3, 0.05), [dx, y + 0.43, pz - 0.4]);
        local.add(i % 2 ? M.renderTeal : M.accent, bevelBox(0.64, 0.6, 0.64, 0.12), [dx, y + 1.2, pz - 0.4]);
      }
      ctx.rigs.push(makeBanner(toWorld(ctx, [px, y + 3.2, pz + 1.9]), 8.8, 0.5, M.accent, 0.5));
    }
    localProp(kit, matrix, Prop.bench, [px - 3.4, y, pz + 2.6], 0);
    localProp(kit, matrix, Prop.bench, [px + 3.4, y, pz + 2.6], 0);
    localProp(kit, matrix, Prop.planter, [px - 5.6, y, pz + 1.0], 0);
    localProp(kit, matrix, Prop.planter, [px + 5.6, y, pz + 1.0], 0);
  }

  // ------------------------------------------------------------- the yard
  if (state === "healthy" && hasYard) {
    const dockWorld = toWorld(ctx, [x1 - 6.0, y, z0 + 6.0]);
    ctx.rigs.push(makeVan(dockWorld, toWorld(ctx, [x1 - 6.0, y, z1 + 4]), worldYaw(ctx)));
    ctx.rigs.push(
      makeForklift(toWorld(ctx, [x1 - 8.6, y, z0 + 9.0]), toWorld(ctx, [x1 - 8.6, y, z0 + 3.0]), worldYaw(ctx)),
    );
    ctx.rigs.push(makeSteamVent(toWorld(ctx, [wsCX - 3, y + eave + 3.5, wsCZ - 2]), 1.1));
    stand(ctx, person(rng, "point", { hat: "helmet", vest: true }), [x1 - 10.5, y, z0 + 5.0], 1.7);
    walker(ctx, person(rng, "walk"), [x0 + 2, y, z1 - 1.2], [x1 - 2, y, z1 - 1.2], 4.4, rng.next());
    for (let i = 0; i < 4; i++) {
      localPlace(kit, matrix, "pallet", [rng.range(x1 - 10, x1 - 3), y + (i % 2) * 0.19, rng.range(z0 + 2, z0 + 12)], rng.range(0, 1.4));
    }
    localProp(kit, matrix, Prop.crate, [x1 - 4.0, y, z0 + 3.4], 0.4);
  } else if (state === "healthy") {
    // No yard: the work happens on the street instead.
    ctx.rigs.push(makeSteamVent(toWorld(ctx, [wsCX - 3, y + eave + 3.5, wsCZ - 2]), 1.05));
    ctx.rigs.push(makeVan(toWorld(ctx, [x1 - 4.0, y, z1 - 2.0]), toWorld(ctx, [x1 + 8.0, y, z1 - 2.0]), worldYaw(ctx) + Math.PI / 2));
    walker(ctx, person(rng, "walk"), [x0 + 2, y, z1 - 1.2], [x1 - 2, y, z1 - 1.2], 4.2, rng.next());
    stand(ctx, person(rng, "carry", { vest: true }), [wsCX + 2, y, z1 - 5.2], 0.4);
    localProp(kit, matrix, Prop.crate, [x1 - 5.5, y, z0 + 3.4], 0.4);
    localPlace(kit, matrix, "pallet", [x1 - 3.0, y, z0 + 5.4], 0.5);
  } else if (state === "struggling") {
    localPlace(kit, matrix, "drum", [x1 - 4, y, z0 + 4], 0.2);
    for (let i = 0; i < 7; i++) {
      localPlace(kit, matrix, "weeds", [rng.range(x0 + 2, x1 - 2), y + 0.02, rng.range(z0 + 2, z1 - 2)], rng.range(0, 3), rng.range(0.8, 1.3));
    }
  }
}

// ---------------------------------------------------------------------------
// CREATOR QUARTER
// ---------------------------------------------------------------------------

const CREATOR_SKINS: Skin[] = [
  { body: M.renderClay, trim: M.fascia, base: M.brickDark, glass: M.glass, roof: M.roofZinc, accent: M.accent },
  { body: M.brick, trim: M.plaster, base: M.concreteDark, glass: M.glass, roof: M.roofZinc, accent: M.renderTeal },
  { body: M.renderTeal, trim: M.fascia, base: M.brickDark, glass: M.glass, roof: M.roofFelt, accent: M.accent },
  { body: M.plaster, trim: M.timberDark, base: M.brickDark, glass: M.glass, roof: M.roofZinc, accent: M.renderClay },
];

export function buildCreatorQuarter(ctx: Ctx): void {
  const { local, kit, matrix, rng, state, parcel, storeys } = ctx;
  const { x0, x1, z0, z1 } = parcelBounds(parcel);
  const y = parcel.level;
  const storeyH = STOREY_HEIGHT["creator-quarter"];

  local.add(M.plaster, box(parcel.width - 1, 0.06, parcel.depth - 1), [0, y + 0.03, 0]);

  // Where the built frontage starts on the park plot.
  //
  // Fixed at 62% of the width, the run left for building was under nine metres
  // — one bay. At the top of the ladder that bay is eight floors, so the plot
  // finished as a single twenty-four-metre shaft nine metres wide standing in
  // a garden: the least building-like thing in the city, on the plot the
  // player looks at first because it is nearest the camera.
  //
  // The terrace takes a little more of the green as it grows, which is what
  // happens to a park with a successful street on it, and gets a block rather
  // than a chimney out of the same floor area.
  const parkFront = 0.62 - Math.min(0.14, Math.max(0, storeys - 3) * 0.028);

  // ------------------------------------------------------------ the park
  if (parcel.id === "creator-park") {
    // Half the plot is public green: lawn, path, trees, seating, a bandstand.
    const lawnW = parcel.width * (parkFront - 0.02);
    const gx = x0 + lawnW / 2;
    local.add(M.grass, box(lawnW, 0.1, parcel.depth - 3), [gx, y + 0.05, 0]);
    local.add(M.sidewalk, box(lawnW, 0.06, 2.2), [gx, y + 0.1, -2]);
    local.add(M.sidewalk, box(2.2, 0.06, parcel.depth - 4), [gx + lawnW * 0.22, y + 0.1, 0]);
    for (let i = 0; i < 7; i++) {
      localProp(kit, matrix, (k, p, yw) => Prop.tree(k, p, yw, rng.range(0.95, 1.35)), [
        rng.range(x0 + 2, x0 + lawnW - 2),
        y + 0.1,
        rng.range(z0 + 2, z1 - 3),
      ], rng.range(0, 6));
    }
    for (const [bx, bz] of [[gx - 3, 2], [gx + 5, -4], [gx + 1, 5]] as const) {
      localProp(kit, matrix, Prop.bench, [bx, y + 0.1, bz], rng.range(0, 6));
    }
    // Bandstand: octagonal-ish deck, posts, conical roof.
    const sx = gx + parcel.width * 0.14;
    const sz = z0 + 5;
    local.add(M.timberPale, new THREE.CylinderGeometry(3.0, 3.2, 0.5, 8), [sx, y + 0.35, sz]);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      local.add(M.timber, post(0.11, 3.0, 6), [sx + Math.cos(a) * 2.6, y + 2.1, sz + Math.sin(a) * 2.6]);
    }
    local.add(M.roofZinc, new THREE.ConeGeometry(3.5, 1.6, 8), [sx, y + 4.4, sz]);
    local.add(M.accent, post(0.09, 1.0, 5), [sx, y + 5.5, sz]);
    if (state === "healthy") {
      stand(ctx, person(rng, "stand"), [sx - 1.2, y + 0.6, sz + 1], 2.0);
      stand(ctx, person(rng, "lean"), [gx - 2.6, y + 0.1, 2.6], 1.2);
      walker(ctx, person(rng, "walk"), [gx + 3, y + 0.16, z0 + 2], [gx + 3, y + 0.16, z1 - 3], 2.2, 0.3);
    }
  }

  // ------------------------------------------------- fine-grain live/work
  // Narrow bays, each its own skin, parapet height and roof. This grain is what
  // separates the quarter from the warehouses and the office blocks.
  const startX = parcel.id === "creator-park" ? x0 + parcel.width * parkFront : x0 + 1;
  const runW = x1 - 1 - startX;
  // Bay width grows with the plot's height. Six and a half metres is the right
  // grain for a two-storey live/work terrace and completely wrong for a
  // six-storey one: it produced 6.5m × 20m slabs, and on the park plot — where
  // the run is only fourteen metres because half the plot is lawn — the top of
  // the ladder was a pair of lone towers standing in a garden.
  const grain = 6.5 + Math.max(0, storeys - 3) * 2.2;
  // Never below two where there is frontage for two. Growing the grain alone
  // meant a twenty-two-metre run went from two bays at level four to one at
  // level five: the Quarter's whole identity is a fine-grain terrace, and
  // finishing the ladder by merging the terrace into a single block throws it
  // away exactly where the player is looking hardest.
  const bayCount = Math.max(runW > 15 ? 2 : 1, Math.round(runW / grain));
  const bayW = runW / bayCount;
  // A terrace: shop below and workshop above on the street, garden elevation
  // onto the mews yard behind, party walls to left and right.
  const seen = facesInView(worldYaw(ctx));

  for (let i = 0; i < bayCount; i++) {
    const cx = startX + bayW * (i + 0.5);
    const skin = skinFor(state, CREATOR_SKINS[(i + parcel.id.length) % CREATOR_SKINS.length]);
    // The run steps: one bay always takes the plot's full height and its
    // neighbours drop a floor or two off it, which is what gives a terrace its
    // grain instead of one long parapet line.
    const bayStoreys = i === 0 ? storeys : Math.max(1, storeys - rng.int(0, Math.min(2, storeys - 1)));
    const inner = new PartsBuilder();
    // Depth grows a little with height. A bay that is seven metres wide and
    // eleven deep is a house at two storeys and a fin at eight.
    const bayD = parcel.depth * (0.42 + Math.max(0, storeys - 4) * 0.018);
    const h = authoredBlock(inner, {
      skin,
      w: bayW - 0.5,
      d: bayD,
      storeys: bayStoreys,
      storeyH,
      bays: 2,
      // A pitch belongs on a two- or three-storey bay. Over a twenty-metre
      // block it is a house roof on an office and reads as a mistake, so above
      // that the run finishes flat and the terrace deck does the work.
      roof: bayStoreys >= 4
        ? rng.pick(["terrace", "terrace", "parapet"] as const)
        : rng.pick(["terrace", "terrace", "pitched", "parapet"] as const),
      clutter: rng.chance(0.5) ? rng.pick(["dish", "vent", "stair"] as const) : undefined,
      seen: seen.filter((face) => face === "front" || face === "back" || i === 0 || i === bayCount - 1),
      retail: ["front"],
      state,
      // Brick and windows, all the way up. A live/work bay is a warehouse
      // conversion, not a curtain wall, however many floors the business has
      // earned it.
      banding: "never",
      rng,
    });
    // Balcony on the upper floor — live/work signature.
    if (bayStoreys > 2 && state !== "struggling") {
      const front = bayD / 2;
      inner.add(M.timberPale, slab(bayW - 2.0, 0.12, 1.1, 0.03), [0, h - 3.0, front + 0.55]);
      inner.add(M.ironDark, box(bayW - 2.0, 0.06, 0.06), [0, h - 2.05, front + 1.05]);
      for (let r = 0; r <= 5; r++) {
        inner.add(M.ironDark, post(0.028, 0.9, 4), [-(bayW - 2.0) / 2 + ((bayW - 2.0) / 5) * r, h - 2.5, front + 1.05]);
      }
    }
    const group = inner.build("creator-bay");
    group.position.set(cx, y, z1 - 1.2 - bayD / 2);
    group.updateMatrixWorld(true);
    group.traverse((c) => {
      if (c instanceof THREE.Mesh) local.add(c.material as THREE.Material, c.geometry.clone().applyMatrix4(c.matrixWorld));
    });
  }

  // ------------------------------------------------------ rear mews + court
  // A live/work block is a street frontage with workshops behind it around a
  // shared yard. Without the rear range the back half of every plot was bare
  // paving, which is what made the quarter read as thin.
  if (parcel.id !== "creator-venue") {
    const mewsZ = z0 + parcel.depth * 0.15;
    const mewsD = parcel.depth * 0.26;
    const runX0 = parcel.id === "creator-park" ? x0 + parcel.width * parkFront - 0.5 : x0 + 1.5;
    const runX1 = x1 - 1.5;
    const units = Math.max(2, Math.round((runX1 - runX0) / 6));
    const unitW = (runX1 - runX0) / units;

    for (let i = 0; i < units; i++) {
      const cx = runX0 + unitW * (i + 0.5);
      const h = rng.range(3.4, 4.6);
      const body = state === "struggling" ? M.renderCreamFaded : rng.pick([M.brick, M.plaster, M.renderCream]);
      local.add(body, bevelBox(unitW - 0.4, h, mewsD, 0.08), [cx, y + h / 2, mewsZ]);
      local.add(M.concreteDark, box(unitW - 0.2, 0.4, mewsD + 0.2), [cx, y + 0.2, mewsZ]);
      // Monopitch falling to the back, with a rooflight lying in the slope. The
      // rooflight used to be level while the roof was not, so it read from
      // above as a white sticker floating off the tiles.
      const fall = -0.17;
      local.add(M.roofZinc, box(unitW - 0.1, 0.16, mewsD + 0.7), [cx, y + h + 0.42, mewsZ], [fall, 0, 0]);
      // Two rooflights in a dark kerb, rather than one warm panel.
      //
      // These used to be lit glass — emissive, at three-quarter strength, and
      // facing straight up into a camera that looks straight down. A dozen of
      // them across the quarter's mews ranges read as luminous yellow stickers
      // stuck to the tiles, and they were the brightest thing in a district
      // whose subject is the terrace in front of them.
      const lightZ = mewsD * 0.16;
      const lightY = y + h + 0.5 - Math.tan(fall) * lightZ;
      for (const ox of [-unitW * 0.19, unitW * 0.19]) {
        local.add(M.ironDark, box(unitW * 0.3, 0.12, mewsD * 0.3), [cx + ox, lightY, mewsZ + lightZ], [fall, 0, 0]);
        local.add(
          state === "struggling" ? M.glassDim : M.glass,
          box(unitW * 0.25, 0.08, mewsD * 0.25),
          [cx + ox, lightY + 0.08, mewsZ + lightZ],
          [fall, 0, 0],
        );
      }
      // Workshop door and a window onto the yard.
      const face = mewsZ + mewsD / 2 + 0.02;
      if (state === "struggling") {
        local.add(M.shutter, box(unitW * 0.44, 2.5, 0.1), [cx - unitW * 0.18, y + 1.3, face]);
      } else {
        local.add(M.ironDark, box(unitW * 0.46, 2.6, 0.22), [cx - unitW * 0.18, y + 1.35, face - 0.06]);
        local.add(M.glass, box(unitW * 0.4, 2.3, 0.07), [cx - unitW * 0.18, y + 1.3, face]);
      }
      local.add(M.brickDark, box(unitW * 0.3, 1.3, 0.18), [cx + unitW * 0.22, y + 2.3, face - 0.04]);
      local.add(M.glass, box(unitW * 0.26, 1.1, 0.07), [cx + unitW * 0.22, y + 2.3, face + 0.02]);
    }

    // The shared yard: setts, planting, bikes, a little seating.
    const yardZ = (mewsZ + mewsD / 2 + (z1 - parcel.depth * 0.45)) / 2;
    local.add(M.gravel, box(runX1 - runX0, 0.06, parcel.depth * 0.2), [
      (runX0 + runX1) / 2,
      y + 0.04,
      yardZ,
    ]);
    for (let i = 0; i < 3; i++) {
      const px = rng.range(runX0 + 1.5, runX1 - 1.5);
      localProp(kit, matrix, Prop.planter, [px, y + 0.06, yardZ + rng.range(-1.6, 1.6)], rng.range(0, 3));
    }
    if (state !== "struggling") {
      localProp(kit, matrix, (k, p, yw) => Prop.tree(k, p, yw, 0.85), [
        runX0 + 2.5,
        y + 0.06,
        yardZ,
      ], rng.range(0, 6));
      localProp(kit, matrix, Prop.bench, [runX1 - 3.0, y + 0.06, yardZ - 1.0], 1.5);
      stand(ctx, person(rng, "carry"), [(runX0 + runX1) / 2, y + 0.06, yardZ + 0.6], 0.3);
    } else {
      localPlace(kit, matrix, "drum", [runX1 - 2.5, y + 0.06, yardZ], 0.4);
    }
  }

  // ---------------------------------------------------------- small venue
  if (parcel.id === "creator-venue") {
    const vx = x0 + 6;
    const vz = z0 + 6;
    // Scaled with the plot: a venue that keeps its full fly tower on a level-one
    // lot would stand over the terrace beside it and break the skyline read.
    const vh = Math.max(4.6, Math.min(storeys * storeyH * 0.72, 11));
    const flyH = vh * 0.42;
    const flyTop = y + vh + 1.2 + flyH;
    const vw = 14;
    const vd = 12;
    local.add(M.brickDark, bevelBox(vw, vh, vd, 0.12), [vx, y + vh / 2, vz]);
    local.add(M.concreteDark, box(vw + 0.4, 0.8, vd + 0.4), [vx, y + 0.4, vz]);
    // Monopitch, falling toward the entrance. Fourteen metres by twelve of
    // unbroken zinc, seen from above at thirty-five degrees, is the single
    // largest flat colour on the plot — larger than either elevation under it.
    // A hall roof carries daylight and a ridge vent, and both of them read.
    const rise = 2.4;
    const roofD = vd + 0.6;
    local.add(M.roofZinc, wedge(vw + 0.6, rise, roofD), [vx, y + vh + rise / 2, vz]);
    const pitch = Math.atan2(rise, roofD);
    /** The slope's surface, at a distance `dz` in front of the ridge. */
    const onSlope = (dz: number) => y + vh + rise - (dz / roofD) * rise;
    for (const dz of [roofD * 0.56, roofD * 0.82]) {
      for (const ox of [-4.0, 0, 4.0]) {
        const pz = vz - roofD / 2 + dz;
        local.add(M.ironDark, box(2.9, 0.14, 1.9), [vx + ox, onSlope(dz) + 0.06, pz], [pitch, 0, 0]);
        local.add(
          state === "struggling" ? M.glassDim : M.glass,
          box(2.6, 0.1, 1.6),
          [vx + ox, onSlope(dz) + 0.16, pz],
          [pitch, 0, 0],
        );
      }
    }
    // Ridge ventilator, and the gutter the pitch drains into.
    local.add(M.roofZincWorn, box(vw - 1.0, 0.7, 1.5), [vx, y + vh + rise + 0.25, vz - roofD / 2 + 1.4]);
    local.add(M.ironDark, box(vw - 1.4, 0.42, 1.62), [vx, y + vh + rise + 0.25, vz - roofD / 2 + 1.4]);
    local.add(M.roofZinc, wedge(vw - 0.4, 0.5, 1.9), [vx, y + vh + rise + 0.82, vz - roofD / 2 + 1.4]);
    local.add(M.fascia, box(vw + 0.9, 0.3, 0.34), [vx, y + vh - 0.12, vz + roofD / 2]);

    // An auditorium has no windows, which is exactly why the two elevations the
    // camera can see were reading as an unmodelled block: fourteen metres of
    // flat brick and nothing else in the frame. What a hall this size actually
    // carries is structure — brick piers between recessed panels, a corbelled
    // band under the eaves, and the fire escape.
    for (const face of facesInView(worldYaw(ctx))) {
      const flank = face === "left" || face === "right";
      const faceW = flank ? vd : vw;
      const across = flank ? vw : vd;
      const yaw = { front: 0, right: Math.PI / 2, back: Math.PI, left: -Math.PI / 2 }[face];
      const piers = Math.max(3, Math.round(faceW / 3.4));
      const inner = new PartsBuilder();
      for (let i = 0; i <= piers; i++) {
        inner.add(M.brick, box(0.85, vh - 0.9, 0.34), [-faceW / 2 + (faceW / piers) * i, (vh - 0.9) / 2 + 0.4, across / 2 + 0.1]);
      }
      for (let i = 0; i < piers; i++) {
        // A tall recessed panel between each pair, with a lunette high up: the
        // stock elevation of every hall, chapel and drill shed ever built.
        const px = -faceW / 2 + (faceW / piers) * (i + 0.5);
        const pw = faceW / piers - 1.1;
        inner.add(M.brickDark, box(pw, vh - 2.4, 0.14), [px, (vh - 2.4) / 2 + 1.1, across / 2 + 0.06]);
        inner.add(state === "struggling" ? M.glassDim : M.glassLit, box(pw * 0.62, 0.9, 0.1), [px, vh - 1.9, across / 2 + 0.13]);
        inner.add(M.plaster, box(pw * 0.7, 0.16, 0.16), [px, vh - 1.3, across / 2 + 0.16]);
      }
      inner.add(M.plaster, box(faceW + 0.5, 0.3, 0.3), [0, vh - 0.55, across / 2 + 0.16]);
      inner.add(M.concreteDark, box(faceW + 0.4, 0.7, 0.5), [0, 0.35, across / 2 + 0.14]);
      // Escape stair on one bay, so the mass has something in front of it.
      if (!flank) {
        const sx = faceW * 0.34;
        for (const ox of [-1.1, 1.1]) inner.add(M.ironDark, post(0.1, vh - 0.6, 5), [sx + ox, (vh - 0.6) / 2, across / 2 + 1.5]);
        for (let f = 1; f * 3.2 < vh - 1.2; f++) {
          inner.add(M.ironDark, box(2.4, 0.12, 1.5), [sx, f * 3.2, across / 2 + 1.5]);
          inner.add(M.ironDark, box(2.4, 0.06, 0.06), [sx, f * 3.2 + 0.5, across / 2 + 2.2]);
        }
      }
      const group = inner.build("venue-face");
      group.rotation.y = yaw;
      group.position.set(vx, y, vz);
      group.updateMatrixWorld(true);
      group.traverse((c) => {
        if (c instanceof THREE.Mesh) local.add(c.material as THREE.Material, c.geometry.clone().applyMatrix4(c.matrixWorld));
      });
    }

    // Entrance canopy and marquee.
    local.add(M.ironDark, box(8.0, 0.3, 2.6), [vx, y + 4.4, vz + 7.2]);
    for (const ox of [-3.4, 3.4]) local.add(M.steel, post(0.08, 4.3, 6), [vx + ox, y + 2.2, vz + 8.2]);
    local.add(state === "healthy" ? M.signLit : M.signDead, box(6.4, 1.1, 0.16), [vx, y + Math.min(5.4, vh - 1.2), vz + 6.1]);
    local.add(M.timberDark, box(3.2, 3.2, 0.2), [vx, y + 1.7, vz + 6.05]);
    // Fly tower and rigging.
    //
    // It used to finish in a six-metre square of roofing felt, and at this
    // camera angle a six-metre horizontal plate in the darkest material in the
    // palette is not a roof, it is a black hole punched in the skyline above
    // the venue. It gets a zinc pitch, a ridge lantern and louvred flanks
    // instead — the things a real stage house has, and all of them lighter than
    // the brick they stand on.
    const fbx = vx - 2;
    const fbz = vz - 2;
    const fbY = y + vh + 1.2;
    local.add(M.brickDark, bevelBox(6.5, flyH, 6.5, 0.1), [fbx, fbY + flyH / 2, fbz]);
    for (let i = 1; i <= 2; i++) {
      local.add(M.brick, box(6.8, 0.3, 6.8), [fbx, fbY + (flyH / 3) * i, fbz]);
    }
    // Smoke-vent louvres high on the flanks.
    for (let i = 0; i < 3; i++) {
      const lx = fbx - 2.0 + i * 2.0;
      local.add(M.ironDark, box(1.4, 1.1, 6.72), [lx, fbY + flyH - 1.0, fbz]);
      local.add(M.steelPainted, box(1.16, 0.9, 6.76), [lx, fbY + flyH - 1.0, fbz]);
      local.add(M.ironDark, box(6.72, 1.1, 1.4), [fbx, fbY + flyH - 1.0, fbz - 2.0 + i * 2.0]);
      local.add(M.steelPainted, box(6.76, 0.9, 1.16), [fbx, fbY + flyH - 1.0, fbz - 2.0 + i * 2.0]);
    }
    local.add(M.kerb, box(6.9, 0.28, 6.9), [fbx, fbY + flyH + 0.14, fbz]);
    local.add(M.roofZinc, wedge(6.9, 1.5, 6.9), [fbx, fbY + flyH + 0.28, fbz]);
    local.add(M.roofZincWorn, box(1.5, 0.5, 6.4), [fbx, fbY + flyH + 1.6, fbz]);
    local.add(M.steel, post(0.1, 3.0, 5), [vx - 4.4, flyTop + 1.4, vz - 4.2]);
    local.add(M.steel, post(0.1, 3.0, 5), [vx + 0.4, flyTop + 1.4, vz - 4.2]);
    local.add(M.ironDark, box(5.2, 0.12, 0.12), [fbx, flyTop + 2.8, vz - 4.2]);
    if (state === "healthy") {
      for (let i = 0; i < 4; i++) {
        stand(ctx, person(rng, rng.pick(["stand", "lean", "point"] as const)), [vx - 3 + i * 2, y, vz + 9.2], rng.range(1, 5));
      }
    }
  }

  // ------------------------------------------------------- market + cafe
  if (state === "healthy" && parcel.id !== "creator-struggling") {
    const mz = z1 - 2.2;
    for (let i = 0; i < 3; i++) {
      const mx = x0 + 4 + i * 5.5;
      if (mx > x1 - 3) break;
      local.add(M.timber, post(0.08, 2.3, 5), [mx - 1.4, y + 1.15, mz - 1.0]);
      local.add(M.timber, post(0.08, 2.3, 5), [mx + 1.4, y + 1.15, mz - 1.0]);
      local.add(M.timber, post(0.08, 2.3, 5), [mx - 1.4, y + 1.15, mz + 1.0]);
      local.add(M.timber, post(0.08, 2.3, 5), [mx + 1.4, y + 1.15, mz + 1.0]);
      local.add(i % 2 ? M.canvasAwning : M.renderTeal, wedge(3.2, 0.7, 2.6), [mx, y + 2.6, mz]);
      local.add(M.timberPale, slab(3.0, 0.12, 1.1, 0.03), [mx, y + 0.9, mz - 0.4]);
      local.add(i % 2 ? M.accent : M.foliageDeep, box(2.4, 0.3, 0.7), [mx, y + 1.1, mz - 0.4]);
      stand(ctx, person(rng, "stand"), [mx, y, mz - 1.4], 0);
      if (i === 1) stand(ctx, person(rng, "point"), [mx + 1.0, y, mz + 1.6], 3.2);
    }
    walker(ctx, person(rng, "walk", { hat: "cap" }), [x1 - 1, y, z1 - 0.9], [x0 + 1, y, z1 - 0.9], 3.8, rng.next());
  }

  // -------------------------------------------- the struggling sub-lot
  if (state === "struggling") {
    for (let i = 0; i < 9; i++) {
      localPlace(kit, matrix, "weeds", [rng.range(x0 + 1, x1 - 1), y + 0.02, rng.range(z0 + 1, z1 - 1)], rng.range(0, 3), rng.range(0.8, 1.3));
    }
    // Hoarded side lot with a stalled frame.
    const sx = x0 + 3.5;
    local.add(M.concrete, box(6.0, 0.28, 8.0), [sx, y + 0.09, z0 + 5]);
    for (const ox of [-2.6, 2.6]) {
      for (const oz of [-3.4, 3.4]) local.add(M.steelRust, box(0.28, 4.2, 0.28), [sx + ox, y + 2.1, z0 + 5 + oz]);
    }
    local.add(M.steelRust, box(5.5, 0.22, 0.22), [sx, y + 4.2, z0 + 1.6]);
    local.add(M.steelRust, box(5.5, 0.22, 0.22), [sx, y + 4.2, z0 + 8.4]);
    local.add(M.tarp, box(3.6, 0.1, 6.4), [sx + 0.6, y + 4.26, z0 + 5], [0.06, 0, 0.05]);
    ctx.rigs.push(makeBanner(toWorld(ctx, [sx + 0.6, y + 4.3, z0 + 8.4]), 3.0, 0.8, M.tarp, 1.1));
    localPlace(kit, matrix, "drum", [sx - 2.0, y, z0 + 8.6], 0.3);
    // A skip left too long.
    local.add(M.steelRust, box(2.2, 1.1, 4.2), [x1 - 3.2, y + 0.55, z0 + 7]);
    local.add(M.timberDark, box(1.5, 0.5, 2.8), [x1 - 3.2, y + 1.3, z0 + 7], [0.1, 0.3, 0]);
    stand(ctx, person(rng, "lean", { hat: "cap" }), [x1 - 2, y, z1 - 1.6], 1.5);
  }
}
