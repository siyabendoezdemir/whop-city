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
    if (name !== "position" && name !== "normal" && name !== "uv" && name !== "color") {
      flat.deleteAttribute(name);
    }
  }
  if (!flat.getAttribute("normal")) flat.computeVertexNormals();
  const count = flat.getAttribute("position").count;
  if (!flat.getAttribute("uv")) {
    flat.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  }
  // Materials run with vertexColors on, so every geometry needs the attribute
  // even if nothing has baked occlusion into it yet.
  if (!flat.getAttribute("color")) {
    flat.setAttribute("color", new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3));
  }
  flat.morphAttributes = {};
  flat.clearGroups();
  return flat;
}

/**
 * Projects UVs from world position, choosing a plane per vertex from its
 * dominant normal axis.
 *
 * Primitives arrive with their own 0..1 UVs per face, which means a grain
 * texture would stretch differently on a kerb than on a warehouse wall. Baking
 * from world space gives one constant texel density across the whole block, so
 * a single fine-grain texture works everywhere.
 */
export function bakeWorldUv(geometry: THREE.BufferGeometry, scale = 0.5): void {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  if (!position || !normal) return;

  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const nx = Math.abs(normal.getX(i));
    const ny = Math.abs(normal.getY(i));
    const nz = Math.abs(normal.getZ(i));

    let u: number;
    let v: number;
    if (ny >= nx && ny >= nz) {
      u = x;
      v = z; // floors, roofs, pavements
    } else if (nx >= nz) {
      u = z;
      v = y; // walls facing along X
    } else {
      u = x;
      v = y; // walls facing along Z
    }
    uv[i * 2] = u * scale;
    uv[i * 2 + 1] = v * scale;
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

/**
 * Bakes soft occlusion into vertex colours.
 *
 * Cheap and approximate, but it does the one thing a shadow map cannot: darken
 * the last half-metre where an object meets the ground, and the undersides of
 * everything. That is what stops objects reading as cut-outs pasted on top of
 * the pavement. It also carries a slight per-surface value drift so large flat
 * masses are not one uniform tone.
 */
export function bakeVertexAo(
  geometry: THREE.BufferGeometry,
  options: { groundY?: number; reach?: number; floor?: number } = {},
): void {
  const groundY = options.groundY ?? 0;
  const reach = options.reach ?? 1.15;
  const floor = options.floor ?? 0.6;

  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  if (!position) return;

  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const height = position.getY(i) - groundY;
    // Smoothstep up from the ground.
    const t = Math.min(1, Math.max(0, height / reach));
    let shade = floor + (1 - floor) * (t * t * (3 - 2 * t));

    if (normal) {
      const ny = normal.getY(i);
      if (ny < -0.25) shade *= 0.78; // soffits and undersides
      else if (ny > 0.75) shade *= 1.03; // sun-facing tops lift slightly
    }

    shade = Math.min(1.06, shade);
    colors[i * 3] = shade;
    colors[i * 3 + 1] = shade;
    colors[i * 3 + 2] = shade;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
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
      // Everything the builder emits is already in world space, so both bakes
      // can run once, here, on the merged result.
      bakeWorldUv(merged, 0.5);
      bakeVertexAo(merged);
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      group.add(mesh);
    }
    return group;
  }

  /**
   * Merge everything into a single mesh under one shared material, folding each
   * part's material colour into its vertex colours.
   *
   * Used for the small movers — people, vehicles, machinery. A figure built the
   * normal way costs one draw call per material it uses, which at twenty-odd
   * animated actors was more than the entire rest of the city put together. The
   * roughness and metalness differences between, say, a jacket and a boot are
   * not resolvable at this camera distance, so trading them for a single call
   * per actor is free visually and decisive for the budget.
   */
  buildSingle(
    name: string,
    material: THREE.Material,
    castShadow = true,
    receiveShadow = false,
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    const tinted: THREE.BufferGeometry[] = [];

    for (const [source, geometries] of this.buckets) {
      const colour =
        source instanceof THREE.MeshStandardMaterial || source instanceof THREE.MeshBasicMaterial
          ? source.color
          : new THREE.Color(0xffffff);
      for (const geometry of geometries) {
        const attribute = geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
        if (attribute) {
          for (let i = 0; i < attribute.count; i++) {
            attribute.setXYZ(
              i,
              attribute.getX(i) * colour.r,
              attribute.getY(i) * colour.g,
              attribute.getZ(i) * colour.b,
            );
          }
          attribute.needsUpdate = true;
        }
        tinted.push(geometry);
      }
    }

    if (tinted.length === 0) return group;
    const merged = tinted.length === 1 ? tinted[0] : mergeGeometries(tinted, false);
    if (!merged) throw new Error(`PartsBuilder: single-mesh merge failed for ${name}`);
    bakeWorldUv(merged, 0.5);
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    group.add(mesh);
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
