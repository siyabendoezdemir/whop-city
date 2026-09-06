import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { bakeVertexAo, bevelBox, blob, box, post, slab, transform, wedge, type Vec3 } from "../lib/geom";
import { M } from "../scene/materials";
import { contactShadow } from "../scene/textures";

/**
 * Instanced prop kit.
 *
 * Anything that appears more than a couple of times is defined once as a
 * prototype and then placed by matrix, so a hundred cones cost one draw call.
 * Multi-material props register one prototype per material and are placed with
 * a shared matrix, which keeps a tree a single call to `placeTree` at the
 * authoring layer while still batching trunks and canopies separately.
 *
 * Prototype geometry is authored around its own base at y=0, so a placement
 * matrix is just position, yaw and scale.
 */

type Proto = {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrices: THREE.Matrix4[];
  castShadow: boolean;
  receiveShadow: boolean;
};

export class InstanceKit {
  private readonly protos = new Map<string, Proto>();

  define(
    key: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    options: { castShadow?: boolean; receiveShadow?: boolean } = {},
  ): void {
    this.protos.set(key, {
      geometry,
      material,
      matrices: [],
      castShadow: options.castShadow ?? true,
      receiveShadow: options.receiveShadow ?? true,
    });
  }

  has(key: string): boolean {
    return this.protos.has(key);
  }

  place(key: string, position: Vec3, yaw = 0, scale: Vec3 | number = 1): void {
    const proto = this.protos.get(key);
    if (!proto) throw new Error(`unknown prop prototype: ${key}`);
    const s = typeof scale === "number" ? new THREE.Vector3(scale, scale, scale) : new THREE.Vector3(...scale);
    proto.matrices.push(
      new THREE.Matrix4().compose(
        new THREE.Vector3(...position),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)),
        s,
      ),
    );
  }

  /** Places one matrix across several prototypes — a whole tree, lamp or bench. */
  placeCompound(keys: readonly string[], position: Vec3, yaw = 0, scale: Vec3 | number = 1): void {
    for (const key of keys) this.place(key, position, yaw, scale);
  }

  /** The placement matrices for one prototype, for post-build animation. */
  baseMatrices(key: string): THREE.Matrix4[] {
    return this.protos.get(key)?.matrices ?? [];
  }

  /** Instance and draw-call accounting for the README. */
  stats(): { prototypes: number; instances: number } {
    let instances = 0;
    for (const proto of this.protos.values()) instances += proto.matrices.length;
    return { prototypes: [...this.protos.values()].filter((p) => p.matrices.length > 0).length, instances };
  }

  build(name = "props"): THREE.Group {
    const group = new THREE.Group();
    group.name = name;

    for (const [key, proto] of this.protos) {
      const count = proto.matrices.length;
      if (count === 0) continue;
      const mesh = new THREE.InstancedMesh(proto.geometry, proto.material, count);
      mesh.name = `inst:${key}`;
      for (let i = 0; i < count; i++) mesh.setMatrixAt(i, proto.matrices[i]);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = proto.castShadow;
      mesh.receiveShadow = proto.receiveShadow;
      mesh.frustumCulled = false;
      group.add(mesh);
    }
    return group;
  }
}

/** Merges a few parts into one prototype geometry based at y=0. */
function protoGeo(parts: Array<[THREE.BufferGeometry, Vec3, Vec3?, Vec3?]>): THREE.BufferGeometry {
  const placed = parts.map(([g, p, r, s]) => transform(g, p, r ?? [0, 0, 0], s ?? [1, 1, 1]));
  const merged = placed.length === 1 ? placed[0] : (mergeGeometries(placed, false) ?? placed[0]);
  // Props are authored around their own base at y=0, so occlusion bakes over a
  // shorter reach than a building — enough to seat them on the pavement.
  bakeVertexAo(merged, { groundY: 0, reach: 0.55, floor: 0.66 });
  return merged;
}

/**
 * Registers every prototype the block can use.
 *
 * All four states pull from this one kit; the states differ in *which* props
 * they place and where, not in having separate art.
 */
