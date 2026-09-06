import * as THREE from "three";

import { PartsBuilder } from "../lib/geom";
import { Rng } from "../lib/rng";
import { M } from "../scene/materials";
import { InstanceKit, registerProps } from "./props";
import type { Rig } from "./actors";
import {
  PARCELS,
  buildCityGround,
  buildPedestrians,
  buildSurroundings,
  buildTraffic,
  buildWaterLife,
} from "./cityPlan";
import { buildCountryside } from "./countryside";
import { buildParcelGround, emitLocal, parcelMatrix, type Parcel } from "./parcel";
import {
  buildCommerceCore,
  buildCreatorQuarter,
  buildOfferForge,
  buildVacantLot,
  type Ctx,
} from "./districts";
import type { StateName } from "./districts/buildings";
import { stateOfLevel, storeysFor } from "../../game/plots";
import type { PublicCityProjection } from "../../city/projection";

export type District = "commerce" | "forge" | "creator";

export type LotSpec = {
  seed: number;
  district: District;
  archetype: string;
  state: StateName;
  /** 0..5. Nought builds a vacant site instead of a building. */
  level: number;
};

/**
 * The generalised lot factory.
 *
 * Same contract the block spike had, except the parcel now carries the ground
 * context instead of it being baked into the district. A lot is: parcel ground
 * appropriate to its edges, then the district program authored in local space.
 *
 * @returns the world-space height of the tallest thing built here.
 */
export function createLot(
  spec: LotSpec & { parcel: Parcel },
  kit: InstanceKit,
  target: PartsBuilder,
  rigs: Rig[],
  groundTarget: PartsBuilder = target,
): number {
  const rng = new Rng(spec.seed).fork(spec.parcel.id).fork(spec.state);
  const surface =
    spec.district === "forge" ? M.yardApron : spec.district === "creator" ? M.sidewalk : M.concrete;
  // Kept in its own bucket so silhouette mode can drop the ground without
  // dropping the buildings standing on it.
  buildParcelGround(groundTarget, kit, spec.parcel, surface);

  const local = new PartsBuilder();
  const matrix = parcelMatrix(spec.parcel);
  const ctx: Ctx = {
    local,
    kit,
    matrix,
    parcel: spec.parcel,
    state: spec.state,
    rng,
    rigs,
    level: spec.level,
    storeys: storeysFor(spec.parcel.id, spec.level),
  };

  if (spec.level <= 0) buildVacantLot(ctx);
  else if (spec.district === "commerce") buildCommerceCore(ctx);
  else if (spec.district === "forge") buildOfferForge(ctx);
  else buildCreatorQuarter(ctx);

  return emitLocal(target, local, matrix);
}

export type City = {
  group: THREE.Group;
  update: (t: number) => void;
  stats: { parcels: number; instances: number };
  /** The top of what stands on each plot, in world units. */
  tops: Record<string, number>;
  dispose: () => void;
};

/**
 * The half of the world that never changes.
 *
 * Terrain, both bays, the road network, the surrounding massing, the traffic
 * and the ferry. None of it depends on what the player has built, and it is
 * most of the geometry in the scene — so it is built once for the life of the
 * page and levelling a building does not touch it.
 *
 * Splitting this out is what makes an upgrade instant. Rebuilding the whole
 * city on every level change meant re-merging every road, every kerb and every
 * far-bank block to change the height of one tower, and the frame it cost was
 * plainly visible.
 */
export type Terrain = {
  group: THREE.Group;
  update: (t: number) => void;
  dispose: () => void;
};

/** The half that does change: the eleven plots and everything standing on them. */
export type Lots = {
  group: THREE.Group;
  tops: Record<string, number>;
  update: (t: number) => void;
  stats: { parcels: number; instances: number };
  dispose: () => void;
};

/**
 * Tree canopies sway. Instanced, so the matrices are edited in place.
 * `InstanceKit` names its meshes `inst:<key>`.
 */
function swayer(instances: THREE.Group, kit: InstanceKit): (t: number) => void {
  const canopy = instances.children.find(
    (child) => child instanceof THREE.InstancedMesh && child.name === "inst:tree.canopy",
  ) as THREE.InstancedMesh | undefined;
  const base = canopy ? kit.baseMatrices("tree.canopy") : null;
  if (!canopy || !base) return () => undefined;

  const tmp = new THREE.Matrix4();
  const sway = new THREE.Matrix4();
  return (t: number) => {
    for (let i = 0; i < base.length; i++) {
      sway.makeRotationZ(Math.sin(t * 0.95 + i * 1.37) * 0.085);
      tmp.multiplyMatrices(base[i], sway);
      canopy.setMatrixAt(i, tmp);
    }
    canopy.instanceMatrix.needsUpdate = true;
  };
}

