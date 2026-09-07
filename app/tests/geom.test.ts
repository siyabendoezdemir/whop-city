import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { PartsBuilder, bevelBox, box, post, slab, wedge } from "../src/render/lib/geom";
import { waterOffset, waterSheenOffset } from "../src/render/scene/materials";

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

  it("stands a wedge's ridge at +z and its eaves at -z", () => {
    // Which way a wedge slopes is not a detail: it decides where the ridge cap,
    // the gutter, the chimney and the rooflights go on every pitched roof in
    // the city. Three roofs were built against the opposite assumption — the
    // Creator Venue's hall, the terrace bays, and the whole low surrounding
    // row — and each one hung its ridge capping in the air over the eaves and
    // buried its gutter in the wall at the ridge.
    //
    // The orientation is a consequence of an extrusion and a rotateY, which is
    // to say it is not readable from the call site. Asserted here so it stays
    // true, and so changing it fails loudly rather than quietly rebuilding
    // fifty roofs back to front.
    const geometry = wedge(4, 2, 10);
    const position = geometry.getAttribute("position");
    let tallEnd = -Infinity;
    let thinEnd = -Infinity;
    for (let i = 0; i < position.count; i++) {
      if (position.getZ(i) > 4.9) tallEnd = Math.max(tallEnd, position.getY(i));
      if (position.getZ(i) < -4.9) thinEnd = Math.max(thinEnd, position.getY(i));
    }
    expect(tallEnd).toBeCloseTo(1, 5);
    expect(thinEnd).toBeCloseTo(-1, 5);
  });

  it("drifts the water across its bands rather than along them", () => {
    // The bay is the largest single surface in the frame and the only large one
    // with nothing on it that moves, so it scrolls its ripple map. The catch is
    // that `waterRipples` draws its streaks as full-width bands along `u`: drift
    // the map in `u` and every streak slides along its own length, leaving the
    // water visibly, measurably, provably still. The first version did exactly
    // that and moved the texture five metres to no effect whatsoever.
    //
    // No screenshot catches this — the frames differ, they just differ in a way
    // no eye reads as motion — so the axes are pinned here instead.
    const [u, v] = waterOffset(10);
    expect(Math.abs(v)).toBeGreaterThan(Math.abs(u) * 3);

    // Linear in `t`, so a still captured at a given clock is that same still
    // every time. The film and the plot sheets depend on it.
    const [u2, v2] = waterOffset(20);
    expect(u2).toBeCloseTo(u * 2, 10);
    expect(v2).toBeCloseTo(v * 2, 10);
    expect(waterOffset(0)).toEqual([0, 0]);

    // A tile is about forty-four metres. Slower than this and twelve seconds of
    // film shows nothing; faster and a calm bay turns into a conveyor belt.
    const metresPerSecond = (v / 10) * 44.4;
    expect(metresPerSecond).toBeGreaterThan(0.25);
    expect(metresPerSecond).toBeLessThan(1.2);

    // The shimmer has to disagree with the swell. One map can only slide, and
    // a second one following it at the same rate is just a thicker first one:
    // it is the difference between the two that stops the bay moving all of a
    // piece. Crossing it, and slower.
    const [su, sv] = waterSheenOffset(10);
    expect(Math.sign(su)).toBe(-Math.sign(u));
    expect(Math.abs(sv)).toBeLessThan(Math.abs(v));
    expect(Math.abs(sv - v)).toBeGreaterThan(Math.abs(v) * 0.15);
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
