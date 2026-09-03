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
): void {
  const rng = new Rng(spec.seed).fork(spec.parcel.id).fork(spec.state);
  const surface =
    spec.district === "forge" ? M.yardApron : spec.district === "creator" ? M.sidewalk : M.concrete;
  buildParcelGround(target, kit, spec.parcel, surface);

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

/** Which district a parcel belongs to, and how it is doing. */
export function districtOf(parcel: Parcel): District {
  if (parcel.id.startsWith("core")) return "commerce";
  if (parcel.id.startsWith("forge")) return "forge";
  return "creator";
}

/**
 * Default state configuration for the visual proof.
 *
 * Commerce Core healthy, Offer Forge rising, Creator Quarter healthy but
 * quieter, and exactly one struggling sub-lot so poor health is legible as a
 * real place going wrong rather than the whole city being switched off.
 */
export const DEFAULT_STATES: Record<string, StateName> = {
  "forge-hero": "rising",
  "forge-north": "healthy",
  "forge-south": "healthy",
  "core-north": "healthy",
  "core-landmark": "healthy",
  "core-east": "healthy",
  "core-southeast": "healthy",
  "creator-park": "healthy",
  "creator-terrace": "healthy",
  "creator-venue": "healthy",
  "creator-struggling": "struggling",
};

export function buildCity(seed = 20260903, states: Record<string, StateName> = DEFAULT_STATES): City {
  const group = new THREE.Group();
  group.name = "city";

  const kit = new InstanceKit();
  registerProps(kit);

  const rigs: Rig[] = [...buildWaterLife(), ...buildTraffic(seed)];
  const structures = new PartsBuilder();

  group.add(buildCityGround(kit, seed));
  group.add(buildSurroundings(seed));

  for (const parcel of PARCELS) {
    createLot(
      {
        seed,
        district: districtOf(parcel),
        archetype: parcel.id,
        state: states[parcel.id] ?? "healthy",
        parcel,
      },
      kit,
      structures,
      rigs,
    );
  }

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
  const canopy = instances.children.find(
    (c) => c instanceof THREE.InstancedMesh && c.name === "tree.canopy",
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
          sway.makeRotationZ(Math.sin(t * 0.85 + phase) * 0.035);
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
