import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { PartsBuilder, bevelBox, box, post, slab, wedge } from "../src/render/lib/geom";

function centre(geometry: THREE.BufferGeometry): THREE.Vector3 {
  geometry.computeBoundingBox();
  return geometry.boundingBox!.getCenter(new THREE.Vector3());
}

function size(geometry: THREE.BufferGeometry): THREE.Vector3 {
  geometry.computeBoundingBox();
  return geometry.boundingBox!.getSize(new THREE.Vector3());
}

/**
 * Runs a part through the two-stage path every district builder uses: author
 * into an inner builder, position the built group, then bake its meshes into an
 * outer builder. That is how a commercial block is composed and how a parcel is
 * placed in the world, and it is where a placement can go missing.
 */
function compose(geometry: THREE.BufferGeometry, at: THREE.Vector3): THREE.BufferGeometry {
  const material = new THREE.MeshStandardMaterial();
  const inner = new PartsBuilder();
  inner.add(material, geometry, [0, at.y, 0]);

  const group = inner.build("inner");
  group.position.set(at.x, 0, at.z);
  group.updateMatrixWorld(true);

  const outer = new PartsBuilder();
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      outer.add(child.material as THREE.Material, child.geometry.clone().applyMatrix4(child.matrixWorld));
    }
  });

  let out: THREE.BufferGeometry | null = null;
  outer.build("outer").traverse((child) => {
    if (child instanceof THREE.Mesh) out = child.geometry;
  });
  return out!;
}

describe("geometry kit", () => {
  it("gives every primitive the size it was asked for", () => {
    const cases: Array<[THREE.BufferGeometry, [number, number, number]]> = [
      [bevelBox(6.83, 12, 10.92, 0.1), [6.83, 12, 10.92]],
      [box(4, 2.5, 9), [4, 2.5, 9]],
      [wedge(6, 2, 7), [6, 2, 7]],
      [slab(3, 0.2, 1.4), [3, 0.2, 1.4]],
    ];
    for (const [geometry, want] of cases) {
      const got = size(geometry);
      expect([got.x, got.y, got.z].map((n) => Number(n.toFixed(3)))).toEqual(want);
    }
  });

  it("keeps the placement when a composed part is baked into another builder", () => {
    // The regression this exists for: the flattened-geometry cache used to hang
    // off `userData`, which `BufferGeometry.copy` shares by reference. Every
    // placed copy therefore still pointed at the untransformed prototype, and
    // re-adding one returned the prototype instead. Bevelled masses and
    // extruded roofs — the whole body of every building — piled up at the world
    // origin, leaving their windows and trim standing on an empty plot.
    const at = new THREE.Vector3(100, 6, 50);
    for (const geometry of [bevelBox(6.83, 12, 10.92, 0.1), wedge(6, 2, 7), post(0.4, 3), box(2, 2, 2)]) {
      const composed = compose(geometry, at);
      const got = centre(composed);
      expect(got.x).toBeCloseTo(at.x, 5);
      expect(got.y).toBeCloseTo(at.y, 5);
      expect(got.z).toBeCloseTo(at.z, 5);
    }
  });

  it("does not let one placement move another", () => {
    const material = new THREE.MeshStandardMaterial();
    const builder = new PartsBuilder();
    builder.add(material, bevelBox(4, 4, 4, 0.1), [0, 0, 0]);
    builder.add(material, bevelBox(4, 4, 4, 0.1), [30, 0, 0]);

    let merged: THREE.BufferGeometry | null = null;
    builder.build("pair").traverse((child) => {
      if (child instanceof THREE.Mesh) merged = child.geometry;
    });
    // Two boxes 30 apart span 34, not 4: a shared buffer would collapse them.
    expect(size(merged!).x).toBeCloseTo(34, 5);
  });
});
