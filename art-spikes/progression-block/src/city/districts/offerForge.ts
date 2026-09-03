import * as THREE from "three";

import { PartsBuilder, bevelBox, box, post, slab, type Vec3 } from "../../lib/geom";
import { Rng } from "../../lib/rng";
import { M } from "../../scene/materials";
import { Prop, type InstanceKit } from "../props";
import { SITE } from "../ground";

/**
 * Offer Forge — a maker block.
 *
 * The lot is one place across all four states. What persists is the silhouette
 * spine: the brick street unit at the frontage, the vent stack, and the steel
 * yard gantry. Those three read as the same corner in black at any state, which
 * is the whole point of a progression lot — you should recognise where you are
 * before you read what is happening.
 *
 * What changes is real construction. The workshop goes from footings, to a bare
 * frame under a tower crane, to a finished glazed sawtooth shed, to that same
 * shed shuttered with a stalled extension rusting beside it. States swap
 * geometry and materials; nothing here is a tint pass over one model.
 */

export type LotState = "dormant" | "rising" | "healthy" | "struggling";

const LOT_Y = SITE.groundY + SITE.kerbH + 0.06;

// Workshop envelope.
const WS = { x0: -12.4, x1: 4.2, z0: -12.8, z1: -2.0, eave: 6.4, bays: 6 } as const;
// Street-front unit.
const SU = { x0: -12.4, x1: -4.6, z0: 0.3, z1: 5.35, h: 7.1 } as const;
// Loading yard and its gantry.
const YARD = { x0: 4.9, x1: 12.7, z0: -12.6, z1: 2.0 } as const;
// Display plaza.
const PLAZA = { x0: -4.0, x1: 4.4, z0: -1.4, z1: 5.35 } as const;

/** Triangle prism in the XY plane, extruded along Z. Sawtooth end caps use it. */
function prismXY(points: Array<[number, number]>, depth: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (const [x, y] of points.slice(1)) shape.lineTo(x, y);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geometry.translate(0, 0, -depth / 2);
  geometry.computeVertexNormals();
  return geometry;
}

/** A sloped slab between two points in X, used for every roof pitch here. */
function pitch(
  b: PartsBuilder,
  material: THREE.Material,
  xa: number,
  ya: number,
  xb: number,
  yb: number,
  depth: number,
  zc: number,
  thickness = 0.16,
) {
  const dx = xb - xa;
  const dy = yb - ya;
  const length = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  b.add(material, box(length, thickness, depth), [(xa + xb) / 2, (ya + yb) / 2, zc], [0, 0, angle]);
}

// ---------------------------------------------------------------------------
// Persistent spine
// ---------------------------------------------------------------------------

/** Brick street unit: two storeys, shopfront below, workshop office above. */
function streetUnit(b: PartsBuilder, state: LotState): void {
  const w = SU.x1 - SU.x0;
  const d = SU.z1 - SU.z0;
  const cx = (SU.x0 + SU.x1) / 2;
  const cz = (SU.z0 + SU.z1) / 2;
  const declining = state === "struggling";
  const dark = state === "dormant" || declining;

  // Mass, plinth, parapet, cornice.
  b.add(M.brick, bevelBox(w, SU.h, d, 0.09), [cx, LOT_Y + SU.h / 2, cz]);
  b.add(M.concreteDark, box(w + 0.16, 0.55, d + 0.16), [cx, LOT_Y + 0.27, cz]);
  b.add(M.brickDark, box(w + 0.3, 0.42, d + 0.3), [cx, LOT_Y + SU.h + 0.2, cz]);
  b.add(M.fascia, box(w + 0.42, 0.16, d + 0.42), [cx, LOT_Y + SU.h + 0.46, cz]);
  b.add(M.roofFelt, box(w - 0.1, 0.14, d - 0.1), [cx, LOT_Y + SU.h + 0.06, cz]);

  // Roof plant, so the top is not a bare lid.
  b.add(M.aluminium, bevelBox(1.1, 0.72, 1.4, 0.08), [SU.x0 + 1.9, LOT_Y + SU.h + 0.5, cz + 0.6]);
  b.add(M.steel, post(0.09, 1.5, 6), [SU.x1 - 1.3, LOT_Y + SU.h + 0.9, cz - 1.2]);

  // --------------------------------------------------------- ground floor
  const shopY = LOT_Y + 1.85;
  const frontZ = SU.z1 + 0.02;

  // Recessed shopfront: reveal, mullions, glazing, stall riser.
  b.add(M.brickDark, box(w - 1.3, 3.1, 0.36), [cx, shopY + 0.05, frontZ - 0.2]);
  b.add(M.timberDark, box(w - 1.5, 0.34, 0.14), [cx, LOT_Y + 0.5, frontZ]);

  const glazing = dark ? M.glassDim : state === "healthy" ? M.glassLit : M.glass;
  if (declining) {
    // Roller shutter down, with a boarded panel where glass has gone.
    b.add(M.shutter, box(w - 1.7, 2.5, 0.1), [cx, shopY + 0.15, frontZ]);
    for (let i = 0; i < 12; i++) {
      b.add(M.steel, box(w - 1.7, 0.04, 0.13), [cx, LOT_Y + 0.85 + i * 0.21, frontZ + 0.01]);
    }
    b.add(M.boarding, box(2.1, 1.5, 0.09), [SU.x0 + 1.9, shopY + 0.4, frontZ + 0.06]);
  } else if (state === "dormant") {
    // Hoarded and padlocked: the unit exists but is closed up.
    b.add(M.boarding, box(w - 1.7, 2.6, 0.1), [cx, shopY + 0.15, frontZ]);
    b.add(M.steel, box(w - 1.9, 0.1, 0.12), [cx, shopY + 0.15, frontZ + 0.06], [0, 0, 0.42]);
    b.add(M.steel, box(w - 1.9, 0.1, 0.12), [cx, shopY + 0.15, frontZ + 0.06], [0, 0, -0.42]);
  } else {
    b.add(glazing, box(w - 1.75, 2.45, 0.07), [cx, shopY + 0.15, frontZ]);
    // Mullions and a transom.
    for (let i = 1; i < 5; i++) {
      b.add(M.aluminium, box(0.08, 2.5, 0.13), [SU.x0 + 0.9 + i * ((w - 1.8) / 5), shopY + 0.15, frontZ + 0.02]);
    }
    b.add(M.aluminium, box(w - 1.75, 0.1, 0.14), [cx, shopY + 0.95, frontZ + 0.02]);
    // Open door leaf, set back.
    b.add(M.timber, box(1.0, 2.3, 0.08), [SU.x1 - 1.9, LOT_Y + 1.2, frontZ - 0.1], [0, 0.5, 0]);
  }

  // Awning over the shopfront.
  const awning = declining ? M.canvasAwningFaded : M.canvasAwning;
  if (state !== "dormant") {
    pitch(b, awning, SU.x0 + 0.8, LOT_Y + 3.5, SU.x1 - 0.8, LOT_Y + 3.5, 1.5, frontZ + 0.72, 0.1);
    b.add(awning, box(w - 1.6, 0.32, 0.1), [cx, LOT_Y + 3.34, frontZ + 1.44]);
    b.add(M.steel, post(0.045, 1.2, 5), [SU.x0 + 1.0, LOT_Y + 3.0, frontZ + 1.4]);
    b.add(M.steel, post(0.045, 1.2, 5), [SU.x1 - 1.0, LOT_Y + 3.0, frontZ + 1.4]);
  }

  // ---------------------------------------------------------- upper floor
  const upperY = LOT_Y + 5.0;
  for (let i = 0; i < 3; i++) {
    const x = SU.x0 + 1.6 + i * 2.35;
    // Reveal, sash, mullion, cill — a window that is a hole, not a decal.
    b.add(M.brickDark, box(1.42, 1.92, 0.2), [x, upperY, frontZ - 0.12]);
    b.add(declining ? M.glassDim : M.glass, box(1.22, 1.72, 0.07), [x, upperY, frontZ - 0.02]);
    b.add(M.fascia, box(0.07, 1.72, 0.11), [x, upperY, frontZ]);
    b.add(M.fascia, box(1.22, 0.07, 0.11), [x, upperY, frontZ]);
    b.add(M.kerb, slab(1.62, 0.12, 0.3, 0.03), [x, upperY - 1.02, frontZ + 0.06]);
    if (declining && i === 2) {
      b.add(M.boarding, box(1.3, 1.8, 0.08), [x, upperY, frontZ + 0.05]);
    }
  }

  // Fascia sign band over the shopfront.
  const signMat = state === "healthy" ? M.signLit : state === "struggling" ? M.signDead : M.signBoard;
  b.add(M.signBoard, box(w - 1.2, 0.78, 0.14), [cx, LOT_Y + 4.02, frontZ + 0.06]);
  if (state !== "dormant") {
    b.add(signMat, box(w - 2.4, 0.42, 0.08), [cx, LOT_Y + 4.02, frontZ + 0.14]);
  } else {
    // Sign wrapped while the unit is out of use.
    b.add(M.tarp, box(w - 1.0, 0.94, 0.16), [cx, LOT_Y + 4.02, frontZ + 0.1]);
  }
}

