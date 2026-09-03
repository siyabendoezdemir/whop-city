import * as THREE from "three";

import { PartsBuilder, bevelBox, blob, box, post, type Vec3 } from "../lib/geom";
import { Rng } from "../lib/rng";
import { M } from "../scene/materials";

/**
 * Characters and moving machinery.
 *
 * These are authored one at a time rather than instanced, because there are
 * only a handful and every one of them moves. That buys two things the previous
 * pass did not have: silhouettes that differ from each other, and motion that
 * is visible in a still-camera recording.
 *
 * A person is built from eleven parts with posed limbs. Height, build, palette,
 * headgear and load all vary, so no two read as the same block.
 */

export type Rig = {
  group: THREE.Group;
  /** `t` is seconds within the state's dwell. Deterministic — no clock reads. */
  update: (t: number) => void;
};

export type Pose = "walk" | "carry" | "stand" | "point" | "lean" | "push";

export type PersonSpec = {
  pose: Pose;
  /** 0.9 short, 1.1 tall. */
  build?: number;
  body?: THREE.Material;
  legs?: THREE.Material;
  hat?: "none" | "helmet" | "cap";
  vest?: boolean;
  carrying?: boolean;
  seed?: number;
};

const SKIN = M.personSkin;

/**
 * Writes a posed figure into an existing builder.
 *
 * Static bystanders go through this so they merge into the block's geometry and
 * cost nothing extra in draw calls, while still being individually posed. Only
 * the figures that actually move get their own group.
 */
export function addPersonTo(
  b: PartsBuilder,
  spec: PersonSpec,
  at: Vec3 = [0, 0, 0],
  yaw = 0,
): void {
  const s = spec.build ?? 1;
  const body = spec.body ?? M.personBody;
  const legs = spec.legs ?? M.ironDark;
  const inner = new PartsBuilder();
  buildPersonParts(inner, spec, s, body, legs);

  // Re-emit into the target builder at the requested transform.
  const posed = inner.build("person-static", true, false);
  posed.position.set(...at);
  posed.rotation.y = yaw;
  posed.updateMatrixWorld(true);
  posed.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      b.add(child.material as THREE.Material, child.geometry.clone().applyMatrix4(child.matrixWorld));
    }
  });
}