function disposeGroup(group: THREE.Group): void {
  group.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.InstancedMesh) {
      if (child.geometry.userData.shared) return;
      child.geometry.dispose();
    }
  });
}

export function buildTerrain(seedText: string): Terrain {
  const seed = numericSeed(seedText);
  const group = new THREE.Group();
  group.name = "terrain";

  const kit = new InstanceKit();
  registerProps(kit);

  const rigs: Rig[] = [...buildWaterLife(), ...buildTraffic(seed), ...buildPedestrians(seed)];

  group.add(buildCountryside(kit, seed));
  group.add(buildCityGround(kit, seed));
  group.add(buildSurroundings(seed));

  const instances = kit.build("terrain-props");
  group.add(instances);

  const actors = new THREE.Group();
  actors.name = "actors";
  for (const rig of rigs) actors.add(rig.group);
  group.add(actors);

  const sway = swayer(instances, kit);

  return {
    group,
    update: (t) => {
      for (const rig of rigs) rig.update(t);
      sway(t);
    },
    dispose: () => disposeGroup(group),
  };
}

export function buildLots(seedText: string, levels: Readonly<Record<string, number>>): Lots {
  const seed = numericSeed(seedText);
  const level = (id: string) => Math.max(0, Math.round(levels[id] ?? 0));

  const group = new THREE.Group();
  group.name = "lots";

  const kit = new InstanceKit();
  registerProps(kit);

  const rigs: Rig[] = [];
  const structures = new PartsBuilder();
  const parcelGround = new PartsBuilder();

  const tops: Record<string, number> = {};
  for (const parcel of PARCELS) {
    tops[parcel.id] = createLot(
      {
        seed,
        district: districtOf(parcel),
        archetype: parcel.id,
        state: stateOfLevel(level(parcel.id)),
        level: level(parcel.id),
        parcel,
      },
      kit,
      structures,
      rigs,
      parcelGround,
    );
  }

  const ground = parcelGround.build("parcel-ground", false, true);
  ground.name = "parcel-ground";
  group.add(ground);

  const built = structures.build("structures", true, true);
  built.name = "structures";
  group.add(built);

  const instances = kit.build();
  instances.name = "props";
  group.add(instances);

  const actors = new THREE.Group();
  actors.name = "lot-actors";
  for (const rig of rigs) actors.add(rig.group);
  group.add(actors);

  const sway = swayer(instances, kit);

  return {
    group,
    tops,
    stats: { parcels: PARCELS.length, instances: kit.stats().instances },
    update: (t) => {
      for (const rig of rigs) rig.update(t);
      sway(t);
    },
    dispose: () => disposeGroup(group),
  };
}

/** Which district a parcel belongs to. */
export function districtOf(parcel: Parcel): District {
  if (parcel.id.startsWith("core")) return "commerce";
  if (parcel.id.startsWith("forge")) return "forge";
  return "creator";
}

/** A numeric generator seed from the projection's opaque hex seed. */
export function numericSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (Math.imul(hash, 31) + seed.charCodeAt(i)) >>> 0;
  // Kept well inside the safe integer range; Rng forks from it by string.
  return hash % 2_147_483_647;
}

/**
 * Terrain and lots in one group.
 *
 * The whole world, for anything that wants it in a single object: the capture
 * harness, the leak check, the renderer-budget measurement. The viewport keeps
 * the two halves apart instead, so it can rebuild one without the other.
 *
 * @param levels What the player has actually built, plot by plot. A brand new
 *   city is all zeroes and stands as vacant ground; the skyline is something
 *   the business earns rather than something the renderer hands over.
 */
export function buildCity(
  projection: PublicCityProjection,
  levels: Readonly<Record<string, number>> = {},
): City {
  const terrain = buildTerrain(projection.seed);
  const lots = buildLots(projection.seed, levels);

  const group = new THREE.Group();
  group.name = "city";
  group.add(terrain.group, lots.group);

  return {
    group,
    tops: lots.tops,
    stats: lots.stats,
    update: (t: number) => {
      terrain.update(t);
      lots.update(t);
    },
    dispose: () => {
      terrain.dispose();
      lots.dispose();
    },
  };
}

export function disposeCity(city: City): void {
  city.dispose();
}
