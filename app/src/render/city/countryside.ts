import * as THREE from "three";

import { PartsBuilder, box } from "../lib/geom";
import { Rng } from "../lib/rng";
import { M } from "../scene/materials";
import { type InstanceKit } from "./props";
import { ROADS, WORLD, inTown } from "./cityPlan";
import { walkwayWidth } from "./roads";

/**
 * Open country.
 *
 * The plain the city stands on has to be big enough that the camera can never
 * find its edge, and something that big is a problem of its own: four hundred
 * metres of one flat green in every direction reads as a snooker table, not as
 * land. So the distance is farmed. Hedged fields on a jittered grid, a few
 * shades apart, with woods in the corners and ponds in the hollows, thinning
 * out as they go until the fog takes them.
 *
 * All of it is one merged mesh plus the shared instanced tree, so the whole
 * horizon costs a handful of draw calls. None of it is interactive and none of
 * it is ever rebuilt — it belongs to the terrain, which is built once for the
 * life of the page.
 */

/** Field greens and stubbles, weighted so most of the country stays green. */
const CROPS = [
  M.meadow,
  M.meadow,
  M.pasture,
  M.pasture,
  M.cropGreen,
  M.cropGreen,
  M.cropYoung,
  M.fallow,
  M.stubble,
  M.ploughed,
];

/** How far out fields are laid. Past this it is fog. */
const FARMED = 470;
const CELL = 38;

/** Corridor either side of a road's centre line that stays clear. */
function roadClearance(): Array<{ axis: "x" | "z"; at: number; from: number; to: number; half: number }> {
  return ROADS.map((road) => ({
    axis: road.axis,
    at: road.at,
    from: Math.min(road.from, road.to) - 6,
    to: Math.max(road.from, road.to) + 6,
    half: road.width / 2 + walkwayWidth(road.grade) + 4,
  }));
}

/**
 * Ground that is already spoken for.
 *
 * The town itself, and the two rows of shore development on the far bank.
 * Ploughing a field through the middle of a waterfront terrace is the sort of
 * thing you only notice once, and then cannot stop noticing.
 */
const SHORE: ReadonlyArray<{ x0: number; x1: number; z0: number; z1: number }> = [
  { x0: -280, x1: 340, z0: -178, z1: -118 },
  { x0: -166, x1: -106, z0: -178, z1: 280 },
];