/** The vent stack. Tall, slim, and the clearest thing in the block's silhouette. */
function ventStack(b: PartsBuilder, state: LotState): void {
  const x = -11.3;
  const z = -11.4;
  const h = 12.2;
  b.add(M.brick, bevelBox(1.5, h, 1.5, 0.07), [x, LOT_Y + h / 2, z]);
  b.add(M.brickDark, box(1.72, 0.5, 1.72), [x, LOT_Y + 0.25, z]);
  // Banding breaks the shaft up.
  for (let i = 1; i <= 3; i++) {
    b.add(M.brickDark, box(1.62, 0.3, 1.62), [x, LOT_Y + i * 2.9, z]);
  }
  b.add(M.brickDark, box(1.86, 0.55, 1.86), [x, LOT_Y + h - 0.2, z]);
  b.add(M.ironDark, box(1.62, 0.22, 1.62), [x, LOT_Y + h + 0.16, z]);
  // Cowl.
  b.add(M.steel, post(0.42, 0.9, 8), [x, LOT_Y + h + 0.6, z]);
  if (state === "struggling") {
    // Aerial gone crooked, a small tell rather than a colour change.
    b.add(M.steelRust, post(0.05, 2.0, 5), [x + 0.5, LOT_Y + h + 1.5, z], [0, 0, 0.22]);
  } else if (state !== "dormant") {
    b.add(M.steel, post(0.05, 2.2, 5), [x + 0.5, LOT_Y + h + 1.6, z]);
  }
}

/** Steel portal gantry over the loading yard — permanent, and the second landmark. */
function yardGantry(b: PartsBuilder, state: LotState): void {
  const legs = [YARD.x0 + 0.6, YARD.x1 - 0.6];
  const zFront = -3.2;
  const zBack = -10.6;
  const top = LOT_Y + 6.9;
  const steel = state === "struggling" ? M.steelRust : M.steelPainted;

  for (const x of legs) {
    for (const z of [zFront, zBack]) {
      b.add(steel, box(0.42, top - LOT_Y, 0.42), [x, LOT_Y + (top - LOT_Y) / 2, z]);
      b.add(M.concreteDark, box(0.86, 0.34, 0.86), [x, LOT_Y + 0.17, z]);
      // Knee braces.
      b.add(steel, box(1.5, 0.16, 0.16), [x + (x === legs[0] ? 0.7 : -0.7), top - 1.2, z], [0, 0, x === legs[0] ? -0.7 : 0.7]);
    }
    // Leg cross-bracing in Z.
    b.add(steel, box(0.14, 0.14, zFront - zBack), [x, LOT_Y + 3.2, (zFront + zBack) / 2]);
  }

  // Two rails and a lattice between them.
  for (const z of [zFront, zBack]) {
    b.add(steel, box(legs[1] - legs[0] + 0.9, 0.46, 0.46), [(legs[0] + legs[1]) / 2, top, z]);
    const span = legs[1] - legs[0];
    for (let i = 0; i < 6; i++) {
      const x = legs[0] + (span / 6) * (i + 0.5);
      b.add(steel, box(1.4, 0.12, 0.12), [x, top - 0.42, z], [0, 0, i % 2 ? 0.72 : -0.72]);
    }
    b.add(steel, box(legs[1] - legs[0], 0.14, 0.14), [(legs[0] + legs[1]) / 2, top - 0.78, z]);
  }

  // Trolley and hook block, parked differently per state.
  const trolleyX = state === "rising" ? 7.4 : state === "healthy" ? 10.2 : 6.0;
  b.add(M.ironDark, box(1.5, 0.5, zFront - zBack + 0.6), [trolleyX, top - 0.36, (zFront + zBack) / 2]);
  b.add(M.hazard, box(0.8, 0.42, 0.8), [trolleyX, top - 0.82, (zFront + zBack) / 2]);
  if (state !== "dormant") {
    const hookDrop = state === "rising" ? 3.4 : 1.4;
    b.add(M.ironDark, box(0.07, hookDrop, 0.07), [trolleyX, top - 0.9 - hookDrop / 2, (zFront + zBack) / 2]);
    b.add(M.ironDark, bevelBox(0.42, 0.42, 0.42, 0.06), [trolleyX, top - 0.9 - hookDrop, (zFront + zBack) / 2]);
  }
}

// ---------------------------------------------------------------------------
// The workshop, per state
// ---------------------------------------------------------------------------

const BAY_W = (WS.x1 - WS.x0) / WS.bays;
const RISE = 2.35;

