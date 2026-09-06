import * as THREE from "three";

import { PartsBuilder, box, slab } from "../lib/geom";
import { Rng } from "../lib/rng";
import { M } from "../scene/materials";
import { Prop, type InstanceKit } from "./props";

/**
 * Parcels.
 *
 * The block spike hard-coded one street to the south and one creek to the
 * north. That does not generalise to a city, so a parcel now declares what
 * bounds each of its four edges and the ground system responds: a street edge
 * gets a kerb, footway, tree pits and a threshold; a water edge gets a retaining
 * wall and a quay; an alley gets a rough service strip; a neighbour edge gets a
 * party wall and nothing else.
 *
 * District builders author in the parcel's local space — origin at the centre,
 * frontage facing +Z — and the parcel transform puts them in the world. That is
 * what lets the same Offer Forge geometry sit on a waterfront service lane here
 * and on a plain street somewhere else.
 */

export type EdgeKind = "street" | "boulevard" | "alley" | "water" | "neighbour" | "park";

export type ParcelEdges = {
  front: EdgeKind;
  back: EdgeKind;
  left: EdgeKind;
  right: EdgeKind;
};

export type Parcel = {
  id: string;
  centre: { x: number; z: number };
  width: number;
  depth: number;
  /** Yaw about Y. 0 means the frontage looks toward +Z. */
  yaw: number;
  edges: ParcelEdges;
  /** Finished floor level of the parcel surface. */
  level: number;
};

export const KERB_H = 0.15;

/** Local-space helpers a district builder uses to stay inside its plot. */
export function parcelBounds(parcel: Parcel) {
  return {
    x0: -parcel.width / 2,
    x1: parcel.width / 2,
    z0: -parcel.depth / 2,
    z1: parcel.depth / 2,
  };
}

/** World transform for a parcel's local space. */
export function parcelMatrix(parcel: Parcel): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(parcel.centre.x, 0, parcel.centre.z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, parcel.yaw, 0)),
    new THREE.Vector3(1, 1, 1),
  );
}

/**
 * Bakes a locally-authored builder into a world-space one.
 *
 * Returns the highest point of what was emitted. That number is not decoration:
 * the attention marker that floats over a plot is placed from it, so the marker
 * clears the actual roof rather than a height somebody predicted. Predicting it
 * is what made markers sit inside chimneys and behind fly towers.
 */
export function emitLocal(target: PartsBuilder, local: PartsBuilder, matrix: THREE.Matrix4): number {
  const group = local.build("local");
  group.applyMatrix4(matrix);
  group.updateMatrixWorld(true);
  let top = Number.NEGATIVE_INFINITY;
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const placed = child.geometry.clone().applyMatrix4(child.matrixWorld);
      placed.computeBoundingBox();
      if (placed.boundingBox) top = Math.max(top, placed.boundingBox.max.y);
      target.add(child.material as THREE.Material, placed);
    }
  });
  return Number.isFinite(top) ? top : 0;
}

/** Places an instanced prop given in parcel-local coordinates. */
export function localPlace(
  kit: InstanceKit,
  matrix: THREE.Matrix4,
  key: string,
  local: [number, number, number],
  yaw = 0,
  scale: number | [number, number, number] = 1,
): void {
  const p = new THREE.Vector3(...local).applyMatrix4(matrix);
  const worldYaw = Math.atan2(matrix.elements[8], matrix.elements[10]);
  kit.place(key, [p.x, p.y, p.z], yaw + worldYaw, scale);
}

/** Same, for the compound prop helpers. */
export function localProp(
  kit: InstanceKit,
  matrix: THREE.Matrix4,
  fn: (kit: InstanceKit, position: [number, number, number], yaw?: number) => void,
  local: [number, number, number],
  yaw = 0,
): void {
  const p = new THREE.Vector3(...local).applyMatrix4(matrix);
  const worldYaw = Math.atan2(matrix.elements[8], matrix.elements[10]);
  fn(kit, [p.x, p.y, p.z], yaw + worldYaw);
}

/**
 * The parcel's own ground: surface, edge treatments and boundary furniture.
 *
 * Authored in local space and emitted through the parcel transform, so the same
 * code produces a waterfront plot and an inland one.
 */
