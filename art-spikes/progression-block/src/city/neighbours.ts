import * as THREE from "three";

import { PartsBuilder, bevelBox, box, post, slab, wedge } from "../lib/geom";
import { Rng } from "../lib/rng";
import { M } from "../scene/materials";
import { Prop, type InstanceKit } from "./props";
import { SITE } from "./ground";

/**
 * Authored neighbours.
 *
 * The four buildings closest to camera used to be extruded boxes with a painted
 * window band, which put a placeholder directly in the foreground of every
 * frame. These are built with the same moulded construction as the lot: plinth,
 * pilasters, string course, cornice, reveals with cills, awnings, a signage
 * slot, and something on the roof.
 *
 * Deliberately only four. They frame the bottom of the composition; the Offer
 * Forge lot stays the focal point, so nothing here is taller or louder than the
 * workshop and the vent stack.
 */

type Facade = {
  bays: number;
  storeys: number;
  body: THREE.Material;
  trim: THREE.Material;
  awning?: THREE.Material;
  /** parapet | pitched | stepped | monitor */
  roof: "parapet" | "pitched" | "stepped" | "monitor";
  shopfront: boolean;
  signBand?: THREE.Material;
};

const STOREY = 2.7;

/**
 * One building, authored front-to-back.
 *
 * `facing` is the direction the shopfront looks along +Z after the group is
 * rotated, so the same function serves the across-street row and the flank.
 */
function authoredBuilding(
  b: PartsBuilder,
  spec: Facade,
  centre: [number, number],
  width: number,
  depth: number,
  yaw: number,
): void {
  const inner = new PartsBuilder();
  const h = spec.storeys * STOREY;
  const front = depth / 2;

  // ------------------------------------------------------------------ mass
  inner.add(spec.body, bevelBox(width, h, depth, 0.11), [0, h / 2, 0]);
  // Plinth and a shadow reveal above it.
  inner.add(M.concreteDark, box(width + 0.16, 0.62, depth + 0.16), [0, 0.31, 0]);
  inner.add(spec.trim, box(width + 0.2, 0.1, depth + 0.2), [0, 0.66, 0]);

  // Pilasters between bays: the single cheapest way to give a facade depth.
  const bayW = width / spec.bays;
  for (let i = 0; i <= spec.bays; i++) {
    const x = -width / 2 + i * bayW;
    inner.add(spec.trim, box(0.26, h - 0.3, 0.22), [x, h / 2, front + 0.02]);
  }

  // String course between ground and upper floors.
  inner.add(spec.trim, box(width + 0.18, 0.2, depth + 0.18), [0, STOREY - 0.35, 0]);

  // -------------------------------------------------------------- openings
  for (let s = spec.shopfront ? 1 : 0; s < spec.storeys; s++) {
    const y = s * STOREY + 1.65;
    for (let i = 0; i < spec.bays; i++) {
      const x = -width / 2 + bayW * (i + 0.5);
      // Reveal, glazing, mullion, transom, cill.
      inner.add(M.brickDark, box(bayW * 0.62, 1.75, 0.22), [x, y, front - 0.06]);
      inner.add(M.glass, box(bayW * 0.52, 1.55, 0.08), [x, y, front + 0.03]);
      inner.add(spec.trim, box(0.07, 1.55, 0.12), [x, y, front + 0.06]);
      inner.add(spec.trim, box(bayW * 0.52, 0.07, 0.12), [x, y + 0.2, front + 0.06]);
      inner.add(M.kerb, slab(bayW * 0.66, 0.11, 0.3, 0.03), [x, y - 0.92, front + 0.12]);
    }
  }

  // Ground floor: shopfront with an awning and a signage slot.
  if (spec.shopfront) {
    inner.add(M.ironDark, box(width - 0.7, 2.5, 0.3), [0, 1.45, front - 0.08]);
    inner.add(M.glass, box(width - 1.1, 2.1, 0.08), [0, 1.4, front + 0.04]);
    for (let i = 1; i < spec.bays; i++) {
      inner.add(M.aluminium, box(0.09, 2.1, 0.14), [-width / 2 + bayW * i, 1.4, front + 0.07]);
    }
    inner.add(M.timberDark, box(width - 1.1, 0.3, 0.14), [0, 0.42, front + 0.06]);
    // Signage slot — a blank board, no lettering.
    inner.add(M.signBoard, box(width - 0.9, 0.62, 0.14), [0, 2.86, front + 0.08]);
    if (spec.signBand) {
      inner.add(spec.signBand, box(width - 1.9, 0.34, 0.07), [0, 2.86, front + 0.16]);
    }
    if (spec.awning) {
      inner.add(spec.awning, box(width - 1.3, 0.11, 1.25), [0, 2.42, front + 0.66], [0.16, 0, 0]);
      inner.add(spec.awning, box(width - 1.3, 0.28, 0.09), [0, 2.28, front + 1.24]);
      inner.add(M.steel, post(0.04, 0.9, 5), [-(width - 1.6) / 2, 2.0, front + 1.2]);
      inner.add(M.steel, post(0.04, 0.9, 5), [(width - 1.6) / 2, 2.0, front + 1.2]);
    }
    // A step up to the door.
    inner.add(M.kerb, slab(1.5, 0.12, 0.5, 0.03), [width * 0.18, 0.14, front + 0.42]);
  }

  // ----------------------------------------------------------------- roof
  if (spec.roof === "parapet") {
    inner.add(spec.trim, box(width + 0.34, 0.62, depth + 0.34), [0, h + 0.25, 0]);
    inner.add(M.roofFelt, box(width - 0.2, 0.16, depth - 0.2), [0, h + 0.08, 0]);
    inner.add(M.fascia, box(width + 0.44, 0.14, depth + 0.44), [0, h + 0.58, 0]);
  } else if (spec.roof === "pitched") {
    inner.add(M.roofZinc, wedge(width + 0.5, 1.7, depth + 0.5), [0, h + 0.85, 0]);
    inner.add(M.fascia, box(width + 0.62, 0.2, 0.2), [0, h + 0.08, front + 0.28]);
  } else if (spec.roof === "stepped") {
    // Setback upper storey, which reads strongly from an eagle view.
    const setback = depth * 0.55;
    const upper = 1.55;
    inner.add(spec.body, bevelBox(width * 0.72, upper, setback, 0.1), [0, h + upper / 2, -depth * 0.14]);
    inner.add(spec.trim, box(width * 0.78, 0.34, setback + 0.2), [0, h + upper, -depth * 0.14]);
    inner.add(M.glass, box(width * 0.56, 0.95, 0.08), [0, h + 0.85, -depth * 0.14 + setback / 2]);
    inner.add(M.roofFelt, box(width - 0.2, 0.16, depth - 0.2), [0, h + 0.08, 0]);
    inner.add(spec.trim, box(width + 0.3, 0.5, depth + 0.3), [0, h + 0.2, 0]);
  } else {
    // Roof monitor: a raised glazed lantern, a nod to the maker district.
    inner.add(spec.trim, box(width + 0.3, 0.5, depth + 0.3), [0, h + 0.2, 0]);
    inner.add(M.roofFelt, box(width - 0.2, 0.16, depth - 0.2), [0, h + 0.08, 0]);
    inner.add(spec.body, box(width * 0.5, 1.1, depth * 0.42), [0, h + 0.7, 0]);
    inner.add(M.glass, box(width * 0.46, 0.7, depth * 0.44), [0, h + 0.8, 0]);
    inner.add(M.roofZinc, wedge(width * 0.56, 0.5, depth * 0.5), [0, h + 1.5, 0]);
  }

  return renderInto(b, inner, centre, yaw);
}