/** Slab, footings and starter columns — what a stalled site actually looks like. */
function workshopFootings(b: PartsBuilder): void {
  const w = WS.x1 - WS.x0;
  const d = WS.z1 - WS.z0;
  const cx = (WS.x0 + WS.x1) / 2;
  const cz = (WS.z0 + WS.z1) / 2;

  b.add(M.concrete, box(w + 0.6, 0.34, d + 0.6), [cx, LOT_Y + 0.1, cz]);
  b.add(M.concreteDark, box(w + 0.9, 0.22, d + 0.9), [cx, LOT_Y - 0.02, cz]);

  // Pad foundations with protruding starter bars.
  for (let i = 0; i <= WS.bays; i++) {
    const x = WS.x0 + i * BAY_W;
    for (const z of [WS.z0 + 0.9, cz, WS.z1 - 0.9]) {
      b.add(M.concreteDark, box(0.9, 0.42, 0.9), [x, LOT_Y + 0.36, z]);
      for (const [ox, oz] of [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]]) {
        b.add(M.steelRust, post(0.035, 0.7, 4), [x + ox, LOT_Y + 0.85, z + oz]);
      }
    }
  }
}

/** Bare frame plus part-clad bays: the building visibly mid-assembly. */
function workshopFrame(b: PartsBuilder, cladBays: number): void {
  const d = WS.z1 - WS.z0;
  const cz = (WS.z0 + WS.z1) / 2;

  workshopFootings(b);

  // Primed steel rather than raw: a dark frame reads as a thicket of sticks at
  // this scale, a pale one reads as structure.
  const frame = M.steelPainted;

  // Columns and rafters across every bay.
  for (let i = 0; i <= WS.bays; i++) {
    const x = WS.x0 + i * BAY_W;
    for (const z of [WS.z0 + 0.5, cz, WS.z1 - 0.5]) {
      b.add(frame, box(0.34, WS.eave, 0.34), [x, LOT_Y + WS.eave / 2, z]);
    }
    b.add(frame, box(0.26, 0.26, d), [x, LOT_Y + WS.eave, cz]);
  }
  // Sawtooth rafters and purlins over the open bays.
  for (let i = 0; i < WS.bays; i++) {
    const xa = WS.x0 + i * BAY_W;
    const xb = xa + BAY_W;
    for (const z of [WS.z0 + 0.5, cz, WS.z1 - 0.5]) {
      pitch(b, frame, xa, LOT_Y + WS.eave, xb - 0.1, LOT_Y + WS.eave + RISE, 0.24, z, 0.24);
      b.add(frame, box(0.22, RISE, 0.22), [xb - 0.1, LOT_Y + WS.eave + RISE / 2, z]);
    }
    for (let p = 1; p <= 3; p++) {
      const t = p / 4;
      pitch(b, frame, xa, LOT_Y + WS.eave + RISE * t, xa + 0.1, LOT_Y + WS.eave + RISE * t, d, cz, 0.12);
    }
  }

  // Clad the first N bays: walls and roof sheets already on.
  for (let i = 0; i < cladBays; i++) {
    const xa = WS.x0 + i * BAY_W;
    const xb = xa + BAY_W;
    b.add(M.renderCream, box(BAY_W, WS.eave, 0.22), [(xa + xb) / 2, LOT_Y + WS.eave / 2, WS.z1]);
    b.add(M.renderCream, box(BAY_W, WS.eave, 0.22), [(xa + xb) / 2, LOT_Y + WS.eave / 2, WS.z0]);
    pitch(b, M.roofZinc, xa, LOT_Y + WS.eave, xb - 0.1, LOT_Y + WS.eave + RISE, WS.z1 - WS.z0, cz);
    b.add(M.glass, box(0.1, RISE - 0.3, WS.z1 - WS.z0 - 0.5), [xb - 0.05, LOT_Y + WS.eave + RISE / 2, cz]);
    b.add(
      M.renderCream,
      prismXY(
        [
          [xa, LOT_Y + WS.eave],
          [xb - 0.1, LOT_Y + WS.eave + RISE],
          [xb - 0.1, LOT_Y + WS.eave],
        ],
        0.22,
      ),
      [0, 0, WS.z1],
    );
  }
  if (cladBays > 0) {
    b.add(M.renderCream, box(0.22, WS.eave, WS.z1 - WS.z0), [WS.x0, LOT_Y + WS.eave / 2, cz]);
  }
}

