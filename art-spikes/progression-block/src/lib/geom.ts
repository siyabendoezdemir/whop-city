import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * Geometry kit.
 *
 * Two ideas carry most of the visual weight here.
 *
 * First, nothing is a raw BoxGeometry. Every mass is a rounded box, so edges
 * catch a highlight and the world reads as moulded rather than extruded. It is
 * one line of difference per object and it is most of the gap between "cubes"
 * and "toy model".
 *
 * Second, buildings are authored as many small parts and then merged per
 * material. A workshop is forty pieces in source and two draw calls on screen.
 */

export type Vec3 = [number, number, number];

/** Rounded box, centred on its own origin. Segments stay low; this is chunky by design. */
export function bevelBox(w: number, h: number, d: number, radius = 0.05): THREE.BufferGeometry {
  const r = Math.min(radius, w / 2.05, h / 2.05, d / 2.05);
  return new RoundedBoxGeometry(w, h, d, 2, r);
}

/** Plain box for parts that are hidden or never catch a silhouette edge. */
export function box(w: number, h: number, d: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d);
}

/** Right-angle wedge: the profile behind every pitched and sawtooth roof. */
export function wedge(w: number, h: number, d: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-d / 2, -h / 2);
  shape.lineTo(d / 2, -h / 2);
  shape.lineTo(-d / 2, h / 2);
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
  geometry.rotateY(Math.PI / 2);
  geometry.translate(-w / 2, 0, 0);
  geometry.computeVertexNormals();
  return geometry;
}

/** Chamfered slab used for kerbs, steps, plinths and retaining copings. */
export function slab(w: number, h: number, d: number, chamfer = 0.03): THREE.BufferGeometry {
  return bevelBox(w, h, d, chamfer);
}

/** Thin cylinder: bollards, posts, pipes, tree trunks. */
export function post(radius: number, height: number, sides = 8): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(radius, radius * 1.06, height, sides, 1);
}

/** Faceted blob for foliage. Flat-shaded, so it reads as carved rather than smooth. */
export function blob(radius: number, detail = 0): THREE.BufferGeometry {
  return new THREE.IcosahedronGeometry(radius, detail);
}

/**
 * Normalises a geometry so anything can merge with anything.
 *
 * `ExtrudeGeometry` comes back non-indexed while the primitives are indexed,
 * and `mergeGeometries` refuses to mix the two — silently dropping parts. Every
 * piece is flattened to non-indexed with exactly position/normal/uv, which
 * costs some vertices and buys a merge that always succeeds.
 */
function normalise(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  for (const name of Object.keys(flat.attributes)) {
    if (name !== "position" && name !== "normal" && name !== "uv") flat.deleteAttribute(name);
  }
  if (!flat.getAttribute("normal")) flat.computeVertexNormals();
  if (!flat.getAttribute("uv")) {
    const count = flat.getAttribute("position").count;
    flat.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  }
  flat.morphAttributes = {};
  flat.clearGroups();
  return flat;
}

export function transform(
  geometry: THREE.BufferGeometry,
  position: Vec3,
  rotation: Vec3 = [0, 0, 0],
  scale: Vec3 = [1, 1, 1],
): THREE.BufferGeometry {
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    new THREE.Vector3(...scale),
  );
  return normalise(geometry).applyMatrix4(matrix);
}

/**
 * Collects authored parts and emits one merged mesh per material.
 *
 * Keeping the draw-call count near the material count is what makes a scene
 * with this much small detail viable in a browser.
 */
export class PartsBuilder {
  private readonly buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();

  add(
    material: THREE.Material,
    geometry: THREE.BufferGeometry,
    position: Vec3 = [0, 0, 0],
    rotation: Vec3 = [0, 0, 0],
    scale: Vec3 = [1, 1, 1],
  ): this {
    const placed = transform(geometry, position, rotation, scale);
    const bucket = this.buckets.get(material);
    if (bucket) bucket.push(placed);
    else this.buckets.set(material, [placed]);
    return this;
  }

  /** Repeats one part along a line — window bays, balusters, roof ribs, fence panels. */
  repeat(
    material: THREE.Material,
    geometry: THREE.BufferGeometry,
    count: number,
    start: Vec3,
    step: Vec3,
    rotation: Vec3 = [0, 0, 0],
  ): this {
    for (let i = 0; i < count; i++) {
      this.add(
        material,
        geometry,
        [start[0] + step[0] * i, start[1] + step[1] * i, start[2] + step[2] * i],
        rotation,
      );
    }
    return this;
  }

  build(name: string, castShadow = true, receiveShadow = true): THREE.Group {
    const group = new THREE.Group();
    group.name = name;

    for (const [material, geometries] of this.buckets) {
      if (geometries.length === 0) continue;
      const merged = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries, false);
      if (!merged) {
        // Dropping parts silently is how a building loses a roof, so this is
        // loud rather than a skipped iteration.
        throw new Error(`PartsBuilder: merge failed for ${name} (${geometries.length} parts)`);
      }
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      group.add(mesh);
    }
    return group;
  }
}

/**
 * A soft dark ellipse laid just above the ground.
 *
 * The shadow map handles the sun, but small props at this scale still read as
 * hovering without an explicit contact darkening underneath them. One shared
 * radial texture, one material, instanced across the whole block.
 */
export function contactShadowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(24,26,32,0.55)");
  gradient.addColorStop(0.55, "rgba(24,26,32,0.26)");
  gradient.addColorStop(1, "rgba(24,26,32,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Randomised-but-deterministic jitter helper for prop scatter. */
export function jitter(base: number, amount: number, r: number): number {
  return base + (r * 2 - 1) * amount;
}