/** Roof clutter, varied per building so no two tops match. */
function roofDetail(
  b: PartsBuilder,
  kind: "tank" | "plant" | "stair" | "garden",
  centre: [number, number],
  h: number,
  width: number,
  depth: number,
  yaw: number,
  kit?: InstanceKit,
): void {
  const inner = new PartsBuilder();
  if (kind === "tank") {
    inner.add(M.timberDark, post(0.95, 1.7, 10), [width * 0.22, h + 1.75, -depth * 0.16]);
    inner.add(M.roofZinc, new THREE.ConeGeometry(1.05, 0.55, 10), [width * 0.22, h + 2.85, -depth * 0.16]);
    for (const [ox, oz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) {
      inner.add(M.steel, post(0.06, 0.95, 5), [width * 0.22 + ox, h + 0.5, -depth * 0.16 + oz]);
    }
  } else if (kind === "plant") {
    inner.add(M.aluminium, bevelBox(1.5, 0.72, 1.1, 0.08), [-width * 0.2, h + 0.5, depth * 0.1]);
    inner.add(M.ironDark, box(1.3, 0.1, 0.95), [-width * 0.2, h + 0.9, depth * 0.1]);
    inner.add(M.aluminium, bevelBox(0.9, 0.5, 0.8, 0.06), [width * 0.24, h + 0.4, -depth * 0.2]);
    inner.add(M.steel, post(0.09, 1.4, 6), [width * 0.06, h + 0.85, depth * 0.24]);
  } else if (kind === "stair") {
    inner.add(M.plaster, bevelBox(1.9, 1.6, 1.7, 0.1), [-width * 0.24, h + 0.95, -depth * 0.18]);
    inner.add(M.roofZinc, wedge(2.1, 0.45, 1.9), [-width * 0.24, h + 1.9, -depth * 0.18]);
    inner.add(M.ironDark, box(0.06, 0.9, depth * 0.5), [width * 0.3, h + 0.6, 0]);
  } else {
    inner.add(M.planter, box(width * 0.5, 0.42, 1.1), [0, h + 0.35, depth * 0.2]);
    inner.add(M.foliageDeep, box(width * 0.46, 0.3, 0.9), [0, h + 0.62, depth * 0.2]);
    inner.add(M.ironDark, box(width * 0.8, 0.05, 0.05), [0, h + 1.0, depth * 0.34]);
    for (let i = 0; i < 5; i++) {
      inner.add(M.ironDark, post(0.03, 0.95, 4), [-width * 0.4 + (i * width * 0.8) / 4, h + 0.52, depth * 0.34]);
    }
  }
  renderInto(b, inner, centre, yaw);
  void kit;
}

/** Bakes a locally-authored builder into the parent at a world transform. */
function renderInto(
  b: PartsBuilder,
  inner: PartsBuilder,
  centre: [number, number],
  yaw: number,
): void {
  const group = inner.build("neighbour-part");
  group.position.set(centre[0], 0, centre[1]);
  group.rotation.y = yaw;
  group.updateMatrixWorld(true);
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      b.add(child.material as THREE.Material, child.geometry.clone().applyMatrix4(child.matrixWorld));
    }
  });
}