/** The finished shed: clad walls, glazed north lights, roller door, dock. */
function workshopComplete(b: PartsBuilder, state: LotState): void {
  const worn = state === "struggling";
  const wall = worn ? M.renderCreamFaded : M.renderCream;
  const accentWall = worn ? M.renderTealFaded : M.renderTeal;
  const roof = worn ? M.roofZincWorn : M.roofZinc;
  const north = worn ? M.glassDim : M.glass;

  const w = WS.x1 - WS.x0;
  const d = WS.z1 - WS.z0;
  const cx = (WS.x0 + WS.x1) / 2;
  const cz = (WS.z0 + WS.z1) / 2;

  // Mass to eaves, on a plinth.
  b.add(wall, bevelBox(w, WS.eave, d, 0.07), [cx, LOT_Y + WS.eave / 2, cz]);
  b.add(M.concreteDark, box(w + 0.18, 0.62, d + 0.18), [cx, LOT_Y + 0.31, cz]);

  // Painted base band along the yard elevation, so the long wall has a datum.
  b.add(accentWall, box(0.1, 1.5, d - 0.6), [WS.x1 + 0.01, LOT_Y + 1.5, cz]);

  // Sawtooth: pitch, north light, end caps, gutter.
  for (let i = 0; i < WS.bays; i++) {
    const xa = WS.x0 + i * BAY_W;
    const xb = xa + BAY_W;
    pitch(b, roof, xa, LOT_Y + WS.eave, xb - 0.1, LOT_Y + WS.eave + RISE, d, cz);
    // Glazed vertical face with mullions.
    b.add(north, box(0.12, RISE - 0.28, d - 0.5), [xb - 0.05, LOT_Y + WS.eave + RISE / 2, cz]);
    for (let m = 1; m < 5; m++) {
      b.add(M.aluminium, box(0.16, RISE - 0.28, 0.09), [
        xb - 0.05,
        LOT_Y + WS.eave + RISE / 2,
        WS.z0 + 0.25 + m * ((d - 0.5) / 5),
      ]);
    }
    b.add(M.aluminium, box(0.2, 0.14, d - 0.4), [xb - 0.05, LOT_Y + WS.eave + RISE - 0.12, cz]);
    // End caps, both elevations.
    for (const z of [WS.z0, WS.z1]) {
      b.add(
        wall,
        prismXY(
          [
            [xa, LOT_Y + WS.eave],
            [xb - 0.1, LOT_Y + WS.eave + RISE],
            [xb - 0.1, LOT_Y + WS.eave],
          ],
          0.2,
        ),
        [0, 0, z],
      );
    }
    // Valley gutter.
    b.add(M.aluminium, box(0.24, 0.16, d), [xa, LOT_Y + WS.eave + 0.04, cz]);
  }

  // ------------------------------------------------------- yard elevation
  const doorX = 1.1;
  if (worn) {
    // Shutter down and a boarded personnel door.
    b.add(M.shutter, box(0.12, 4.0, 4.4), [WS.x1 + 0.04, LOT_Y + 2.0, doorX - 3.0]);
    for (let i = 0; i < 16; i++) {
      b.add(M.steel, box(0.14, 0.05, 4.4), [WS.x1 + 0.08, LOT_Y + 0.25 + i * 0.25, doorX - 3.0]);
    }
    b.add(M.boarding, box(0.1, 2.1, 1.0), [WS.x1 + 0.05, LOT_Y + 1.05, doorX + 2.4]);
  } else {
    // Open roller door with the shutter coiled above, and a loading dock.
    b.add(M.ironDark, box(0.3, 4.1, 4.5), [WS.x1 - 0.06, LOT_Y + 2.05, doorX - 3.0]);
    b.add(M.shutter, box(0.2, 0.62, 4.5), [WS.x1 + 0.06, LOT_Y + 3.9, doorX - 3.0]);
    b.add(M.steel, box(0.16, 4.3, 0.16), [WS.x1 + 0.06, LOT_Y + 2.15, doorX - 5.3]);
    b.add(M.steel, box(0.16, 4.3, 0.16), [WS.x1 + 0.06, LOT_Y + 2.15, doorX - 0.7]);
    b.add(M.glass, box(0.08, 2.2, 1.1), [WS.x1 + 0.03, LOT_Y + 1.15, doorX + 2.4]);
    b.add(M.timberDark, box(0.1, 2.2, 0.12), [WS.x1 + 0.06, LOT_Y + 1.15, doorX + 1.82]);
  }
  b.add(M.concreteDark, box(1.5, 0.95, 5.0), [WS.x1 + 0.72, LOT_Y + 0.48, doorX - 3.0]);
  b.add(M.hazard, box(1.55, 0.09, 0.22), [WS.x1 + 0.72, LOT_Y + 0.98, doorX - 5.4]);
  b.add(M.hazard, box(1.55, 0.09, 0.22), [WS.x1 + 0.72, LOT_Y + 0.98, doorX - 0.6]);

  // Canopy over the dock.
  pitch(b, roof, WS.x1 + 0.1, LOT_Y + 5.4, WS.x1 + 2.6, LOT_Y + 4.9, 5.6, doorX - 3.0, 0.14);
  b.add(M.steel, post(0.08, 4.9, 6), [WS.x1 + 2.4, LOT_Y + 2.45, doorX - 5.5]);
  b.add(M.steel, post(0.08, 4.9, 6), [WS.x1 + 2.4, LOT_Y + 2.45, doorX - 0.5]);

  // ------------------------------------------------------ plaza elevation
  // Glazed workshop frontage so the making is visible from the plaza.
  const glazeMat = worn ? M.glassDim : M.glass;
  b.add(M.ironDark, box(7.6, 3.5, 0.24), [-1.4, LOT_Y + 2.0, WS.z1 + 0.02]);
  b.add(glazeMat, box(7.2, 3.1, 0.08), [-1.4, LOT_Y + 2.0, WS.z1 + 0.1]);
  for (let i = 1; i < 5; i++) {
    b.add(M.aluminium, box(0.09, 3.1, 0.14), [-4.8 + i * 1.44, LOT_Y + 2.0, WS.z1 + 0.14]);
  }
  if (worn) {
    b.add(M.boarding, box(2.0, 1.5, 0.08), [-3.6, LOT_Y + 2.2, WS.z1 + 0.16]);
  }

  // Big painted wall sign on the blank end — legible identity, not a label.
  const signMat = state === "healthy" ? M.accent : M.renderClayFaded;
  b.add(signMat, box(0.09, 2.4, 6.4), [WS.x0 - 0.05, LOT_Y + 4.3, cz + 0.6]);
  b.add(worn ? M.signDead : M.plaster, box(0.11, 0.34, 5.2), [WS.x0 - 0.07, LOT_Y + 4.9, cz + 0.6]);
  b.add(worn ? M.signDead : M.plaster, box(0.11, 0.34, 3.4), [WS.x0 - 0.07, LOT_Y + 4.0, cz - 0.2]);

  // Roof-mounted extract units.
  for (const x of [-9.2, -3.6, 2.0]) {
    b.add(M.aluminium, bevelBox(1.0, 0.6, 1.0, 0.06), [x, LOT_Y + WS.eave + 0.4, WS.z0 + 2.2]);
  }
}

/** A half-finished extension left standing: the clearest read of "stalled". */
function stalledExtension(b: PartsBuilder, kit: InstanceKit, rng: Rng): void {
  const x0 = WS.x0 - 0.2;
  const x1 = WS.x0 - 6.4;
  const z0 = WS.z0 + 1.2;
  const z1 = WS.z0 + 7.4;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;

  // Poured slab going green at the edges.
  b.add(M.concrete, box(Math.abs(x1 - x0), 0.3, z1 - z0), [cx, LOT_Y + 0.09, cz]);

  // Rusting frame, one bay clad and abandoned.
  for (const x of [x0 - 0.4, cx, x1 + 0.4]) {
    for (const z of [z0 + 0.5, z1 - 0.5]) {
      b.add(M.steelRust, box(0.3, 4.6, 0.3), [x, LOT_Y + 2.3, z]);
    }
    b.add(M.steelRust, box(0.24, 0.24, z1 - z0), [x, LOT_Y + 4.6, cz]);
  }
  b.add(M.steelRust, box(Math.abs(x1 - x0), 0.24, 0.24), [cx, LOT_Y + 4.6, z0 + 0.5]);
  b.add(M.steelRust, box(Math.abs(x1 - x0), 0.24, 0.24), [cx, LOT_Y + 4.6, z1 - 0.5]);
  b.add(M.renderCreamFaded, box(0.18, 4.6, z1 - z0), [x1 + 0.4, LOT_Y + 2.3, cz]);

  // Tarp sagging over part of the frame.
  b.add(M.tarp, box(3.2, 0.1, z1 - z0 - 0.6), [cx + 0.6, LOT_Y + 4.66, cz], [0.06, 0, 0.04]);

  // Weeds through the slab, a drum, and a puddle of spoil.
  for (let i = 0; i < 14; i++) {
    kit.place(
      "weeds",
      [rng.range(x1, x0), LOT_Y + 0.24, rng.range(z0, z1)],
      rng.range(0, Math.PI),
      rng.range(0.8, 1.5),
    );
  }
  kit.place("drum", [x1 + 1.2, LOT_Y + 0.24, z1 - 1.3], 0.4);
  kit.place("drum", [x1 + 1.9, LOT_Y + 0.24, z1 - 1.0], 1.1);
  kit.place("gravelPile", [x0 - 1.4, LOT_Y + 0.24, z0 + 1.1], 0, 0.8);
}

// ---------------------------------------------------------------------------
// Surface, plaza, yard and life
// ---------------------------------------------------------------------------

