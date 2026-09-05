import * as THREE from "three";

import { PartsBuilder } from "../lib/geom";
import { Rng } from "../lib/rng";
import { M } from "../scene/materials";
import { InstanceKit, registerProps } from "./props";
import type { Rig } from "./actors";
import { PARCELS, buildCityGround, buildSurroundings, buildTraffic, buildWaterLife } from "./cityPlan";
import { buildParcelGround, emitLocal, parcelMatrix, type Parcel } from "./parcel";
import { buildCommerceCore, buildCreatorQuarter, buildOfferForge, type Ctx } from "./districts";
import type { StateName } from "./districts/buildings";
import type { DistrictId, PublicCityProjection } from "../../city/projection";

export type District = "commerce" | "forge" | "creator";

export type LotSpec = {
  seed: number;
  district: District;
  archetype: string;
  state: StateName;
};

/**
 * The generalised lot factory.
 *
 * Same contract the block spike had, except the parcel now carries the ground
 * context instead of it being baked into the district. A lot is: parcel ground
 * appropriate to its edges, then the district program authored in local space.
 */
export function createLot(
  spec: LotSpec & { parcel: Parcel },
  kit: InstanceKit,
  target: PartsBuilder,
  rigs: Rig[],
  groundTarget: PartsBuilder = target,
): void {
  const rng = new Rng(spec.seed).fork(spec.parcel.id).fork(spec.state);
  const surface =
    spec.district === "forge" ? M.yardApron : spec.district === "creator" ? M.sidewalk : M.concrete;
  // Kept in its own bucket so silhouette mode can drop the ground without
  // dropping the buildings standing on it.
  buildParcelGround(groundTarget, kit, spec.parcel, surface);

  const local = new PartsBuilder();
  const matrix = parcelMatrix(spec.parcel);
  const ctx: Ctx = { local, kit, matrix, parcel: spec.parcel, state: spec.state, rng, rigs };

  if (spec.district === "commerce") buildCommerceCore(ctx);
  else if (spec.district === "forge") buildOfferForge(ctx);
  else buildCreatorQuarter(ctx);

  emitLocal(target, local, matrix);
}

export type City = {
  group: THREE.Group;
  update: (t: number) => void;
  stats: { parcels: number; instances: number };
};

/** Which district a parcel belongs to. */
export function districtOf(parcel: Parcel): District {
  if (parcel.id.startsWith("core")) return "commerce";
  if (parcel.id.startsWith("forge")) return "forge";
  return "creator";
}

const DISTRICT_OF_ID: Record<DistrictId, District> = {
  "commerce-core": "commerce",
  "offer-forge": "forge",
  "creator-quarter": "creator",
};

/**
 * Turns a projection into a per-parcel state plan.
 *
 * The authored parcel layout is fixed - it is the approved composition, and
 * moving buildings around per business would throw that away. What the
 * projection decides is how much of each district is actually built: the first
 * `parcels` lots in a district take its state, and the rest stand as dormant
 * ground. A smaller business gets a smaller city on the same streets.
 *
 * This replaces the spike's hard-coded DEFAULT_STATES table, including its
 * hand-placed struggling lot. A district looks like it is struggling now
 * because the projection says it is, not because a constant says so.
 */
export function statePlan(projection: PublicCityProjection): Record<string, StateName> {
  const plan: Record<string, StateName> = {};

  for (const district of projection.districts) {
    const kind = DISTRICT_OF_ID[district.id];
    const owned = PARCELS.filter((parcel) => districtOf(parcel) === kind);
    // Rotate the starting point by variant so two businesses in the same state
    // do not develop the identical corner of the district first.
    const offset = owned.length === 0 ? 0 : district.variant % owned.length;
    const built = Math.min(district.parcels, owned.length);

    for (let i = 0; i < owned.length; i++) {
      const parcel = owned[(i + offset) % owned.length];
      plan[parcel.id] = i < built ? district.state : "dormant";
    }
  }

  return plan;
}

/** A numeric generator seed from the projection's opaque hex seed. */
export function numericSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (Math.imul(hash, 31) + seed.charCodeAt(i)) >>> 0;
  // Kept well inside the safe integer range; Rng forks from it by string.
  return hash % 2_147_483_647;
}

/**
 * @param plan Overrides the projection's own development plan. The game passes
 *   the player's plots here, so what is standing in the street is what they
 *   built rather than what the reading seeded.
 */
export function buildCity(
  projection: PublicCityProjection,
  plan?: Record<string, StateName>,
): City {
  const seed = numericSeed(projection.seed);
  const states = plan ?? statePlan(projection);

  const group = new THREE.Group();
  group.name = "city";

  const kit = new InstanceKit();
  registerProps(kit);

  const rigs: Rig[] = [...buildWaterLife(), ...buildTraffic(seed)];
  const structures = new PartsBuilder();
  const parcelGround = new PartsBuilder();

  group.add(buildCityGround(kit, seed));
  group.add(buildSurroundings(seed));

  for (const parcel of PARCELS) {
    createLot(
      {
        seed,
        district: districtOf(parcel),
        archetype: parcel.id,
        state: states[parcel.id] ?? "dormant",
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
  actors.name = "actors";
  for (const rig of rigs) actors.add(rig.group);
  group.add(actors);

  // Tree canopies sway. Instanced, so the matrices are edited in place.
  // InstanceKit names its meshes "inst:<key>".
  const canopy = instances.children.find(
    (c) => c instanceof THREE.InstancedMesh && c.name === "inst:tree.canopy",
  ) as THREE.InstancedMesh | undefined;
  const canopyBase = canopy ? kit.baseMatrices("tree.canopy") : null;
  const tmp = new THREE.Matrix4();
  const sway = new THREE.Matrix4();

  return {
    group,
    stats: { parcels: PARCELS.length, instances: kit.stats().instances },
    update: (t: number) => {
      for (const rig of rigs) rig.update(t);
      if (canopy && canopyBase) {
        for (let i = 0; i < canopyBase.length; i++) {
          const phase = i * 1.37;
          sway.makeRotationZ(Math.sin(t * 0.95 + phase) * 0.085);
          tmp.multiplyMatrices(canopyBase[i], sway);
          canopy.setMatrixAt(i, tmp);
        }
        canopy.instanceMatrix.needsUpdate = true;
      }
    },
  };
}

export function disposeCity(city: City): void {
  city.group.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.InstancedMesh) {
      if (child.geometry.userData.shared) return;
      child.geometry.dispose();
    }
  });
}
