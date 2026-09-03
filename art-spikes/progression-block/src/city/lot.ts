import * as THREE from "three";

import { InstanceKit, registerProps } from "./props";
import { buildCreek, buildGround, buildNeighbours } from "./ground";
import { buildOfferForge, type LotState } from "./districts/offerForge";

export type { LotState };

export type District = "offer-forge";
export type Archetype = "maker-block";

export type LotSpec = {
  seed: number;
  district: District;
  archetype: Archetype;
  state: LotState;
};

/**
 * District registry.
 *
 * A second district is a new entry here plus one builder module. It reuses the
 * ground system, the prop kit, the material palette, the camera and the state
 * vocabulary unchanged — the only district-specific code is which structures
 * get authored and which props get scattered per state.
 */
const BUILDERS: Record<
  District,
  Record<Archetype, (kit: InstanceKit, state: LotState, seed: number) => THREE.Group>
> = {
  "offer-forge": {
    "maker-block": buildOfferForge,
  },
};

export type Lot = {
  group: THREE.Group;
  spec: LotSpec;
  stats: { prototypes: number; instances: number };
};

/**
 * Builds the whole scene content for one lot in one state.
 *
 * Everything is rebuilt per state rather than toggled, which is the honest way
 * to do this: a state is a different set of structures on the same ground, not
 * the same structures with different settings.
 */
export function createLot(spec: LotSpec): Lot {
  const group = new THREE.Group();
  group.name = `lot:${spec.district}:${spec.archetype}:${spec.state}`;

  const kit = new InstanceKit();
  registerProps(kit);

  // Ground and neighbours are seeded independently of state, so the place is
  // identical across all four frames.
  group.add(buildGround(kit, spec.seed));
  group.add(buildCreek(kit, spec.seed));
  group.add(buildNeighbours(spec.seed));

  const builder = BUILDERS[spec.district][spec.archetype];
  group.add(builder(kit, spec.state, spec.seed));

  // Instanced props are built last, once every pass has placed its matrices.
  group.add(kit.build(`props:${spec.state}`));

  return { group, spec, stats: kit.stats() };
}

/** Frees GPU resources when a state is swapped out. */
export function disposeLot(lot: Lot): void {
  lot.group.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.InstancedMesh) {
      child.geometry.dispose();
    }
  });
}
