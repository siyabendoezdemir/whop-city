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
import { authoredBlock, roofOf, shopfront, skinFor, type Skin, type StateName } from "./buildings";

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
};

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
  const { local, rng, state, parcel } = ctx;
  const { x0, x1, z0, z1 } = parcelBounds(parcel);
  const y = parcel.level;
  const skin = skinFor(state, CORE_SKIN);
  const landmark = parcel.id === "core-landmark";

  local.add(M.plaster, box(parcel.width - 1, 0.06, parcel.depth - 1), [0, y + 0.03, 0]);

  if (landmark) {
    // The civic silhouette: a setback tower with a crown, on a retail podium.
    const podiumH = 7.2;
    local.add(skin.body, bevelBox(parcel.width - 2, podiumH, parcel.depth - 2, 0.12), [0, y + podiumH / 2, 0]);
    local.add(M.concreteDark, box(parcel.width - 1.6, 0.8, parcel.depth - 1.6), [0, y + 0.4, 0]);
    local.add(skin.trim, box(parcel.width - 1.4, 0.4, parcel.depth - 1.4), [0, y + podiumH, 0]);
    for (let i = 0; i < 4; i++) {
      local.add(skin.glass, box(parcel.width - 4, 1.5, parcel.depth - 1.6), [0, y + 3.6 + i * 0, 0]);
    }
    shopfront(local, skin, parcel.width - 6, z1 - 1.0, state);

    // Tower: three diminishing stages with a lantern.
    let base = y + podiumH;
    const stages: Array<[number, number, number]> = [
      [13, 11, 13.5],
      [10.5, 9, 11],
      [8, 7, 8.5],
    ];
    for (const [w, d, h] of stages) {
      local.add(skin.body, bevelBox(w, h, d, 0.12), [0, base + h / 2, -1.2]);
      local.add(skin.trim, box(w + 0.5, 0.5, d + 0.5), [0, base + h, -1.2]);
      const floors = Math.floor(h / 3.1);
      for (let f = 0; f < floors; f++) {
        const yy = base + 1.7 + f * 3.1;
        if (yy > base + h - 1.1) break;
        local.add(skin.glass, box(w * 0.86, 1.7, d + 0.08), [0, yy, -1.2]);
        local.add(skin.glass, box(w + 0.08, 1.7, d * 0.86), [0, yy, -1.2]);
        local.add(skin.trim, box(w + 0.12, 0.14, d + 0.12), [0, yy + 0.92, -1.2]);
      }
      for (let i = 0; i <= 4; i++) {
        local.add(skin.trim, box(0.18, h - 0.4, d + 0.14), [-w / 2 + (w / 4) * i, base + h / 2, -1.2]);
      }
      base += h;
    }
    // Crown: stepped cap, mast and a beacon.
    local.add(skin.trim, box(6.6, 0.7, 7.0), [0, base + 0.35, -1.2]);
    local.add(skin.body, bevelBox(4.4, 2.4, 4.8, 0.14), [0, base + 1.6, -1.2]);
    local.add(skin.roof, wedge(4.8, 1.5, 5.2), [0, base + 3.5, -1.2]);
    local.add(M.steel, post(0.14, 5.0, 6), [0, base + 6.5, -1.2]);
    local.add(state === "healthy" ? M.signLit : M.signDead, box(0.5, 0.5, 0.5), [0, base + 9.1, -1.2]);
    return;
  }

  // Perimeter commercial blocks: deep, glazed, with retail at grade.
  const slots = Math.max(2, Math.round(parcel.width / 13));
  const slotW = (parcel.width - 2) / slots;
  for (let i = 0; i < slots; i++) {
    const cx = x0 + 1 + slotW * (i + 0.5);
    const inner = new PartsBuilder();
    const storeys = rng.int(4, 8);
    authoredBlock(inner, {
      skin: skinFor(state, CORE_SKINS[(i + parcel.id.length * 2) % CORE_SKINS.length]),
      w: slotW - 1.0,
      d: parcel.depth - 4,
      storeys,
      bays: rng.int(3, 5),
      roof: rng.pick(["parapet", "stepped", "monitor"] as const),
      clutter: rng.pick(["plant", "tank", "stair", "vent"] as const),
      shopfront: true,
      state,
      glazedBands: rng.chance(0.55),
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
    if (landmark) ctx.rigs.push(makeSteamVent(toWorld(ctx, [x0 + 5, y + 9, -2]), 1.3));
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
  const { local, kit, matrix, rng, state, parcel } = ctx;
  const { x0, x1, z0, z1 } = parcelBounds(parcel);
  const y = parcel.level;
  const skin = skinFor(state, FORGE_SKINS[parcel.id] ?? FORGE_SKINS["forge-hero"]);
  const hero = parcel.id === "forge-hero";

  local.add(M.yardApron, box(parcel.width - 1, 0.05, parcel.depth - 1), [0, y + 0.025, 0]);

  // ------------------------------------------------------ persistent spine
  // Brick street unit at the frontage.
  const suW = Math.min(9.5, parcel.width * 0.32);
  const suX = x0 + suW / 2 + 0.8;
  const suH = 9.2;
  local.add(M.brick, bevelBox(suW, suH, 6.2, 0.09), [suX, y + suH / 2, z1 - 3.4]);
  local.add(M.concreteDark, box(suW + 0.2, 0.55, 6.4), [suX, y + 0.28, z1 - 3.4]);
  local.add(M.brickDark, box(suW + 0.34, 0.44, 6.5), [suX, y + suH + 0.22, z1 - 3.4]);
  local.add(M.fascia, box(suW + 0.46, 0.16, 6.6), [suX, y + suH + 0.5, z1 - 3.4]);
  local.add(M.roofFelt, box(suW - 0.2, 0.14, 6.0), [suX, y + suH + 0.08, z1 - 3.4]);
  shopfront(local, skin, suW, z1 - 0.28, state);
  for (let f = 0; f < 2; f++) {
    for (let i = 0; i < 3; i++) {
      const wx = suX - suW / 2 + 1.5 + i * ((suW - 3) / 2);
      const wy = y + 5.0 + f * 2.7;
      local.add(M.brickDark, box(1.35, 1.85, 0.2), [wx, wy, z1 - 0.36]);
      local.add(skin.glass, box(1.15, 1.65, 0.07), [wx, wy, z1 - 0.28]);
      local.add(M.fascia, box(0.07, 1.65, 0.11), [wx, wy, z1 - 0.25]);
      local.add(M.kerb, slab(1.55, 0.12, 0.28, 0.03), [wx, wy - 1.0, z1 - 0.2]);
    }
  }
  // Painted gable sign, the maker equivalent of downtown's lit fascia.
  local.add(state === "healthy" ? M.accent : M.renderClayFaded, box(0.08, 2.4, 4.6), [
    suX - suW / 2 - 0.05,
    y + 5.6,
    z1 - 3.4,
  ]);

  // How the plot is divided. The approved block was 34m wide and could afford a
  // full loading yard behind a gantry; a 22m plot cannot, and forcing one on it
  // squeezed the workshop down to a shed. Yard width is therefore earned by
  // frontage, and the workshop takes whatever is left.
  const hasYard = parcel.width >= 28;
  const yardW = hasYard ? 11.5 : 0;

  // Vent stack — the landmark in flat black.
  const vsX = x0 + 1.8;
  const vsH = hero ? 12.4 : 8.6;
  local.add(M.brick, bevelBox(1.5, vsH, 1.5, 0.07), [vsX, y + vsH / 2, z0 + 2.4]);
  for (let i = 1; i <= 3; i++) local.add(M.brickDark, box(1.62, 0.3, 1.62), [vsX, y + i * (vsH / 4), z0 + 2.4]);
  local.add(M.brickDark, box(1.86, 0.55, 1.86), [vsX, y + vsH - 0.2, z0 + 2.4]);
  local.add(M.steel, post(0.42, 0.9, 8), [vsX, y + vsH + 0.6, z0 + 2.4]);

  // Yard gantry, only where there is a yard to serve.
  const gx0 = x1 - 10.5;
  const gx1 = x1 - 1.6;
  if (hasYard) {
  const gTop = y + 8.2;
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
  const eave = 8.4;

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

    // Tower crane.
    const mx = wsX0 - 2.4;
    const mz = wsCZ - wsD / 2 + 3.0;
    const mastH = 15.5;
    for (const [ox, oz] of [[-0.68, -0.68], [0.68, -0.68], [-0.68, 0.68], [0.68, 0.68]]) {
      local.add(M.hazard, box(0.2, mastH, 0.2), [mx + ox, y + mastH / 2, mz + oz]);
    }
    for (let i = 0; i < 7; i++) {
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
    local.add(M.concreteDark, box(wsW + 0.2, 0.62, wsD + 0.2), [wsCX, y + 0.31, wsCZ]);
    const sawInner = new PartsBuilder();
    roofOf(sawInner, skin, "sawtooth", wsW, wsD, eave, rng);
    const sawGroup = sawInner.build("saw");
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
    // Painted wall sign.
    local.add(state === "healthy" ? M.accent : M.renderClayFaded, box(0.09, 2.2, wsD * 0.5), [wsX0 - 0.05, y + 4.2, wsCZ]);
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
    ctx.rigs.push(makeSteamVent(toWorld(ctx, [wsCX - 3, y + eave + 0.8, wsCZ - 2]), 1.25));
    stand(ctx, person(rng, "point", { hat: "helmet", vest: true }), [x1 - 10.5, y, z0 + 5.0], 1.7);
    walker(ctx, person(rng, "walk"), [x0 + 2, y, z1 - 1.2], [x1 - 2, y, z1 - 1.2], 4.4, rng.next());
    for (let i = 0; i < 4; i++) {
      localPlace(kit, matrix, "pallet", [rng.range(x1 - 10, x1 - 3), y + (i % 2) * 0.19, rng.range(z0 + 2, z0 + 12)], rng.range(0, 1.4));
    }
    localProp(kit, matrix, Prop.crate, [x1 - 4.0, y, z0 + 3.4], 0.4);
  } else if (state === "healthy") {
    // No yard: the work happens on the street instead.
    ctx.rigs.push(makeSteamVent(toWorld(ctx, [wsCX - 2, y + eave + 0.8, wsCZ - 2]), 1.15));
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
  const { local, kit, matrix, rng, state, parcel } = ctx;
  const { x0, x1, z0, z1 } = parcelBounds(parcel);
  const y = parcel.level;

  local.add(M.plaster, box(parcel.width - 1, 0.06, parcel.depth - 1), [0, y + 0.03, 0]);

  // ------------------------------------------------------------ the park
  if (parcel.id === "creator-park") {
    // Half the plot is public green: lawn, path, trees, seating, a bandstand.
    const gx = x0 + parcel.width * 0.32;
    local.add(M.grass, box(parcel.width * 0.6, 0.1, parcel.depth - 3), [gx, y + 0.05, 0]);
    local.add(M.sidewalk, box(parcel.width * 0.6, 0.06, 2.2), [gx, y + 0.1, -2]);
    local.add(M.sidewalk, box(2.2, 0.06, parcel.depth - 4), [gx + 3, y + 0.1, 0]);
    for (let i = 0; i < 7; i++) {
      localProp(kit, matrix, (k, p, yw) => Prop.tree(k, p, yw, rng.range(0.95, 1.35)), [
        rng.range(x0 + 2, gx + parcel.width * 0.26),
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
  const startX = parcel.id === "creator-park" ? x0 + parcel.width * 0.62 : x0 + 1;
  const runW = x1 - 1 - startX;
  const bayCount = Math.max(2, Math.round(runW / 6.5));
  const bayW = runW / bayCount;

  for (let i = 0; i < bayCount; i++) {
    const cx = startX + bayW * (i + 0.5);
    const skin = skinFor(state, CREATOR_SKINS[(i + parcel.id.length) % CREATOR_SKINS.length]);
    const storeys = rng.int(2, 3);
    const inner = new PartsBuilder();
    const h = authoredBlock(inner, {
      skin,
      w: bayW - 0.5,
      d: parcel.depth * 0.42,
      storeys,
      storeyH: 3.0,
      bays: 2,
      roof: rng.pick(["terrace", "terrace", "pitched", "parapet"] as const),
      clutter: rng.chance(0.5) ? rng.pick(["dish", "vent", "stair"] as const) : undefined,
      shopfront: true,
      state,
      rng,
    });
    // Balcony on the upper floor — live/work signature.
    if (storeys > 2 && state !== "struggling") {
      inner.add(M.timberPale, slab(bayW - 2.0, 0.12, 1.1, 0.03), [0, h - 3.0, parcel.depth * 0.21 + 0.55]);
      inner.add(M.ironDark, box(bayW - 2.0, 0.06, 0.06), [0, h - 2.05, parcel.depth * 0.21 + 1.05]);
      for (let r = 0; r <= 5; r++) {
        inner.add(M.ironDark, post(0.028, 0.9, 4), [-(bayW - 2.0) / 2 + ((bayW - 2.0) / 5) * r, h - 2.5, parcel.depth * 0.21 + 1.05]);
      }
    }
    const group = inner.build("creator-bay");
    group.position.set(cx, y, z1 - parcel.depth * 0.24);
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
    const runX0 = parcel.id === "creator-park" ? x0 + parcel.width * 0.58 : x0 + 1.5;
    const runX1 = x1 - 1.5;
    const units = Math.max(2, Math.round((runX1 - runX0) / 6));
    const unitW = (runX1 - runX0) / units;

    for (let i = 0; i < units; i++) {
      const cx = runX0 + unitW * (i + 0.5);
      const h = rng.range(3.4, 4.6);
      const body = state === "struggling" ? M.renderCreamFaded : rng.pick([M.brick, M.plaster, M.renderCream]);
      local.add(body, bevelBox(unitW - 0.4, h, mewsD, 0.08), [cx, y + h / 2, mewsZ]);
      local.add(M.concreteDark, box(unitW - 0.2, 0.4, mewsD + 0.2), [cx, y + 0.2, mewsZ]);
      // Monopitch falling to the back, with a rooflight.
      local.add(M.roofZinc, box(unitW - 0.1, 0.16, mewsD + 0.7), [cx, y + h + 0.42, mewsZ], [-0.17, 0, 0]);
      local.add(M.glassLit, box(unitW * 0.42, 0.1, mewsD * 0.34), [cx, y + h + 0.5, mewsZ + mewsD * 0.16]);
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
    local.add(M.brickDark, bevelBox(14, 8.5, 12, 0.12), [vx, y + 4.25, vz]);
    local.add(M.concreteDark, box(14.4, 0.8, 12.4), [vx, y + 0.4, vz]);
    local.add(M.roofZinc, wedge(14.6, 2.4, 12.6), [vx, y + 9.7, vz]);
    // Entrance canopy and marquee.
    local.add(M.ironDark, box(8.0, 0.3, 2.6), [vx, y + 4.4, vz + 7.2]);
    for (const ox of [-3.4, 3.4]) local.add(M.steel, post(0.08, 4.3, 6), [vx + ox, y + 2.2, vz + 8.2]);
    local.add(state === "healthy" ? M.signLit : M.signDead, box(6.4, 1.1, 0.16), [vx, y + 5.4, vz + 6.1]);
    local.add(M.timberDark, box(3.2, 3.2, 0.2), [vx, y + 1.7, vz + 6.05]);
    // Fly tower and rigging.
    local.add(M.brickDark, bevelBox(6.5, 3.5, 6.5, 0.1), [vx - 2, y + 10.2, vz - 2]);
    local.add(M.steel, post(0.1, 3.0, 5), [vx - 4.4, y + 13.4, vz - 4.2]);
    local.add(M.steel, post(0.1, 3.0, 5), [vx + 0.4, y + 13.4, vz - 4.2]);
    local.add(M.ironDark, box(5.2, 0.12, 0.12), [vx - 2, y + 14.8, vz - 4.2]);
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