export function buildParcelGround(
  target: PartsBuilder,
  kit: InstanceKit,
  parcel: Parcel,
  surface: THREE.Material = M.concrete,
): void {
  const local = new PartsBuilder();
  const matrix = parcelMatrix(parcel);
  const { x0, x1, z0, z1 } = parcelBounds(parcel);
  const rng = new Rng(`${parcel.id}:ground`);
  const y = parcel.level;

  // The plot surface itself, slightly proud of the footway.
  local.add(surface, box(parcel.width, 0.24, parcel.depth), [0, y - 0.12, 0]);

  const edges: Array<[keyof ParcelEdges, number, number, number, number, number]> = [
    // kind, centre x, centre z, length, orientation (0 = runs along X), outward sign
    ["front", 0, z1, parcel.width, 0, 1],
    ["back", 0, z0, parcel.width, 0, -1],
    ["left", x0, 0, parcel.depth, 1, -1],
    ["right", x1, 0, parcel.depth, 1, 1],
  ];

  for (const [key, cx, cz, length, alongZ, outward] of edges) {
    const kind = parcel.edges[key];
    const nx = alongZ ? outward : 0;
    const nz = alongZ ? 0 : outward;
    const sizeX = alongZ ? 0.34 : length;
    const sizeZ = alongZ ? length : 0.34;

    if (kind === "street" || kind === "boulevard") {
      // Threshold kerb, then the footway belongs to the street network.
      local.add(M.kerb, box(sizeX, 0.16, sizeZ), [cx + nx * 0.17, y - 0.04, cz + nz * 0.17]);
      // A shallow step up into the plot reads as a real property line.
      local.add(M.concreteDark, box(alongZ ? 0.2 : length - 1.2, 0.1, alongZ ? length - 1.2 : 0.2), [
        cx - nx * 0.4,
        y + 0.02,
        cz - nz * 0.4,
      ]);
    } else if (kind === "alley") {
      local.add(M.concreteDark, box(alongZ ? 0.5 : length, 0.1, alongZ ? length : 0.5), [
        cx + nx * 0.25,
        y - 0.03,
        cz + nz * 0.25,
      ]);
    } else if (kind === "water") {
      // Retaining wall and coping down to the quay.
      const drop = 1.5;
      local.add(M.concreteDark, box(alongZ ? 0.7 : length + 0.6, drop, alongZ ? length + 0.6 : 0.7), [
        cx + nx * 0.35,
        y - drop / 2,
        cz + nz * 0.35,
      ]);
      local.add(M.kerb, slab(alongZ ? 0.95 : length + 0.9, 0.16, alongZ ? length + 0.9 : 0.95, 0.04), [
        cx + nx * 0.35,
        y + 0.07,
        cz + nz * 0.35,
      ]);
      const count = Math.max(2, Math.floor(length / 7));
      for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / count - 0.5;
        localPlace(
          kit,
          matrix,
          "bollard",
          [cx + nx * 0.9 + (alongZ ? 0 : t * length), y, cz + nz * 0.9 + (alongZ ? t * length : 0)],
          0,
          1.2,
        );
      }
    } else if (kind === "park") {
      local.add(M.grass, box(alongZ ? 1.6 : length, 0.1, alongZ ? length : 1.6), [
        cx + nx * 0.8,
        y - 0.02,
        cz + nz * 0.8,
      ]);
    } else {
      // Neighbour: a party wall, blind.
      local.add(M.brickDark, box(alongZ ? 0.35 : length, 3.4, alongZ ? length : 0.35), [
        cx + nx * 0.17,
        y + 1.7,
        cz + nz * 0.17,
      ]);
    }
  }

  // A little planting wherever two soft edges meet, so corners are not bare.
  if (parcel.edges.front === "street" || parcel.edges.front === "boulevard") {
    const spots = Math.max(1, Math.floor(parcel.width / 9));
    for (let i = 0; i < spots; i++) {
      const t = (i + 0.5) / spots - 0.5;
      if (rng.chance(0.55)) {
        localProp(kit, matrix, Prop.planter, [t * parcel.width, y, z1 - 1.1], rng.range(0, 3));
      }
    }
  }

  emitLocal(target, local, matrix);
}
