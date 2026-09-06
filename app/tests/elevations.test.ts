import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { PartsBuilder } from "../src/render/lib/geom";
import { Rng } from "../src/render/lib/rng";
import { M } from "../src/render/scene/materials";
import { authoredBlock, facesInView, type Face } from "../src/render/city/districts/buildings";
import { PARCELS } from "../src/render/city/cityPlan";

/**
 * The camera sits to the +X +Z of whatever it looks at and never orbits, so
 * these are the two world directions any elevation has to face to be seen.
 */
const CAMERA = new THREE.Vector3(1, 0, 1).normalize();

const SKIN = {
  body: M.renderCream,
  trim: M.fascia,
  base: M.concreteDark,
  glass: M.glass,
  roof: M.roofZinc,
  accent: M.accent,
};

/** Every triangle a block emits, in its own local space. */
function trianglesOf(geometry: THREE.BufferGeometry): Array<[THREE.Vector3, THREE.Vector3]> {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = flat.attributes.position as THREE.BufferAttribute;
  const out: Array<[THREE.Vector3, THREE.Vector3]> = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 3) {
    a.fromBufferAttribute(position, i);
    b.fromBufferAttribute(position, i + 1);
    c.fromBufferAttribute(position, i + 2);
    const normal = new THREE.Vector3()
      .subVectors(c, b)
      .cross(new THREE.Vector3().subVectors(a, b))
      .normalize();
    out.push([a.clone().add(b).add(c).multiplyScalar(1 / 3), normal]);
  }
  return out;
}

/**
 * How much detail stands proud of the plain wall on one elevation.
 *
 * A blank elevation is one where nothing — no reveal, cill, mullion, pilaster
 * or shopfront — breaks the plane of the body. Counting outward-facing
 * triangles beyond that plane is what distinguishes "the wall is there" from
 * "there is something on the wall".
 *
 * Measured between the plinth and the eaves, because the parapet and the
 * string course wrap all four sides whatever the camera can see, and a
 * threshold that has to sit above those is a threshold measuring the roof.
 */
function reliefOn(
  block: THREE.BufferGeometry,
  outward: THREE.Vector3,
  w: number,
  d: number,
  wallTop: number,
): number {
  const half = Math.abs(outward.x) > 0.5 ? w / 2 : d / 2;
  let proud = 0;
  for (const [centre, normal] of trianglesOf(block)) {
    if (normal.dot(outward) < 0.9) continue;
    // Above the plinth, below the parapet, and standing off the wall.
    if (centre.dot(outward) > half + 0.02 && centre.y > 1.1 && centre.y < wallTop) proud++;
  }
  return proud;
}

/** Floor-to-floor used by `authoredBlock` when a caller does not say. */
const STOREY = 3.1;

function blockFor(seen: readonly Face[], w: number, d: number, storeys: number): THREE.BufferGeometry {
  const builder = new PartsBuilder();
  authoredBlock(builder, {
    skin: SKIN,
    w,
    d,
    storeys,
    bays: 4,
    roof: "parapet",
    seen,
    retail: ["front", "back"],
    state: "healthy",
    rng: new Rng("elevations"),
  });
  const merged: THREE.BufferGeometry[] = [];
  builder.build("block").traverse((child) => {
    if (child instanceof THREE.Mesh) merged.push(child.geometry);
  });
  const all = new THREE.BufferGeometry();
  const total = merged.reduce((n, g) => n + (g.attributes.position as THREE.BufferAttribute).count, 0);
  const position = new Float32Array(total * 3);
  let at = 0;
  for (const geometry of merged) {
    const source = geometry.index ? geometry.toNonIndexed() : geometry;
    position.set((source.attributes.position as THREE.BufferAttribute).array as Float32Array, at);
    at += (source.attributes.position as THREE.BufferAttribute).count * 3;
  }
  all.setAttribute("position", new THREE.BufferAttribute(position, 3));
  return all;
}

const OUTWARD: Record<Face, THREE.Vector3> = {
  front: new THREE.Vector3(0, 0, 1),
  back: new THREE.Vector3(0, 0, -1),
  left: new THREE.Vector3(-1, 0, 0),
  right: new THREE.Vector3(1, 0, 0),
};
const OUTWARD_KEYS = Object.keys(OUTWARD) as Face[];

describe("which elevations are worth building", () => {
  it("names exactly the two the fixed camera can see, whichever way the plot is turned", () => {
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const seen = facesInView(yaw);
      expect(seen).toHaveLength(2);
      for (const face of seen) {
        const world = OUTWARD[face].clone().applyEuler(new THREE.Euler(0, yaw, 0));
        expect(world.dot(CAMERA)).toBeGreaterThan(0);
      }
    }
  });

  it("agrees with every parcel the city actually lays out", () => {
    for (const parcel of PARCELS) {
      const seen = facesInView(parcel.yaw);
      expect(seen.length, parcel.id).toBe(2);
    }
  });
});

describe("an authored block", () => {
  it("puts relief on both elevations the camera can see", () => {
    // The regression: openings, pilasters and the shopfront were authored on a
    // fixed three faces regardless of how the parcel was turned. Six of the
    // eleven plots are turned to face away, so one of their two visible walls
    // was flat render from pavement to parapet.
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const seen = facesInView(yaw);
      // Punched openings below six storeys, banded glazing above.
      for (const storeys of [3, 8]) {
        const block = blockFor(seen, 12, 9, storeys);
        for (const face of seen) {
          expect(
            reliefOn(block, OUTWARD[face], 12, 9, storeys * STOREY - 0.6),
            `${face} at yaw ${yaw}, ${storeys} storeys`,
          ).toBeGreaterThan(40);
        }
      }
    }
  });

  it("does not spend triangles on the two elevations nobody can see", () => {
    const seen = facesInView(0);
    const block = blockFor(seen, 12, 9, 4);
    for (const face of OUTWARD_KEYS.filter((f) => !seen.includes(f))) {
      // Only the string course, which wraps the building anyway. Anything more
      // than that is either detail nobody will look at or, as it was, a window
      // cill on the return wall hanging past the corner of the building.
      expect(reliefOn(block, OUTWARD[face], 12, 9, 4 * STOREY - 0.6), face).toBeLessThan(6);
    }
    const four = blockFor(["front", "back", "left", "right"], 12, 9, 4);
    const count = (g: THREE.BufferGeometry) => (g.attributes.position as THREE.BufferAttribute).count;
    expect(count(block)).toBeLessThan(count(four));
  });
});