export function registerProps(kit: InstanceKit): void {
  // ------------------------------------------------------------------ trees
  kit.define("tree.trunk", transform(post(0.11, 1.5, 6), [0, 0.75, 0]), M.timberDark);
  kit.define(
    "tree.canopy",
    protoGeo([
      [blob(0.92), [0, 2.25, 0], [0, 0.4, 0], [1, 0.86, 1]],
      [blob(0.62), [0.42, 1.72, 0.24], [0, 1.1, 0]],
      [blob(0.52), [-0.38, 1.95, -0.28], [0, 2.2, 0]],
    ]),
    M.foliage,
  );
  kit.define(
    "tree.canopyDry",
    protoGeo([
      [blob(0.72), [0, 2.05, 0], [0, 0.4, 0], [1, 0.72, 1]],
      [blob(0.44), [0.36, 1.64, 0.2], [0, 1.1, 0]],
    ]),
    M.foliageDry,
  );

  // -------------------------------------------------------------- planting
  kit.define("planter.box", protoGeo([[slab(1.5, 0.44, 0.86, 0.04), [0, 0.22, 0]]]), M.planter);
  kit.define(
    "planter.green",
    protoGeo([
      [blob(0.36), [-0.4, 0.56, 0], [0, 0.5, 0], [1, 0.6, 1]],
      [blob(0.32), [0.16, 0.58, 0.1], [0, 1.4, 0], [1, 0.66, 1]],
      [blob(0.26), [0.52, 0.54, -0.1], [0, 2.4, 0], [1, 0.6, 1]],
    ]),
    M.foliageDeep,
  );
  kit.define("weeds", protoGeo([
    [blob(0.2), [0, 0.1, 0], [0, 0.3, 0], [1, 0.5, 1]],
    [blob(0.14), [0.22, 0.08, 0.12], [0, 1.3, 0], [1, 0.45, 1]],
  ]), M.foliageDry, { castShadow: false });

  // ------------------------------------------------------------- furniture
  kit.define("bollard", protoGeo([
    [post(0.075, 0.72, 8), [0, 0.36, 0]],
    [blob(0.085, 0), [0, 0.74, 0]],
  ]), M.ironDark);
  kit.define("bench.seat", protoGeo([[slab(1.45, 0.09, 0.42, 0.03), [0, 0.44, 0]]]), M.timber);
  kit.define("bench.legs", protoGeo([
    [box(0.09, 0.42, 0.36), [-0.58, 0.21, 0]],
    [box(0.09, 0.42, 0.36), [0.58, 0.21, 0]],
  ]), M.ironDark);
  kit.define("bin", protoGeo([
    [post(0.24, 0.78, 8), [0, 0.39, 0]],
    [post(0.27, 0.06, 8), [0, 0.8, 0]],
  ]), M.ironDark);

  kit.define("lamp.post", protoGeo([
    [post(0.07, 4.2, 8), [0, 2.1, 0]],
    [box(0.09, 0.09, 0.92), [0, 4.16, 0.42]],
  ]), M.ironDark);
  // A plain box, not a bevelled one. The lantern is 34cm across and four
  // metres up: three pixels at the default framing, for which a rounded box
  // was spending three hundred triangles a lamp and twenty-two thousand across
  // the city — more than the entire countryside.
  kit.define("lamp.head", protoGeo([[box(0.34, 0.14, 0.5), [0, 4.06, 0.82]]]), M.aluminium);

  /**
   * The tree used in open country.
   *
   * One canopy and a square trunk, merged into a single prototype: thirty-six
   * triangles against the eighty-four of the street tree, and one instanced
   * mesh instead of two. There are hundreds of these and they are a hundred
   * metres away, where the difference is invisible and the budget is not.
   */
  kit.define(
    "tree.far",
    protoGeo([
      [post(0.13, 1.6, 4), [0, 0.8, 0]],
      [blob(1.05), [0, 2.5, 0], [0, 0.4, 0], [1, 0.9, 1]],
    ]),
    M.foliage,
  );
  kit.define(
    "tree.farDry",
    protoGeo([
      [post(0.13, 1.6, 4), [0, 0.8, 0]],
      [blob(0.9), [0, 2.3, 0], [0, 0.4, 0], [1, 0.8, 1]],
    ]),
    M.foliageDry,
  );

  // ------------------------------------------------------------ site props
  kit.define("cone", protoGeo([
    [new THREE.ConeGeometry(0.19, 0.56, 8), [0, 0.3, 0]],
    [slab(0.42, 0.05, 0.42, 0.02), [0, 0.025, 0]],
  ]), M.accentDeep);
  kit.define("barrier.body", protoGeo([[bevelBox(1.9, 0.52, 0.34, 0.06), [0, 0.3, 0]]]), M.hazard);
  kit.define("barrier.feet", protoGeo([
    [box(0.22, 0.1, 0.56), [-0.72, 0.05, 0]],
    [box(0.22, 0.1, 0.56), [0.72, 0.05, 0]],
  ]), M.hazardDark);

  kit.define("pallet", protoGeo([
    [box(1.1, 0.06, 0.9), [0, 0.03, 0]],
    [box(1.1, 0.07, 0.12), [0, 0.1, -0.36]],
    [box(1.1, 0.07, 0.12), [0, 0.1, 0]],
    [box(1.1, 0.07, 0.12), [0, 0.1, 0.36]],
    [box(1.1, 0.05, 0.9), [0, 0.16, 0]],
  ]), M.timberPale);
  kit.define("crate", protoGeo([[bevelBox(0.82, 0.66, 0.72, 0.04), [0, 0.33, 0]]]), M.timber);
  kit.define("crateLid", protoGeo([[slab(0.88, 0.06, 0.78, 0.02), [0, 0.68, 0]]]), M.timberDark);
  kit.define("drum", protoGeo([[post(0.28, 0.86, 10), [0, 0.43, 0]]]), M.steelRust);
  kit.define("sack", protoGeo([[blob(0.3, 0), [0, 0.24, 0], [0.3, 0.4, 0], [1.3, 0.75, 1]]]), M.dirt);

  kit.define("dirtPile", protoGeo([
    [new THREE.ConeGeometry(1.15, 0.78, 9), [0, 0.39, 0]],
  ]), M.dirt);
  kit.define("gravelPile", protoGeo([
    [new THREE.ConeGeometry(0.9, 0.62, 8), [0, 0.31, 0]],
  ]), M.gravel);

  // temporary fencing / hoarding
  kit.define("fence.mesh", protoGeo([[box(2.3, 1.9, 0.04), [0, 1.0, 0]]]), M.netting, {
    castShadow: false,
  });
  kit.define("fence.frame", protoGeo([
    [box(2.34, 0.07, 0.07), [0, 1.94, 0]],
    [box(2.34, 0.07, 0.07), [0, 0.1, 0]],
    [box(0.07, 1.9, 0.07), [-1.14, 1.0, 0]],
    [box(0.07, 1.9, 0.07), [1.14, 1.0, 0]],
  ]), M.steel);
  kit.define("fence.foot", protoGeo([[slab(0.5, 0.09, 0.72, 0.03), [0, 0.045, 0]]]), M.concreteDark);

  kit.define("hoard.panel", protoGeo([[box(2.4, 2.35, 0.09), [0, 1.2, 0]]]), M.hoarding);
  kit.define("hoard.rail", protoGeo([
    [box(2.44, 0.11, 0.14), [0, 2.34, 0]],
    [box(0.13, 2.4, 0.13), [-1.2, 1.2, 0]],
  ]), M.hoardingRail);

  // scaffolding
  kit.define("scaff.post", protoGeo([[post(0.05, 4.4, 6), [0, 2.2, 0]]]), M.steel);
  kit.define("scaff.deck", protoGeo([[box(2.1, 0.07, 0.86), [0, 0, 0]]]), M.timberPale);
  kit.define("scaff.rail", protoGeo([[box(2.1, 0.05, 0.05), [0, 0, 0]]]), M.steel);

  // ---------------------------------------------------------------- actors
  kit.define("person.body", protoGeo([
    [bevelBox(0.34, 0.62, 0.24, 0.1), [0, 0.86, 0]],
    [bevelBox(0.3, 0.52, 0.22, 0.08), [0, 0.32, 0]],
  ]), M.personBody);
  kit.define("person.head", protoGeo([[blob(0.135, 1), [0, 1.28, 0]]]), M.personSkin);

  kit.define("person.bodyAlt", protoGeo([
    [bevelBox(0.34, 0.62, 0.24, 0.1), [0, 0.86, 0]],
    [bevelBox(0.3, 0.52, 0.22, 0.08), [0, 0.32, 0]],
  ]), M.personAlt);

  kit.define("worker.body", protoGeo([
    [bevelBox(0.36, 0.6, 0.26, 0.1), [0, 0.86, 0]],
    [bevelBox(0.3, 0.52, 0.22, 0.08), [0, 0.32, 0]],
  ]), M.personHiVis);
  kit.define("worker.helmet", protoGeo([
    [blob(0.135, 1), [0, 1.28, 0]],
    [new THREE.CylinderGeometry(0.16, 0.17, 0.09, 8), [0, 1.36, 0]],
  ]), M.hazard);

  // ----------------------------------------------------------------- signs
  kit.define("sign.blade", protoGeo([[bevelBox(0.1, 0.9, 1.5, 0.03), [0, 0, 0]]]), M.signBoard);
  kit.define("sign.bracket", protoGeo([[box(0.32, 0.06, 0.06), [0, 0, 0]]]), M.ironDark);

  // ------------------------------------------------------------- vehicles
  // Placed once or twice, but instanced anyway so adding traffic is free.
  kit.define("van.body", protoGeo([
    [bevelBox(2.1, 1.34, 4.5, 0.16), [0, 1.28, 0]],
    [bevelBox(1.98, 0.86, 1.5, 0.14), [0, 1.98, 1.32]],
  ]), M.vanBody);
  kit.define("van.glass", protoGeo([
    [box(1.9, 0.62, 0.08), [0, 2.02, 2.06]],
    [box(0.08, 0.56, 1.2), [1.0, 2.0, 1.3]],
    [box(0.08, 0.56, 1.2), [-1.0, 2.0, 1.3]],
  ]), M.glassDim);
  kit.define("van.stripe", protoGeo([[box(2.14, 0.22, 3.0), [0, 0.86, -0.4]]]), M.vanAccent);
  kit.define("van.wheels", protoGeo([
    [new THREE.CylinderGeometry(0.42, 0.42, 0.26, 10), [1.02, 0.42, 1.42], [0, 0, Math.PI / 2]],
    [new THREE.CylinderGeometry(0.42, 0.42, 0.26, 10), [-1.02, 0.42, 1.42], [0, 0, Math.PI / 2]],
    [new THREE.CylinderGeometry(0.42, 0.42, 0.26, 10), [1.02, 0.42, -1.36], [0, 0, Math.PI / 2]],
    [new THREE.CylinderGeometry(0.42, 0.42, 0.26, 10), [-1.02, 0.42, -1.36], [0, 0, Math.PI / 2]],
  ]), M.tyre);

  // ----------------------------------------------------------- contact AO
  // A soft dark ellipse laid just above the ground under every placed object.
  // The shadow map handles the sun; this handles the fact that a small object
  // still reads as hovering without a darkening directly beneath it.
  //
  // Texture, material and geometry are process-wide singletons. `registerProps`
  // runs once per lot, so building them here allocated a fresh canvas texture on
  // every state switch and the texture count climbed forever.
  kit.define("contact", contactDisc(), contactMaterial(), {
    castShadow: false,
    receiveShadow: false,
  });
}