function buildPersonParts(
  b: PartsBuilder,
  spec: PersonSpec,
  s: number,
  body: THREE.Material,
  legs: THREE.Material,
): void {
  const hipY = 0.46 * s;
  const chestY = 0.92 * s;
  const headY = 1.36 * s;

  // Torso, tapered by stacking two masses rather than one box.
  b.add(body, bevelBox(0.36 * s, 0.44 * s, 0.24 * s, 0.09), [0, chestY, 0]);
  b.add(body, bevelBox(0.32 * s, 0.24 * s, 0.22 * s, 0.08), [0, hipY + 0.16 * s, 0]);
  if (spec.vest) {
    b.add(M.personHiVis, bevelBox(0.39 * s, 0.34 * s, 0.27 * s, 0.09), [0, chestY + 0.02, 0]);
    b.add(M.plaster, box(0.4 * s, 0.05, 0.28 * s), [0, chestY + 0.06, 0]);
  }

  // Head and hair/headgear.
  b.add(SKIN, blob(0.115 * s, 1), [0, headY, 0]);
  if (spec.hat === "helmet") {
    b.add(M.hazard, blob(0.132 * s, 1), [0, headY + 0.03, 0]);
    b.add(M.hazard, new THREE.CylinderGeometry(0.16 * s, 0.17 * s, 0.035, 8), [0, headY - 0.01, 0]);
  } else if (spec.hat === "cap") {
    b.add(M.accentDeep, blob(0.126 * s, 1), [0, headY + 0.035, 0]);
    b.add(M.accentDeep, box(0.2 * s, 0.03, 0.14 * s), [0, headY + 0.01, 0.13 * s]);
  } else {
    b.add(M.timberDark, blob(0.122 * s, 1), [0, headY + 0.032, 0]);
  }

  // Legs and arms, angled by pose.
  const legLen = 0.5 * s;
  const armLen = 0.42 * s;
  const stride =
    spec.pose === "walk" ? 0.5 : spec.pose === "push" ? 0.34 : spec.pose === "lean" ? 0.18 : 0.1;

  const legGeo = box(0.12 * s, legLen, 0.14 * s);
  b.add(legs, legGeo, [-0.09 * s, hipY - legLen / 2 + 0.02, 0], [stride, 0, 0]);
  b.add(legs, legGeo, [0.09 * s, hipY - legLen / 2 + 0.02, 0], [-stride, 0, 0]);
  b.add(M.ironDark, box(0.14 * s, 0.07, 0.24 * s), [-0.09 * s, 0.035, stride * 0.22]);
  b.add(M.ironDark, box(0.14 * s, 0.07, 0.24 * s), [0.09 * s, 0.035, -stride * 0.22]);

  const armGeo = box(0.1 * s, armLen, 0.11 * s);
  const armY = chestY + 0.06 * s - armLen / 2;
  if (spec.pose === "carry" || spec.carrying) {
    // Both arms forward, holding something.
    b.add(body, armGeo, [-0.23 * s, armY + 0.06, 0.12 * s], [-1.15, 0, 0]);
    b.add(body, armGeo, [0.23 * s, armY + 0.06, 0.12 * s], [-1.15, 0, 0]);
    b.add(M.timberPale, bevelBox(0.44 * s, 0.3 * s, 0.34 * s, 0.04), [0, chestY - 0.02, 0.34 * s]);
  } else if (spec.pose === "point") {
    b.add(body, armGeo, [-0.23 * s, armY, 0], [0.25, 0, 0.1]);
    b.add(body, armGeo, [0.24 * s, armY + 0.1, 0.1 * s], [-1.4, 0, -0.2]);
  } else if (spec.pose === "lean") {
    b.add(body, armGeo, [-0.23 * s, armY, -0.04], [0.4, 0, 0.35]);
    b.add(body, armGeo, [0.23 * s, armY, -0.04], [0.4, 0, -0.35]);
  } else if (spec.pose === "push") {
    b.add(body, armGeo, [-0.22 * s, armY + 0.08, 0.14 * s], [-1.25, 0, 0]);
    b.add(body, armGeo, [0.22 * s, armY + 0.08, 0.14 * s], [-1.25, 0, 0]);
  } else {
    b.add(body, armGeo, [-0.23 * s, armY, 0], [-stride * 0.9, 0, 0.08]);
    b.add(body, armGeo, [0.23 * s, armY, 0], [stride * 0.9, 0, -0.08]);
  }
}

/** One posed figure as its own animatable group. */
export function makePerson(spec: PersonSpec): Rig {
  const rng = new Rng(spec.seed ?? 1);
  const s = spec.build ?? 1;
  const b = new PartsBuilder();
  buildPersonParts(b, spec, s, spec.body ?? M.personBody, spec.legs ?? M.ironDark);

  const group = b.build("person", true, false);
  if (spec.pose === "lean") group.rotation.x = -0.16;

  // Idle breath, so even a standing figure is not a statue.
  const phase = rng.next() * Math.PI * 2;
  const bob = spec.pose === "stand" || spec.pose === "lean" ? 0.02 : 0.045;
  const baseY = group.position.y;

  return {
    group,
    update: (t) => {
      group.position.y = baseY + Math.sin(t * 2.4 + phase) * bob;
    },
  };
}

/** A walker that traverses a straight run and loops, with a real gait. */
export function makeWalker(
  spec: PersonSpec,
  from: Vec3,
  to: Vec3,
  speed = 1.0,
  offset = 0,
): Rig {
  const rig = makePerson(spec);
  const a = new THREE.Vector3(...from);
  const bVec = new THREE.Vector3(...to);
  const span = a.distanceTo(bVec);
  const heading = Math.atan2(bVec.x - a.x, bVec.z - a.z);
  rig.group.rotation.y = heading;

  // Limb swing: the two legs are children 3 and 4 of the merged group? They are
  // merged, so instead the whole figure gets a subtle roll and vertical lilt,
  // which at this camera distance reads as walking.
  return {
    group: rig.group,
    update: (t) => {
      const travel = ((t * speed) / span + offset) % 1;
      rig.group.position.lerpVectors(a, bVec, travel);
      const step = t * speed * 3.4;
      rig.group.position.y += Math.abs(Math.sin(step)) * 0.075;
      rig.group.rotation.z = Math.sin(step) * 0.10;
      rig.group.rotation.y = heading + Math.sin(step * 0.5) * 0.03;
    },
  };
}