/** Surface modules the state lays over the base ground. */
function surfaces(b: PartsBuilder, state: LotState, rng: Rng): void {
  const y = LOT_Y + 0.03;

  if (state === "rising") {
    // Temporary haul route: compacted stone from the street into the site.
    b.add(M.gravel, box(6.2, 0.09, 9.0), [8.4, y, -3.0]);
    b.add(M.gravel, box(4.6, 0.09, 4.4), [8.4, y, 3.4]);
    // Fresh asphalt patch where the crossover has been formed.
    b.add(M.asphalt, box(5.4, 0.07, 3.4), [8.4, SITE.groundY + 0.16, SITE.walkZ0 + 1.6]);
    b.add(M.roadLine, box(5.4, 0.02, 0.1), [8.4, SITE.groundY + 0.2, SITE.walkZ0 + 0.1]);
  }

  if (state === "healthy") {
    // Resurfaced plaza with a laid pattern and a drainage channel.
    b.add(M.plaster, box(PLAZA.x1 - PLAZA.x0, 0.06, PLAZA.z1 - PLAZA.z0), [
      (PLAZA.x0 + PLAZA.x1) / 2,
      y,
      (PLAZA.z0 + PLAZA.z1) / 2,
    ]);
    for (let i = 0; i <= 7; i++) {
      b.add(M.concreteDark, box(0.07, 0.02, PLAZA.z1 - PLAZA.z0), [
        PLAZA.x0 + i * ((PLAZA.x1 - PLAZA.x0) / 7),
        y + 0.04,
        (PLAZA.z0 + PLAZA.z1) / 2,
      ]);
    }
    b.add(M.ironDark, box(PLAZA.x1 - PLAZA.x0 - 0.6, 0.03, 0.24), [
      (PLAZA.x0 + PLAZA.x1) / 2,
      y + 0.05,
      PLAZA.z0 + 1.2,
    ]);
  }

  if (state === "struggling") {
    // Patched carriageway and cracked footway: many small repairs, none tidy.
    for (let i = 0; i < 9; i++) {
      const w = rng.range(1.4, 3.6);
      const d = rng.range(1.0, 2.4);
      b.add(M.asphaltPatched, box(w, 0.05, d), [
        rng.range(-24, 24),
        SITE.groundY + 0.12,
        rng.range(SITE.roadZ0 + 0.8, SITE.roadZ1 - 0.8),
      ]);
    }
    for (let i = 0; i < 6; i++) {
      b.add(M.sidewalkWorn, box(rng.range(0.9, 2.2), 0.04, rng.range(0.7, 1.6)), [
        rng.range(-14, 16),
        SITE.groundY + SITE.kerbH + 0.02,
        rng.range(SITE.walkZ0 + 0.4, SITE.kerbZ - 0.8),
      ]);
    }
    // Standing water and a sunken bay in the yard.
    b.add(M.water, box(3.4, 0.03, 2.2), [8.0, y - 0.01, -6.4]);
    b.add(M.concreteDark, box(3.9, 0.04, 2.7), [8.0, y - 0.015, -6.4]);
  }

  if (state === "dormant") {
    // The lot has gone back to dust: spoil spread over the old apron.
    b.add(M.dirtDry, box(17.0, 0.07, 12.0), [-2.0, y, -6.2]);
    b.add(M.dirt, box(9.0, 0.06, 6.0), [7.6, y, -6.6]);
  }
}

/** Display plaza: pergola, plinths, seating — the maker district's shopfront. */
function plaza(b: PartsBuilder, kit: InstanceKit, state: LotState, rng: Rng): void {
  const cx = (PLAZA.x0 + PLAZA.x1) / 2;

  if (state === "dormant" || state === "rising") {
    // No plaza yet. Site compound sits here instead.
    return;
  }

  const worn = state === "struggling";

  // Pergola: posts, beams and slatted top. Reads strongly in silhouette.
  const px0 = PLAZA.x0 + 0.8;
  const px1 = PLAZA.x1 - 0.8;
  const pz0 = PLAZA.z0 + 0.9;
  const pz1 = PLAZA.z1 - 1.4;
  const timber = worn ? M.timberDark : M.timber;
  for (const x of [px0, px1]) {
    for (const z of [pz0, pz1]) {
      b.add(timber, box(0.24, 3.3, 0.24), [x, LOT_Y + 1.65, z]);
      b.add(M.ironDark, box(0.4, 0.16, 0.4), [x, LOT_Y + 0.08, z]);
    }
    b.add(timber, box(0.2, 0.28, pz1 - pz0 + 0.6), [x, LOT_Y + 3.4, (pz0 + pz1) / 2]);
  }
  b.add(timber, box(px1 - px0 + 0.6, 0.26, 0.22), [cx, LOT_Y + 3.4, pz0]);
  b.add(timber, box(px1 - px0 + 0.6, 0.26, 0.22), [cx, LOT_Y + 3.4, pz1]);
  if (!worn) {
    for (let i = 0; i <= 12; i++) {
      b.add(timber, box(0.12, 0.14, pz1 - pz0), [
        px0 + i * ((px1 - px0) / 12),
        LOT_Y + 3.56,
        (pz0 + pz1) / 2,
      ]);
    }
    // Bunting-ish banner strip on the street side.
    b.add(M.accent, box(px1 - px0, 0.42, 0.06), [cx, LOT_Y + 3.1, pz1 + 0.12]);
  } else {
    // Half the slats gone, one hanging.
    for (let i = 0; i <= 12; i += 2) {
      b.add(timber, box(0.12, 0.14, pz1 - pz0), [
        px0 + i * ((px1 - px0) / 12),
        LOT_Y + 3.56,
        (pz0 + pz1) / 2,
      ]);
    }
    b.add(timber, box(0.12, 0.14, 1.8), [px0 + 3.2, LOT_Y + 3.2, pz1 - 1.2], [0.5, 0, 0]);
  }

  // Display plinths with product on them.
  const plinths: Vec3[] = [
    [PLAZA.x0 + 1.7, LOT_Y, PLAZA.z0 + 2.4],
    [cx + 0.3, LOT_Y, PLAZA.z0 + 1.9],
    [PLAZA.x1 - 1.6, LOT_Y, PLAZA.z0 + 3.0],
  ];
  const shown = worn ? 1 : 3;
  plinths.slice(0, shown).forEach((p, i) => {
    b.add(M.plaster, bevelBox(1.3, 0.85, 1.3, 0.05), [p[0], LOT_Y + 0.43, p[2]]);
    b.add(M.concreteDark, box(1.42, 0.08, 1.42), [p[0], LOT_Y + 0.87, p[2]]);
    const object = i % 2 === 0 ? M.accent : M.renderTeal;
    b.add(object, bevelBox(0.66, 0.62, 0.66, 0.12), [p[0], LOT_Y + 1.22, p[2]], [0, rng.range(0, 1), 0]);
    b.add(M.timberPale, box(0.9, 0.1, 0.9), [p[0], LOT_Y + 0.93, p[2]]);
  });
  if (worn) {
    // An empty plinth with its cover left on.
    b.add(M.plaster, bevelBox(1.3, 0.85, 1.3, 0.05), [cx + 0.3, LOT_Y + 0.43, PLAZA.z0 + 1.9]);
    b.add(M.tarp, box(1.5, 0.5, 1.5), [cx + 0.3, LOT_Y + 1.0, PLAZA.z0 + 1.9]);
  }

  // Steps up from the footway into the plaza.
  for (let i = 0; i < 2; i++) {
    b.add(M.kerb, slab(5.4, 0.11, 0.5, 0.03), [cx + 0.4, LOT_Y - 0.02 - i * 0.11, PLAZA.z1 + 0.3 + i * 0.5]);
  }

  // Furniture.
  Prop.bench(kit, [PLAZA.x0 + 1.2, LOT_Y, PLAZA.z1 - 2.2], 0.2);
  Prop.bench(kit, [PLAZA.x1 - 1.0, LOT_Y, PLAZA.z1 - 2.6], -0.35);
  Prop.planter(kit, [PLAZA.x0 + 0.4, LOT_Y, PLAZA.z0 + 0.6], 0.1);
  Prop.planter(kit, [PLAZA.x1 - 0.6, LOT_Y, PLAZA.z0 + 0.4], -0.2);
  if (!worn) {
    Prop.tree(kit, [PLAZA.x1 - 0.2, LOT_Y, PLAZA.z1 - 4.4], 0.8, 0.85);
    Prop.planter(kit, [cx - 2.4, LOT_Y, PLAZA.z1 - 0.9], 0);
  } else {
    kit.place("weeds", [cx - 2.0, LOT_Y + 0.02, PLAZA.z1 - 1.2], 0.4, 1.3);
    kit.place("weeds", [PLAZA.x0 + 2.6, LOT_Y + 0.02, PLAZA.z0 + 0.8], 1.2, 1.1);
  }
}