/**
 * The four buildings that sit closest to camera, plus their street frontage.
 *
 * Placed along the far kerb so they read as the opposite side of the street,
 * and kept low so the workshop roofline stays the tallest thing in the middle
 * of the frame.
 */
export function buildAuthoredNeighbours(kit: InstanceKit, seed: number): THREE.Group {
  const rng = new Rng(seed).fork("authored-neighbours");
  const b = new PartsBuilder();

  const z = SITE.roadZ1 + 4.6;
  const specs: Array<{
    x: number;
    width: number;
    depth: number;
    facade: Facade;
    roof: "tank" | "plant" | "stair" | "garden";
  }> = [
    {
      x: -21,
      width: 12.5,
      depth: 10.5,
      facade: {
        bays: 3,
        storeys: 1,
        body: M.brick,
        trim: M.fascia,
        awning: M.canvasAwning,
        roof: "parapet",
        shopfront: true,
        signBand: M.renderTeal,
      },
      roof: "tank",
    },
    {
      x: -6.5,
      width: 14,
      depth: 11,
      facade: {
        bays: 4,
        storeys: 2,
        body: M.renderCream,
        trim: M.brickDark,
        awning: M.canvasAwning,
        roof: "stepped",
        shopfront: true,
        signBand: M.accent,
      },
      roof: "plant",
    },
    {
      x: 9.5,
      width: 13,
      depth: 10.5,
      facade: {
        bays: 3,
        storeys: 1,
        body: M.renderTeal,
        trim: M.fascia,
        roof: "monitor",
        shopfront: true,
        signBand: M.plaster,
      },
      roof: "garden",
    },
    {
      x: 24,
      width: 13.5,
      depth: 11,
      facade: {
        bays: 4,
        storeys: 2,
        body: M.renderClay,
        trim: M.fascia,
        awning: M.canvasAwning,
        roof: "pitched",
        shopfront: true,
        signBand: M.renderTeal,
      },
      roof: "stair",
    },
  ];

  for (const item of specs) {
    authoredBuilding(b, item.facade, [item.x, z], item.width, item.depth, Math.PI);
    roofDetail(
      b,
      item.roof,
      [item.x, z],
      item.facade.storeys * STOREY,
      item.width,
      item.depth,
      Math.PI,
    );
  }

  // Their own kerb and footway detail, so the row is not standing on bare road.
  const kerbY = SITE.groundY + SITE.kerbH;
  b.add(M.kerb, box(96, SITE.kerbH, 0.34), [0, SITE.groundY + SITE.kerbH / 2, SITE.roadZ1 + 0.17]);
  b.add(M.sidewalk, box(96, 0.18, 2.6), [0, kerbY - 0.09, SITE.roadZ1 + 1.5]);
  for (let x = -46; x <= 46; x += 2.4) {
    b.add(M.sidewalkWorn, box(0.05, 0.012, 2.6), [x, kerbY + 0.007, SITE.roadZ1 + 1.5]);
  }

  // Street trees and furniture on their side.
  for (const x of [-14.5, 2.0, 17.0, 31.0]) {
    b.add(M.dirt, box(1.4, 0.06, 1.4), [x, kerbY - 0.02, SITE.roadZ1 + 1.4]);
    Prop.tree(kit, [x, kerbY, SITE.roadZ1 + 1.4], rng.range(0, 6.2), rng.range(0.88, 1.06));
  }
  for (const x of [-27, -1.0, 22]) {
    kit.place("bollard", [x, kerbY, SITE.roadZ1 + 0.7], 0, 1.0);
  }

  return b.build("authored-neighbours");
}