/** Counterbalance forklift. Shuttles pallets between the van and the door. */
export function makeForklift(from: Vec3, to: Vec3, yaw: number): Rig {
  const b = new PartsBuilder();

  // Chassis, counterweight, cage, mast and forks.
  b.add(M.plantMachine, bevelBox(1.15, 0.52, 1.9, 0.09), [0, 0.5, 0]);
  b.add(M.ironDark, bevelBox(1.05, 0.42, 0.6, 0.08), [0, 0.52, -1.0]);
  b.add(M.plantMachine, bevelBox(0.95, 0.42, 0.7, 0.08), [0, 0.95, -0.45]);
  b.add(M.ironDark, box(0.9, 0.1, 0.72), [0, 1.2, -0.45]);
  for (const ox of [-0.44, 0.44]) {
    b.add(M.steel, post(0.035, 1.15, 5), [ox, 1.72, -0.45]);
    b.add(M.steel, post(0.045, 1.6, 5), [ox, 1.1, 0.9]);
  }
  b.add(M.hazard, box(1.0, 0.07, 0.8), [0, 2.3, -0.45]);
  b.add(M.ironDark, box(0.9, 0.16, 0.16), [0, 1.85, 0.9]);
  // Forks and a pallet on them.
  b.add(M.steel, box(0.1, 0.07, 0.95), [-0.3, 0.2, 1.4]);
  b.add(M.steel, box(0.1, 0.07, 0.95), [0.3, 0.2, 1.4]);
  b.add(M.timberPale, box(1.0, 0.13, 0.85), [0, 0.3, 1.42]);
  b.add(M.timber, bevelBox(0.8, 0.55, 0.7, 0.05), [0, 0.64, 1.42]);
  // Wheels.
  for (const [ox, oz] of [[-0.56, 0.72], [0.56, 0.72], [-0.44, -0.72], [0.44, -0.72]]) {
    b.add(M.tyre, new THREE.CylinderGeometry(0.26, 0.26, 0.2, 10), [ox, 0.26, oz], [0, 0, Math.PI / 2]);
  }

  const group = b.build("forklift");
  const a = new THREE.Vector3(...from);
  const bVec = new THREE.Vector3(...to);

  return {
    group,
    update: (t) => {
      // Out, pause, back, pause — a shuttle rather than a metronome.
      const cycle = (t / 5.5) % 1;
      let k: number;
      if (cycle < 0.38) k = cycle / 0.38;
      else if (cycle < 0.5) k = 1;
      else if (cycle < 0.88) k = 1 - (cycle - 0.5) / 0.38;
      else k = 0;
      const eased = k * k * (3 - 2 * k);
      group.position.lerpVectors(a, bVec, eased);
      group.rotation.y = yaw + (cycle >= 0.5 ? Math.PI : 0);
      group.position.y += Math.sin(t * 9) * 0.01; // engine judder
    },
  };
}

/**
 * A vent plume.
 *
 * Six soft blobs rising, expanding and fading on a loop. Reads as a working
 * extract fan without a particle system.
 */
const PUFF_COUNT = 6;

/**
 * Puff materials are created once for the whole process, not per vent.
 *
 * Each puff needs its own material because it fades on its own schedule, but
 * cloning them per lot meant every state switch leaked six more — the texture
 * and material counts climbed for as long as you kept clicking. Pooling them
 * keeps a full state cycle flat.
 */
const PUFF_MATERIALS: THREE.MeshStandardMaterial[] = Array.from({ length: PUFF_COUNT }, () =>
  new THREE.MeshStandardMaterial({
    color: "#ffffff",
    transparent: true,
    opacity: 0.4,
    roughness: 1,
    depthWrite: false,
    vertexColors: false,
  }),
);