/** Loading yard contents. */
function yard(b: PartsBuilder, kit: InstanceKit, state: LotState, rng: Rng): void {
  const y = LOT_Y;

  // Boundary wall to the service lane, present in every state.
  b.add(M.concreteDark, box(YARD.x1 - YARD.x0 + 0.6, 1.9, 0.3), [
    (YARD.x0 + YARD.x1) / 2,
    y + 0.95,
    YARD.z0 - 0.2,
  ]);
  b.add(M.kerb, slab(YARD.x1 - YARD.x0 + 0.8, 0.14, 0.46, 0.03), [
    (YARD.x0 + YARD.x1) / 2,
    y + 1.96,
    YARD.z0 - 0.2,
  ]);

  if (state === "dormant") {
    kit.place("pallet", [YARD.x0 + 1.4, y, -9.0], 0.3);
    kit.place("pallet", [YARD.x0 + 1.5, y + 0.19, -9.05], 0.5);
    kit.place("drum", [YARD.x1 - 1.2, y, -10.4], 0);
    for (let i = 0; i < 10; i++) {
      kit.place("weeds", [rng.range(YARD.x0, YARD.x1), y + 0.02, rng.range(YARD.z0, 1.4)], rng.range(0, 3), rng.range(0.7, 1.3));
    }
    return;
  }

  if (state === "rising") {
    kit.place("dirtPile", [7.2, y, -8.6], 0.4, 1.15);
    kit.place("dirtPile", [10.4, y, -10.2], 1.2, 0.85);
    kit.place("gravelPile", [6.2, y, -11.2], 0.2, 1.0);
    for (let i = 0; i < 7; i++) {
      kit.place("pallet", [rng.range(5.6, 12.0), y + (i % 2) * 0.19, rng.range(-2.6, 1.4)], rng.range(0, 1.2));
    }
    for (let i = 0; i < 5; i++) Prop.crate(kit, [rng.range(5.8, 11.8), y, rng.range(-5.6, -3.2)], rng.range(0, 1.4));
    kit.place("drum", [11.8, y, -1.6], 0);
    kit.place("drum", [11.2, y, -1.2], 0.6);
    return;
  }

  // Healthy and struggling both keep the yard, at different intensity.
  const active = state === "healthy";
  kit.place("pallet", [YARD.x0 + 1.2, y, -1.2], 0.1);
  kit.place("pallet", [YARD.x0 + 1.25, y + 0.19, -1.25], 0.25);
  if (active) {
    kit.place("pallet", [YARD.x0 + 2.6, y, -2.4], 0.6);
    Prop.crate(kit, [YARD.x0 + 1.3, y + 0.38, -1.2], 0.15);
    Prop.crate(kit, [YARD.x0 + 2.7, y + 0.19, -2.4], 0.7);
    Prop.crate(kit, [YARD.x1 - 1.6, y, -9.6], 0.3);
    kit.place("crate", [YARD.x1 - 1.5, y + 0.7, -9.55], 0.4);
    for (const z of [-3.4, -5.0, -6.6]) kit.place("bollard", [YARD.x0 - 0.4, y, z], 0, 1.1);
  } else {
    kit.place("drum", [YARD.x1 - 1.0, y, -9.8], 0.2);
    kit.place("drum", [YARD.x1 - 1.7, y, -10.2], 0.9);
    for (let i = 0; i < 8; i++) {
      kit.place("weeds", [rng.range(YARD.x0 + 0.4, YARD.x1), y + 0.02, rng.range(YARD.z0 + 0.6, -2.0)], rng.range(0, 3), rng.range(0.7, 1.2));
    }
    // A skip left too long.
    b.add(M.steelRust, box(2.4, 1.15, 4.6), [10.4, y + 0.58, -3.2]);
    b.add(M.steelRust, box(2.7, 0.14, 4.9), [10.4, y + 1.2, -3.2]);
    b.add(M.timberDark, box(1.6, 0.5, 3.0), [10.4, y + 1.35, -3.2], [0.1, 0.3, 0]);
    for (const z of [-3.4, -6.6]) kit.place("bollard", [YARD.x0 - 0.4, y, z], 0, 1.1);
  }
}