let sharedContactMaterial: THREE.MeshBasicMaterial | null = null;
let sharedContactDisc: THREE.PlaneGeometry | null = null;

function contactMaterial(): THREE.MeshBasicMaterial {
  sharedContactMaterial ??= new THREE.MeshBasicMaterial({
    map: contactShadow(),
    transparent: true,
    depthWrite: false,
    opacity: 0.85,
    vertexColors: false,
  });
  return sharedContactMaterial;
}

function contactDisc(): THREE.PlaneGeometry {
  if (!sharedContactDisc) {
    sharedContactDisc = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    // Outlives any single lot, so teardown must leave it alone.
    sharedContactDisc.userData.shared = true;
  }
  return sharedContactDisc;
}

/** Lays a contact-shadow disc, slightly above the surface to avoid z-fighting. */
function ground(kit: InstanceKit, position: Vec3, radius: number, yaw = 0): void {
  kit.place("contact", [position[0], position[1] + 0.018, position[2]], yaw, [radius, 1, radius]);
}

/** Convenience wrappers so authoring code reads as objects, not prototypes. */
export const Prop = {
  tree: (kit: InstanceKit, position: Vec3, yaw = 0, scale = 1, dry = false) => {
    kit.placeCompound(["tree.trunk", dry ? "tree.canopyDry" : "tree.canopy"], position, yaw, scale);
    ground(kit, position, 2.1 * scale);
  },
  planter: (kit: InstanceKit, position: Vec3, yaw = 0) => {
    kit.placeCompound(["planter.box", "planter.green"], position, yaw);
    ground(kit, position, 2.0, yaw);
  },
  bench: (kit: InstanceKit, position: Vec3, yaw = 0) => {
    kit.placeCompound(["bench.seat", "bench.legs"], position, yaw);
    ground(kit, position, 1.9, yaw);
  },
  lamp: (kit: InstanceKit, position: Vec3, yaw = 0) => {
    kit.placeCompound(["lamp.post", "lamp.head"], position, yaw);
    ground(kit, position, 0.9);
  },
  barrier: (kit: InstanceKit, position: Vec3, yaw = 0) => {
    kit.placeCompound(["barrier.body", "barrier.feet"], position, yaw);
    ground(kit, position, 2.3, yaw);
  },
  fence: (kit: InstanceKit, position: Vec3, yaw = 0) => {
    kit.placeCompound(["fence.mesh", "fence.frame", "fence.foot"], position, yaw);
    ground(kit, position, 1.6, yaw);
  },
  hoarding: (kit: InstanceKit, position: Vec3, yaw = 0) => {
    kit.placeCompound(["hoard.panel", "hoard.rail"], position, yaw);
    ground(kit, position, 1.7, yaw);
  },
  crate: (kit: InstanceKit, position: Vec3, yaw = 0) => {
    kit.placeCompound(["crate", "crateLid"], position, yaw);
    ground(kit, position, 1.4, yaw);
  },
  /** Bare contact disc, for objects authored outside the instance kit. */
  contact: ground,
};

/** Wedge re-export so district code can shape roofs without importing geom twice. */
export { wedge };