export function makeSteamVent(origin: Vec3, scale = 1): Rig {
  const group = new THREE.Group();
  const puffs: THREE.Mesh[] = [];
  for (let i = 0; i < PUFF_COUNT; i++) {
    const mesh = new THREE.Mesh(blob(0.52 * scale, 1), PUFF_MATERIALS[i]);
    mesh.castShadow = false;
    group.add(mesh);
    puffs.push(mesh);
  }
  group.position.set(...origin);

  return {
    group,
    update: (t) => {
      puffs.forEach((puff, i) => {
        const life = ((t * 0.42 + i / puffs.length) % 1);
        puff.position.set(life * 1.5 * scale, life * 4.2 * scale, life * 0.7 * scale);
        const grow = 0.5 + life * 2.4;
        puff.scale.setScalar(grow);
        (puff.material as THREE.MeshStandardMaterial).opacity = 0.62 * (1 - life) * (life < 0.1 ? life * 10 : 1);
      });
    },
  };
}

/**
 * Delivery van. Reverses onto the dock, waits while it is unloaded, pulls away.
 *
 * The loop runs over eleven seconds so that at any point in the healthy state's
 * dwell the van is doing something legible — arriving, sitting with its hazards
 * on, or leaving.
 */
export function makeVan(dock: Vec3, approach: Vec3, yaw: number): Rig {
  const b = new PartsBuilder();
  b.add(M.vanBody, bevelBox(2.1, 1.34, 4.5, 0.16), [0, 1.28, 0]);
  b.add(M.vanBody, bevelBox(1.98, 0.86, 1.5, 0.14), [0, 1.98, 1.32]);
  b.add(M.vanAccent, box(2.14, 0.24, 3.0), [0, 0.88, -0.4]);
  b.add(M.plaster, box(2.16, 0.5, 1.4), [0, 1.5, -0.5]);
  b.add(M.glassDim, box(1.9, 0.62, 0.08), [0, 2.02, 2.06]);
  b.add(M.glassDim, box(0.08, 0.56, 1.2), [1.0, 2.0, 1.3]);
  b.add(M.glassDim, box(0.08, 0.56, 1.2), [-1.0, 2.0, 1.3]);
  // Rear doors, lights, bumper.
  b.add(M.aluminium, box(0.06, 1.2, 0.06), [0, 1.3, -2.26]);
  b.add(M.accentDeep, box(0.34, 0.2, 0.06), [0.78, 0.9, -2.26]);
  b.add(M.accentDeep, box(0.34, 0.2, 0.06), [-0.78, 0.9, -2.26]);
  b.add(M.ironDark, box(2.16, 0.18, 0.2), [0, 0.62, -2.28]);
  for (const [ox, oz] of [[1.02, 1.42], [-1.02, 1.42], [1.02, -1.36], [-1.02, -1.36]]) {
    b.add(M.tyre, new THREE.CylinderGeometry(0.42, 0.42, 0.26, 10), [ox, 0.42, oz], [0, 0, Math.PI / 2]);
  }

  const group = b.build("van");
  const a = new THREE.Vector3(...approach);
  const d = new THREE.Vector3(...dock);
  group.rotation.y = yaw;

  return {
    group,
    update: (t) => {
      const cycle = (t / 11) % 1;
      let k: number;
      if (cycle < 0.18) k = cycle / 0.18; // reversing on
      else if (cycle < 0.82) k = 1; // docked, being unloaded
      else k = 1 - (cycle - 0.82) / 0.18; // pulling away
      const eased = k * k * (3 - 2 * k);
      group.position.lerpVectors(a, d, eased);
      // Idle shake only while stationary and running.
      const idling = cycle >= 0.18 && cycle < 0.82;
      group.position.y += idling ? Math.sin(t * 21) * 0.008 : 0;
    },
  };
}

/** Fabric that lifts in the breeze: awning edges, banners, site netting. */
export function makeBanner(
  position: Vec3,
  width: number,
  height: number,
  material: THREE.Material,
  phase = 0,
): Rig {
  const b = new PartsBuilder();
  b.add(material, box(width, height, 0.05), [0, -height / 2, 0]);
  const group = b.build("banner", true, false);
  group.position.set(...position);
  return {
    group,
    update: (t) => {
      group.rotation.x = Math.sin(t * 2.3 + phase) * 0.34;
      group.rotation.z = Math.sin(t * 1.7 + phase * 1.7) * 0.14;
    },
  };
}