/** Site compound: only present while the lot is dormant or building. */
function frontageBarrier(b: PartsBuilder, kit: InstanceKit, state: LotState, rng: Rng): void {
  const y = LOT_Y;
  const zLine = SITE.lotZ1 - 0.1;

  if (state === "dormant") {
    // Solid hoarding right across the frontage, with a locked gate.
    for (let x = -12.6; x <= 12.6; x += 2.44) {
      if (x > -1.6 && x < 3.4) continue; // gate opening
      Prop.hoarding(kit, [x, y, zLine], 0);
    }
    // Gate leaves, chained.
    b.add(M.hoardingRail, box(2.4, 2.3, 0.12), [-0.4, y + 1.15, zLine], [0, 0.06, 0]);
    b.add(M.hoardingRail, box(2.4, 2.3, 0.12), [2.2, y + 1.15, zLine], [0, -0.06, 0]);
    b.add(M.ironDark, box(1.1, 0.1, 0.1), [0.9, y + 1.2, zLine + 0.1]);
    // Site notice, face turned and blank.
    b.add(M.signBoard, box(1.5, 1.0, 0.08), [-4.6, y + 1.6, zLine + 0.08]);
    b.add(M.tarp, box(1.6, 1.1, 0.06), [-4.6, y + 1.6, zLine + 0.14]);
    // Returns down both flanks.
    for (let z = 4.2; z > -12.0; z -= 2.44) {
      Prop.hoarding(kit, [12.7, y, z], Math.PI / 2);
    }
    return;
  }

  if (state === "rising") {
    // Mesh panels, ballast feet, a wide vehicle gate and hazard tape.
    for (let x = -12.6; x <= 12.6; x += 2.36) {
      if (x > 5.4 && x < 11.6) continue; // vehicle entrance
      Prop.fence(kit, [x, y, zLine], 0);
    }
    for (let z = 4.2; z > -12.0; z -= 2.36) Prop.fence(kit, [12.8, y, z], Math.PI / 2);
    // Open gate leaf swung into the site.
    b.add(M.steel, box(2.9, 1.95, 0.09), [7.0, y + 1.0, zLine - 1.3], [0, 0.9, 0]);
    b.add(M.netting, box(2.8, 1.8, 0.03), [7.0, y + 1.0, zLine - 1.28], [0, 0.9, 0]);
    // Site board on the fence.
    b.add(M.signBoard, box(2.6, 1.5, 0.1), [-8.2, y + 1.5, zLine + 0.1]);
    b.add(M.accent, box(2.3, 0.34, 0.06), [-8.2, y + 1.94, zLine + 0.16]);
    b.add(M.plaster, box(2.3, 0.7, 0.05), [-8.2, y + 1.34, zLine + 0.16]);
    // Cones marking the crossover.
    for (let i = 0; i < 6; i++) {
      kit.place("cone", [5.2 + i * 1.3, SITE.groundY + SITE.kerbH, SITE.walkZ0 + 0.5], 0, rng.range(0.95, 1.1));
    }
    for (let i = 0; i < 4; i++) Prop.barrier(kit, [-3.0 + i * 2.1, y, zLine - 0.5], 0);
    return;
  }

  // Open frontage once trading: only bollards separate plaza from footway.
  for (let x = -3.2; x <= 4.6; x += 1.9) {
    kit.place("bollard", [x, SITE.groundY + SITE.kerbH, SITE.walkZ0 + 2.5], 0, 1.05);
  }
}

/** Scaffolding and the tower crane — the rising state's landmark additions. */
function constructionRig(b: PartsBuilder, kit: InstanceKit, rng: Rng): void {
  // Scaffold to the clad bays of the workshop.
  const lifts = [2.2, 4.4, 6.6];
  for (let x = WS.x0 - 0.4; x <= WS.x0 + BAY_W * 2.6; x += 2.1) {
    kit.place("scaff.post", [x, LOT_Y, WS.z1 + 0.9]);
    kit.place("scaff.post", [x, LOT_Y, WS.z1 + 1.75]);
    for (const h of lifts) {
      kit.place("scaff.deck", [x + 1.05, LOT_Y + h, WS.z1 + 1.32]);
      kit.place("scaff.rail", [x + 1.05, LOT_Y + h + 0.95, WS.z1 + 1.75]);
    }
  }
  // Debris netting over the scaffold face.
  b.add(M.netting, box(BAY_W * 3.0, 6.6, 0.04), [WS.x0 + BAY_W * 1.1, LOT_Y + 3.3, WS.z1 + 1.85]);

  // Tower crane at the west end: mast, cab, jib, counter-jib, hook.
  // Positioned and sized so the whole crane — mast, cab, jib and counter-jib —
  // sits inside the fixed frame. A landmark that leaves the frame stops being a
  // silhouette, and this camera never moves to find it.
  const mx = WS.x0 - 3.1;
  const mz = WS.z0 + 6.8;
  const mastH = 11.2;
  for (let i = 0; i < 6; i++) {
    const y = LOT_Y + 0.6 + i * 2.2;
    b.add(M.hazard, box(1.5, 0.14, 0.14), [mx, y, mz - 0.68]);
    b.add(M.hazard, box(1.5, 0.14, 0.14), [mx, y, mz + 0.68]);
    b.add(M.hazard, box(0.14, 0.14, 1.5), [mx - 0.68, y, mz]);
    b.add(M.hazard, box(0.14, 0.14, 1.5), [mx + 0.68, y, mz]);
  }
  for (const [ox, oz] of [[-0.68, -0.68], [0.68, -0.68], [-0.68, 0.68], [0.68, 0.68]]) {
    b.add(M.hazard, box(0.2, mastH, 0.2), [mx + ox, LOT_Y + mastH / 2, mz + oz]);
  }
  b.add(M.concreteDark, box(3.4, 0.7, 3.4), [mx, LOT_Y + 0.35, mz]);
  // Slewing ring and cab.
  b.add(M.steel, box(1.9, 0.6, 1.9), [mx, LOT_Y + mastH + 0.3, mz]);
  b.add(M.hazard, bevelBox(1.5, 1.4, 1.6, 0.14), [mx + 1.3, LOT_Y + mastH + 1.2, mz]);
  b.add(M.glassDim, box(1.2, 0.9, 0.08), [mx + 1.3, LOT_Y + mastH + 1.3, mz + 0.82]);
  // Jib reaching over the workshop, and the counter-jib with its block.
  const jibY = LOT_Y + mastH + 1.1;
  b.add(M.hazard, box(15.0, 0.42, 0.42), [mx + 7.7, jibY, mz]);
  for (let i = 0; i < 8; i++) {
    b.add(M.hazard, box(1.7, 0.1, 0.1), [mx + 1.4 + i * 1.85, jibY - 0.44, mz], [0, 0, i % 2 ? 0.62 : -0.62]);
  }
  b.add(M.hazard, box(15.0, 0.14, 0.14), [mx + 7.7, jibY - 0.86, mz]);
  b.add(M.hazard, box(5.0, 0.4, 0.4), [mx - 2.9, jibY, mz]);
  b.add(M.concreteDark, box(1.5, 1.2, 2.1), [mx - 4.8, jibY - 0.2, mz]);
  b.add(M.steel, box(0.16, 2.6, 0.16), [mx, jibY + 1.4, mz]);
  // Hoist rope and load.
  const hookX = mx + 9.6;
  b.add(M.ironDark, box(0.9, 0.32, 0.7), [hookX, jibY - 0.4, mz]);
  b.add(M.ironDark, box(0.06, 6.4, 0.06), [hookX, jibY - 3.7, mz]);
  b.add(M.steel, box(2.6, 0.22, 0.5), [hookX, jibY - 7.05, mz]);
  b.add(M.timberPale, box(2.4, 0.5, 1.1), [hookX, jibY - 7.45, mz]);

  // Spoil and materials around the base.
  kit.place("dirtPile", [mx + 2.6, LOT_Y, mz + 3.4], 0.5, 1.1);
  for (let i = 0; i < 5; i++) {
    kit.place("pallet", [rng.range(mx - 1.5, mx + 3.5), LOT_Y, rng.range(mz + 5.0, mz + 7.5)], rng.range(0, 1.5));
  }
}