function isBuilt(x: number, z: number): boolean {
  return inTown(x, z) || SHORE.some((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1);
}

/** True where there is no land: the channel, and everything across it. */
function isWater(x: number, z: number): boolean {
  if (z < WORLD.northShore && z > WORLD.northFar) return true;
  if (x < WORLD.westShore && x > WORLD.westFar && z > WORLD.northFar) return true;
  return false;
}

function onRoad(x: number, z: number, pad = 0): boolean {
  for (const road of roadClearance()) {
    const across = road.axis === "x" ? z - road.at : x - road.at;
    const along = road.axis === "x" ? x : z;
    if (Math.abs(across) < road.half + pad && along > road.from && along < road.to) return true;
  }
  return false;
}

/**
 * A tree in open country.
 *
 * Uses the cheap prototype and no contact shadow. The soft disc under a prop is
 * there to seat a bollard on a pavement you are standing over; out here it buys
 * nothing and costs a transparent quad per tree.
 */
function plant(kit: InstanceKit, x: number, z: number, rng: Rng, dry = false): void {
  kit.place(
    dry ? "tree.farDry" : "tree.far",
    [x, FIELD_TOP - 0.03, z],
    rng.range(0, 6.2),
    rng.range(1.0, 1.7),
  );
}

/** Top of a ploughed field, a hair above the plain it sits on. */
const FIELD_TOP = WORLD.ground - 0.02;

export function buildCountryside(kit: InstanceKit, seed: number): THREE.Group {
  const rng = new Rng(seed).fork("countryside");
  const b = new PartsBuilder();
  const y = FIELD_TOP - 0.08;

  for (let cx = -FARMED; cx < FARMED; cx += CELL) {
    for (let cz = -FARMED; cz < FARMED; cz += CELL) {
      // Fields are irregular: each takes a random bite out of its own cell.
      const x0 = cx + rng.range(1.5, 6);
      const x1 = cx + CELL - rng.range(1.5, 6);
      const z0 = cz + rng.range(1.5, 6);
      const z1 = cz + CELL - rng.range(1.5, 6);
      const midX = (x0 + x1) / 2;
      const midZ = (z0 + z1) / 2;

      if (isWater(midX, midZ) || isWater(x0, z0) || isWater(x1, z1)) continue;
      if (isBuilt(midX, midZ) || isBuilt(x0, z0) || isBuilt(x1, z1)) continue;
      if (onRoad(midX, midZ, 2)) continue;
      // Thin out with distance, so the near country is worked and the far
      // country is open grass the fog can swallow without a seam.
      const far = Math.hypot(midX, midZ) / FARMED;
      if (rng.chance(far * 0.5)) continue;

      const crop = rng.pick(CROPS);
      b.add(crop, box(x1 - x0, 0.16, z1 - z0), [midX, y, midZ]);

      // Hedge along two sides only, so a shared boundary is one hedge.
      if (rng.chance(0.78)) hedge(b, kit, rng, x0, z0, x1, z0);
      if (rng.chance(0.78)) hedge(b, kit, rng, x0, z0, x0, z1);

      if (rng.chance(0.16)) pond(b, rng, midX, midZ, Math.min(x1 - x0, z1 - z0));
      // Woods thin out with distance too: the far ones are a smudge in the fog
      // and there is no sense paying for them.
      if (rng.chance(0.22 * (1 - far * 0.7))) copse(kit, rng, x0 + 3, z0 + 3, x1 - 3, z1 - 3);
      if (rng.chance(0.1)) barn(b, rng, midX, midZ);
    }
  }

  return b.build("countryside", true, true);
}

/** A hedgerow, with the odd tree grown out of it. */
function hedge(
  b: PartsBuilder,
  kit: InstanceKit,
  rng: Rng,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
): void {
  const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
  const length = alongX ? x1 - x0 : z1 - z0;
  if (length < 6) return;
  const thickness = rng.range(1.1, 1.9);
  const height = rng.range(1.1, 1.9);
  b.add(
    rng.chance(0.25) ? M.foliageDry : M.foliageDeep,
    box(alongX ? length : thickness, height, alongX ? thickness : length),
    [(x0 + x1) / 2, WORLD.ground + height / 2 - 0.1, (z0 + z1) / 2],
  );
  const trees = Math.floor(length / 26);
  for (let i = 0; i < trees; i++) {
    if (!rng.chance(0.45)) continue;
    const t = rng.range(0.15, 0.85);
    plant(kit, alongX ? x0 + t * length : x0, alongX ? z0 : z0 + t * length, rng);
  }
}

/** A wood, or the corner of one. */
function copse(kit: InstanceKit, rng: Rng, x0: number, z0: number, x1: number, z1: number): void {
  const count = Math.floor(rng.range(5, 14));
  for (let i = 0; i < count; i++) {
    plant(kit, rng.range(x0, x1), rng.range(z0, z1), rng, rng.chance(0.2));
  }
}

/** Standing water in a field, with a muddy margin. */
function pond(b: PartsBuilder, rng: Rng, x: number, z: number, room: number): void {
  const w = rng.range(6, Math.max(8, room * 0.4));
  const d = rng.range(5, Math.max(7, room * 0.35));
  b.add(M.dirt, box(w + 2.4, 0.14, d + 2.4), [x, FIELD_TOP - 0.05, z]);
  b.add(M.water, box(w, 0.1, d), [x, FIELD_TOP - 0.14, z]);
}

/** A farm building, so the fields look worked rather than decorative. */
function barn(b: PartsBuilder, rng: Rng, x: number, z: number): void {
  const w = rng.range(7, 13);
  const d = rng.range(5, 9);
  const h = rng.range(3.2, 5);
  const yaw = rng.chance(0.5) ? 0 : Math.PI / 2;
  const inner = new PartsBuilder();
  inner.add(rng.pick([M.timberDark, M.steelRust, M.plaster]), box(w, h, d), [0, h / 2, 0]);
  inner.add(M.roofZinc, box(w + 0.8, 0.5, d + 0.8), [0, h + 0.2, 0]);
  inner.add(M.dirtDry, box(w + 7, 0.12, d + 7), [0, 0.02, 0]);
  const group = inner.build("barn");
  group.position.set(x, FIELD_TOP, z);
  group.rotation.y = yaw;
  group.updateMatrixWorld(true);
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      b.add(child.material as THREE.Material, child.geometry.clone().applyMatrix4(child.matrixWorld));
    }
  });
}
