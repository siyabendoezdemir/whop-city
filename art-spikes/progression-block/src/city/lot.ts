import * as THREE from "three";

import { InstanceKit, registerProps } from "./props";
import { buildCreek, buildGround, buildNeighbours } from "./ground";
import { buildAuthoredNeighbours } from "./neighbours";
import { M } from "../scene/materials";
import { buildOfferForge, type LotState } from "./districts/offerForge";
import type { Rig } from "./actors";

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
 * ground system, the prop kit, the material palette, the camera, the actor kit
 * and the state vocabulary unchanged.
 */
const BUILDERS: Record<
  District,
  Record<Archetype, (kit: InstanceKit, state: LotState, seed: number) => { group: THREE.Group; rigs: Rig[] }>
> = {
  "offer-forge": {
    "maker-block": buildOfferForge,
  },
};

export type Lot = {
  group: THREE.Group;
  spec: LotSpec;
  stats: { prototypes: number; instances: number };
  /** Called once per frame with seconds elapsed inside this state's dwell. */
  update: (t: number) => void;
};

export function createLot(spec: LotSpec): Lot {
  const group = new THREE.Group();
  group.name = `lot:${spec.district}:${spec.archetype}:${spec.state}`;

  const kit = new InstanceKit();
  registerProps(kit);

  // Ground and neighbours are seeded independently of state, so the place is
  // identical across all four frames.
  group.add(buildGround(kit, spec.seed));
  group.add(buildCreek(kit, spec.seed));
  group.add(buildAuthoredNeighbours(kit, spec.seed));
  group.add(buildNeighbours(spec.seed));

  const builder = BUILDERS[spec.district][spec.archetype];
  const { group: district, rigs } = builder(kit, spec.state, spec.seed);
  group.add(district);

  // Instanced props are built last, once every pass has placed its matrices.
  const props = kit.build(`props:${spec.state}`);
  group.add(props);

  // ------------------------------------------------------------- tree sway
  // Canopies are instanced, so they are animated by rewriting their matrices
  // rather than by transforming an object. Trunks stay put; only the crown
  // moves, which is what reads as wind at this distance.
  const canopySway: Array<{ mesh: THREE.InstancedMesh; base: THREE.Matrix4[] }> = [];
  for (const key of ["tree.canopy", "tree.canopyDry"]) {
    const mesh = props.getObjectByName(`inst:${key}`) as THREE.InstancedMesh | undefined;
    const base = kit.baseMatrices(key);
    if (mesh && base.length > 0) canopySway.push({ mesh, base: base.map((m) => m.clone()) });
  }

  // ------------------------------------------------------------ tidal creek
  // The channel is the single largest surface in frame. Scrolling its ripple
  // map is the cheapest way to make the whole image read as a live scene rather
  // than a render, and it costs one texture offset per frame.
  const waterMap = (M.water as THREE.MeshStandardMaterial).map ?? null;

  const scratch = new THREE.Matrix4();
  const tilt = new THREE.Matrix4();

  return {
    group,
    spec,
    stats: kit.stats(),
    update: (t) => {
      for (const rig of rigs) rig.update(t);

      if (waterMap) {
        // UVs are baked in world space at half a unit per metre, so the ripple
        // tile is about two metres across. The scroll has to be fast in UV
        // terms to read as moving water at this camera distance.
        waterMap.offset.set(t * 0.05, t * 0.13);
      }

      for (const { mesh, base } of canopySway) {
        for (let i = 0; i < base.length; i++) {
          // Each tree gets its own phase from its index, so the row does not
          // sway in lockstep.
          const phase = i * 1.37;
          const angle = Math.sin(t * 1.25 + phase) * 0.16 + Math.sin(t * 2.6 + phase) * 0.05;
          tilt.makeRotationZ(angle);
          // Pre-multiply: the crown leans about the world-up through its own
          // base, which is what a tree does. Post-multiplying just spun it.
          scratch.multiplyMatrices(base[i], tilt);
          mesh.setMatrixAt(i, scratch);
        }
        mesh.instanceMatrix.needsUpdate = true;
      }
    },
  };
}

/**
 * Frees GPU resources when a state is swapped out.
 *
 * Materials are not touched: they all come from the shared palette and outlive
 * every lot. Geometry flagged `shared` is skipped for the same reason.
 */
export function disposeLot(lot: Lot): void {
  lot.group.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.InstancedMesh) {
      if (child.geometry.userData.shared) return;
      child.geometry.dispose();
    }
  });
}