/** An excavator, authored rather than instanced — there is only ever one. */
function excavator(b: PartsBuilder, x: number, z: number, yaw: number): void {
  const g = new PartsBuilder();
  const y = LOT_Y;

  // Tracks.
  for (const oz of [-0.86, 0.86]) {
    g.add(M.ironDark, bevelBox(3.5, 0.72, 0.62, 0.24), [0, y + 0.36, oz]);
    for (let i = 0; i < 7; i++) {
      g.add(M.tyre, box(0.3, 0.78, 0.68), [-1.5 + i * 0.5, y + 0.36, oz]);
    }
  }
  // Deck, house, cab, counterweight.
  g.add(M.plantMachine, bevelBox(2.7, 0.36, 2.0, 0.08), [0, y + 0.86, 0]);
  g.add(M.plantMachine, bevelBox(2.0, 1.15, 1.7, 0.14), [-0.45, y + 1.6, -0.1]);
  g.add(M.ironDark, bevelBox(0.8, 1.0, 1.8, 0.1), [-1.5, y + 1.5, 0]);
  g.add(M.plantMachine, bevelBox(1.0, 1.5, 1.1, 0.12), [0.75, y + 1.85, 0.5]);
  g.add(M.glassDim, box(0.06, 1.0, 0.9), [1.26, y + 2.0, 0.5]);
  g.add(M.glassDim, box(0.9, 1.0, 0.06), [0.75, y + 2.0, 1.03]);
  g.add(M.ironDark, box(1.1, 0.1, 1.2), [0.75, y + 2.62, 0.5]);

  // Boom, dipper, bucket — folded into a working pose.
  g.add(M.plantMachine, box(3.4, 0.42, 0.5), [1.9, y + 2.5, -0.35], [0, 0, 0.62]);
  g.add(M.steel, box(0.9, 0.2, 0.2), [1.4, y + 2.2, -0.35], [0, 0, 0.62]);
  g.add(M.plantMachine, box(2.6, 0.34, 0.42), [3.5, y + 2.5, -0.35], [0, 0, -0.95]);
  g.add(M.steel, box(0.8, 0.18, 0.18), [3.9, y + 2.9, -0.35], [0, 0, -0.95]);
  g.add(M.ironDark, bevelBox(0.9, 0.8, 0.9, 0.1), [4.5, y + 0.75, -0.35], [0, 0, 0.3]);
  for (let i = 0; i < 4; i++) {
    g.add(M.steel, box(0.22, 0.3, 0.1), [4.9, y + 0.5, -0.68 + i * 0.22], [0, 0, 0.3]);
  }

  const group = g.build("excavator");
  group.position.set(x, 0, z);
  group.rotation.y = yaw;
  group.updateMatrixWorld(true);

  // Fold the posed machine back into the parent builder's material buckets.
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const geo = child.geometry.clone().applyMatrix4(child.matrixWorld);
      b.add(child.material as THREE.Material, geo);
    }
  });
}

/** Who is on the block, and doing what. */
function life(kit: InstanceKit, state: LotState, rng: Rng): void {
  const walkY = SITE.groundY + SITE.kerbH;
  const lotY = LOT_Y;

  if (state === "dormant") {
    // One person passing on the far footway. Nothing else.
    Prop.person(kit, [-17.0, walkY, SITE.walkZ0 + 2.2], 1.5, true);
    return;
  }

  if (state === "rising") {
    const crew: Array<[number, number, number]> = [
      [6.9, -2.4, 2.3],
      [8.6, -5.2, 0.7],
      [4.6, -8.4, 1.9],
      [-6.4, -9.0, 0.4],
      [-9.6, -4.2, 2.8],
      [10.8, 0.4, 3.4],
    ];
    for (const [x, z, yaw] of crew) Prop.worker(kit, [x, lotY, z], yaw);
    Prop.worker(kit, [-2.2, lotY, 3.6], 1.1);
    Prop.person(kit, [-15.5, walkY, SITE.walkZ0 + 1.9], 1.5);
    Prop.van(kit, [9.2, lotY, 1.2], 0.06);
    return;
  }

  if (state === "healthy") {
    const strollers: Array<[number, number, number, boolean]> = [
      [-6.2, SITE.walkZ0 + 1.6, 1.5, false],
      [-3.0, SITE.walkZ0 + 2.4, 1.4, true],
      [3.4, SITE.walkZ0 + 1.4, -1.6, false],
      [11.5, SITE.walkZ0 + 2.2, -1.5, true],
      [-14.0, SITE.walkZ0 + 2.0, 1.5, false],
      [18.5, SITE.walkZ0 + 1.7, -1.5, true],
    ];
    for (const [x, z, yaw, alt] of strollers) Prop.person(kit, [x, walkY, z], yaw, alt);

    // Plaza visitors, browsing the plinths.
    Prop.person(kit, [-2.2, lotY, 2.2], 2.6, false);
    Prop.person(kit, [-1.4, lotY, 2.6], 3.4, true);
    Prop.person(kit, [2.6, lotY, 1.4], 4.0, false);

    // Yard: a delivery being loaded.
    Prop.van(kit, [8.6, lotY, -4.2], -0.04);
    Prop.worker(kit, [6.6, lotY, -2.6], 1.2);
    Prop.person(kit, [5.6, lotY, -5.4], 1.7, false);

    // Kerbside vehicle on the street.
    Prop.van(kit, [-9.0, SITE.groundY, SITE.roadZ0 + 2.0], Math.PI / 2 + 0.02);
    return;
  }

  // Struggling: the street still works, the lot does not.
  Prop.person(kit, [-11.5, walkY, SITE.walkZ0 + 1.8], 1.5, false);
  Prop.person(kit, [7.5, walkY, SITE.walkZ0 + 2.3], -1.5, true);
  Prop.person(kit, [20.0, walkY, SITE.walkZ0 + 1.6], -1.5, false);
  for (let i = 0; i < 3; i++) {
    kit.place("weeds", [rng.range(-12, 12), lotY + 0.02, rng.range(1.0, 4.8)], rng.range(0, 3), rng.range(0.8, 1.2));
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function buildOfferForge(kit: InstanceKit, state: LotState, seed: number): THREE.Group {
  const rng = new Rng(seed).fork(`offer-forge:${state}`);
  const b = new PartsBuilder();

  surfaces(b, state, rng.fork("surfaces"));

  // Persistent spine.
  streetUnit(b, state);
  ventStack(b, state);
  yardGantry(b, state);

  // The workshop, at whatever stage this state is in.
  if (state === "dormant") {
    workshopFootings(b);
  } else if (state === "rising") {
    workshopFrame(b, 2);
    constructionRig(b, kit, rng.fork("rig"));
    excavator(b, -4.2, -6.6, 0.72);
  } else {
    workshopComplete(b, state);
    if (state === "struggling") stalledExtension(b, kit, rng.fork("stalled"));
  }

  plaza(b, kit, state, rng.fork("plaza"));
  yard(b, kit, state, rng.fork("yard"));
  frontageBarrier(b, kit, state, rng.fork("frontage"));
  life(kit, state, rng.fork("life"));

  return b.build(`offer-forge:${state}`);
}
