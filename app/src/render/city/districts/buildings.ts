import * as THREE from "three";

import { PartsBuilder, bevelBox, box, post, wedge } from "../../lib/geom";
import { Rng } from "../../lib/rng";
import { M } from "../../scene/materials";

/**
 * Shared building vocabulary.
 *
 * Every district composes from these rather than from primitives, which is what
 * keeps one grammar across the city: plinth, pilasters, reveals with cills,
 * string course, cornice, and something authored on the roof. What differs
 * between districts is which of these get used, at what grain, and with what
 * roof and street furniture — not the construction language.
 *
 * All of it is authored in local space so a parcel transform can place it.
 */

export type StateName = "dormant" | "rising" | "healthy" | "struggling";

export type Skin = {
  body: THREE.Material;
  trim: THREE.Material;
  base: THREE.Material;
  glass: THREE.Material;
  roof: THREE.Material;
  accent: THREE.Material;
};

export function skinFor(state: StateName, palette: Skin): Skin {
  if (state !== "struggling") return palette;
  return {
    ...palette,
    body: palette.body === M.renderCream ? M.renderCreamFaded : palette.body,
    glass: M.glassDim,
    roof: M.roofZincWorn,
    accent: M.signDead,
  };
}

// ---------------------------------------------------------------------------
// Which way a building is looked at
// ---------------------------------------------------------------------------

/** The four elevations of a mass authored with its frontage toward +Z. */
export type Face = "front" | "back" | "left" | "right";
export type Faces = readonly Face[];

export const EVERY_FACE: Faces = ["front", "back", "left", "right"];

/** The turn that takes an elevation authored facing +Z onto a given face. */
const FACE_YAW: Record<Face, number> = {
  front: 0,
  right: Math.PI / 2,
  back: Math.PI,
  left: -Math.PI / 2,
};

/**
 * The elevations the camera can actually see.
 *
 * The stage never orbits. It is parked to the +X +Z of whatever it looks at, so
 * exactly two of a rectangular mass's four walls are ever on screen, and which
 * two depends on how the parcel is turned. Six of the eleven parcels here are
 * turned to face away from it, and every one of them was having its windows,
 * pilasters and shopfront authored onto walls nobody can look at while the two
 * on screen stayed blank render. That is what made half the city read as
 * extruded blocks instead of buildings.
 *
 * Detailing what is seen rather than a fixed three faces is also cheaper: two
 * elevations of openings instead of three.
 */
export function facesInView(worldYaw: number): Faces {
  return EVERY_FACE.filter((face) => {
    const a = FACE_YAW[face] + worldYaw;
    // The outward normal, turned into the world, against the camera axis.
    return Math.sin(a) + Math.cos(a) > 0.05;
  });
}

/** The width of a face, and the extent of the mass across it. */
function faceSpan(face: Face, w: number, d: number): [number, number] {
  return face === "front" || face === "back" ? [w, d] : [d, w];
}

/**
 * Authors an elevation facing +Z and turns it onto `face`.
 *
 * Everything in this module is written once, for the frontage, and placed by
 * this. Writing each elevation out longhand is how the flanks ended up with a
 * different and much poorer vocabulary than the front.
 */
function onFace(b: PartsBuilder, face: Face, author: (t: PartsBuilder) => void): void {
  const tmp = new PartsBuilder();
  author(tmp);
  const group = tmp.build("elevation");
  group.rotation.y = FACE_YAW[face];
  group.updateMatrixWorld(true);
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      b.add(child.material as THREE.Material, child.geometry.clone().applyMatrix4(child.matrixWorld));
    }
  });
}

/** Plinth, pilasters, string course and cornice — the common facade frame. */
function facadeFrame(
  b: PartsBuilder,
  skin: Skin,
  w: number,
  d: number,
  h: number,
  bays: number,
  groundH: number,
  seen: Faces,
): void {
  b.add(skin.base, box(w + 0.18, groundH * 0.28, d + 0.18), [0, groundH * 0.14, 0]);
  b.add(skin.trim, box(w + 0.22, 0.12, d + 0.22), [0, groundH * 0.28 + 0.06, 0]);
  for (const face of seen) {
    const [faceW, across] = faceSpan(face, w, d);
    const count = Math.max(2, Math.round(bays * (faceW / w)));
    onFace(b, face, (t) => {
      for (let i = 0; i <= count; i++) {
        t.add(skin.trim, box(0.26, h - 0.4, 0.2), [-faceW / 2 + (faceW / count) * i, h / 2, across / 2 + 0.02]);
      }
    });
  }
  b.add(skin.trim, box(w + 0.2, 0.22, d + 0.2), [0, groundH, 0]);
}

/** A window bay: reveal, glazing, mullion, transom, cill. */
export function windowBay(
  b: PartsBuilder,
  skin: Skin,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
): void {
  // Four boxes, deliberately. A window is repeated hundreds of times across the
  // city, so the reveal, glazing, mullion and cill are the whole budget — the
  // transom and the bevelled cill that used to be here cost more triangles than
  // the entire road network and are invisible at this camera distance.
  b.add(M.brickDark, box(w + 0.16, h + 0.16, 0.2), [x, y, z - 0.06]);
  b.add(skin.glass, box(w, h, 0.07), [x, y, z + 0.03]);
  b.add(skin.trim, box(0.07, h, 0.11), [x, y, z + 0.06]);
  b.add(M.kerb, box(w + 0.3, 0.1, 0.24), [x, y - h / 2 - 0.11, z + 0.1]);
}

/**
 * Continuous glazed band, for the taller commercial masses.
 *
 * Every face gets both the glass and the mullions. The mullions used to run in
 * one direction only, and the pair at each end — flush with the side walls and
 * as deep as the whole building — sealed both flanks under a solid slab of trim
 * colour. A tower read as a glass front stuck to a painted blank wall.
 */
export function glazingBand(
  b: PartsBuilder,
  skin: Skin,
  y: number,
  w: number,
  d: number,
  h: number,
  mullions: number,
): void {
  b.add(skin.glass, box(w * 0.92, h, d + 0.08), [0, y, 0]);
  b.add(skin.glass, box(w + 0.08, h, d * 0.92), [0, y, 0]);

  // Intermediate mullions, front and back at once: one box serves both faces.
  for (let i = 1; i < mullions; i++) {
    b.add(skin.trim, box(0.12, h + 0.1, d + 0.14), [-w / 2 + (w / mullions) * i, y, 0]);
  }
  // And along the flanks, which are as visible as the frontage from a fixed
  // isometric camera and were carrying nothing.
  const ribs = Math.max(2, Math.round(mullions * (d / Math.max(w, 0.001))));
  for (let i = 1; i < ribs; i++) {
    b.add(skin.trim, box(w + 0.14, h + 0.1, 0.12), [0, y, -d / 2 + (d / ribs) * i]);
  }
  // The four corners as columns rather than as full-depth panels.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.add(skin.trim, box(0.2, h + 0.1, 0.2), [(sx * w) / 2, y, (sz * d) / 2]);
    }
  }

  b.add(skin.trim, box(w + 0.14, 0.14, d + 0.14), [0, y + h / 2, 0]);
  b.add(skin.trim, box(w + 0.14, 0.14, d + 0.14), [0, y - h / 2, 0]);
}

/** Shopfront with awning and signage slot. */
export function shopfront(
  b: PartsBuilder,
  skin: Skin,
  w: number,
  z: number,
  state: StateName,
  awningMaterial = M.canvasAwning,
): void {
  const shut = state === "struggling" || state === "dormant";
  b.add(M.ironDark, box(w - 0.6, 2.6, 0.3), [0, 1.5, z - 0.08]);
  if (shut) {
    b.add(M.shutter, box(w - 1.0, 2.3, 0.1), [0, 1.42, z + 0.04]);
    for (let i = 0; i < 11; i++) {
      b.add(M.steel, box(w - 1.0, 0.04, 0.13), [0, 0.4 + i * 0.21, z + 0.05]);
    }
  } else {
    b.add(skin.glass, box(w - 1.0, 2.2, 0.08), [0, 1.45, z + 0.04]);
    for (let i = 1; i < 4; i++) {
      b.add(M.aluminium, box(0.09, 2.2, 0.14), [-w / 2 + (w / 4) * i, 1.45, z + 0.07]);
    }
    b.add(M.timberDark, box(w - 1.0, 0.28, 0.14), [0, 0.4, z + 0.06]);
  }
  b.add(M.signBoard, box(w - 0.8, 0.6, 0.14), [0, 2.95, z + 0.08]);
  b.add(state === "healthy" ? M.signLit : M.signDead, box(w - 1.8, 0.32, 0.07), [0, 2.95, z + 0.16]);
  if (!shut) {
    b.add(awningMaterial, box(w - 1.2, 0.11, 1.2), [0, 2.5, z + 0.64], [0.16, 0, 0]);
    b.add(awningMaterial, box(w - 1.2, 0.26, 0.09), [0, 2.36, z + 1.2]);
  }
}

export type RoofKind = "parapet" | "pitched" | "stepped" | "monitor" | "terrace" | "sawtooth";

export function roofOf(
  b: PartsBuilder,
  skin: Skin,
  kind: RoofKind,
  w: number,
  d: number,
  h: number,
  rng: Rng,
): void {
  if (kind === "parapet") {
    b.add(skin.trim, box(w + 0.34, 0.66, d + 0.34), [0, h + 0.27, 0]);
    b.add(M.roofFelt, box(w - 0.2, 0.16, d - 0.2), [0, h + 0.08, 0]);
    b.add(M.fascia, box(w + 0.46, 0.14, d + 0.46), [0, h + 0.62, 0]);
  } else if (kind === "pitched") {
    b.add(skin.roof, wedge(w + 0.5, 1.9, d + 0.5), [0, h + 0.95, 0]);
    b.add(M.fascia, box(w + 0.62, 0.2, 0.2), [0, h + 0.1, d / 2 + 0.3]);
  } else if (kind === "stepped") {
    const upper = 2.2;
    b.add(skin.body, bevelBox(w * 0.7, upper, d * 0.6, 0.1), [0, h + upper / 2, -d * 0.12]);
    b.add(skin.trim, box(w * 0.76, 0.36, d * 0.64), [0, h + upper, -d * 0.12]);
    b.add(skin.glass, box(w * 0.56, 1.2, 0.08), [0, h + 1.0, -d * 0.12 + d * 0.3]);
    b.add(skin.trim, box(w + 0.32, 0.5, d + 0.32), [0, h + 0.22, 0]);
    b.add(M.roofFelt, box(w - 0.2, 0.16, d - 0.2), [0, h + 0.08, 0]);
  } else if (kind === "monitor") {
    b.add(skin.trim, box(w + 0.3, 0.5, d + 0.3), [0, h + 0.2, 0]);
    b.add(M.roofFelt, box(w - 0.2, 0.16, d - 0.2), [0, h + 0.08, 0]);
    b.add(skin.body, box(w * 0.46, 1.2, d * 0.4), [0, h + 0.75, 0]);
    b.add(skin.glass, box(w * 0.42, 0.75, d * 0.42), [0, h + 0.85, 0]);
    b.add(skin.roof, wedge(w * 0.52, 0.5, d * 0.48), [0, h + 1.6, 0]);
  } else if (kind === "terrace") {
    // Occupied roof: deck, planters, rail, pergola. Creator Quarter's signature.
    b.add(skin.trim, box(w + 0.3, 0.42, d + 0.3), [0, h + 0.18, 0]);
    b.add(M.timberPale, box(w - 0.6, 0.1, d - 0.6), [0, h + 0.12, 0]);
    b.add(M.planter, box(w - 1.2, 0.36, 0.9), [0, h + 0.35, -d / 2 + 0.9]);
    b.add(M.foliageDeep, box(w - 1.4, 0.3, 0.7), [0, h + 0.62, -d / 2 + 0.9]);
    for (const side of [-1, 1]) {
      b.add(M.ironDark, box(w, 0.06, 0.06), [0, h + 1.05, side * (d / 2 - 0.15)]);
      for (let i = 0; i <= 6; i++) {
        b.add(M.ironDark, post(0.03, 0.95, 4), [-w / 2 + (w / 6) * i, h + 0.6, side * (d / 2 - 0.15)]);
      }
    }
    if (rng.chance(0.6)) {
      const px = rng.range(-w * 0.2, w * 0.2);
      for (const ox of [-1.4, 1.4]) {
        for (const oz of [-1.2, 1.2]) {
          b.add(M.timber, post(0.08, 2.3, 5), [px + ox, h + 1.3, oz]);
        }
      }
      b.add(M.timber, box(3.4, 0.14, 2.9), [px, h + 2.45, 0]);
      for (let i = 0; i <= 6; i++) {
        b.add(M.timber, box(0.1, 0.1, 2.9), [px - 1.5 + i * 0.5, h + 2.56, 0]);
      }
    }
  } else {
    // Sawtooth, the maker signature.
    const bays = Math.max(3, Math.round(w / 3));
    const bayW = w / bays;
    const rise = 2.2;
    for (let i = 0; i < bays; i++) {
      const xa = -w / 2 + i * bayW;
      const xb = xa + bayW;
      const len = Math.hypot(bayW, rise);
      b.add(skin.roof, box(len, 0.16, d), [(xa + xb) / 2, h + rise / 2, 0], [0, 0, Math.atan2(rise, bayW)]);
      // A sawtooth exists to bring light in, so the glazing has to read as
      // bright bands rather than black stripes — unless the shed is failing.
      const lights = skin.glass === M.glassDim ? M.glassDim : M.glassLit;
      b.add(lights, box(0.12, rise - 0.3, d - 0.5), [xb - 0.05, h + rise / 2, 0]);
      for (let m = 1; m < 4; m++) {
        b.add(M.aluminium, box(0.16, rise - 0.3, 0.09), [xb - 0.05, h + rise / 2, -d / 2 + (d / 4) * m]);
      }
      for (const z of [-d / 2, d / 2]) {
        const shape = new THREE.Shape();
        shape.moveTo(xa, h);
        shape.lineTo(xb - 0.1, h + rise);
        shape.lineTo(xb - 0.1, h);
        shape.closePath();
        const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.2, bevelEnabled: false });
        geo.translate(0, 0, z - 0.1);
        b.add(skin.body, geo);
      }
      b.add(M.aluminium, box(0.24, 0.16, d), [xa, h + 0.04, 0]);
    }
  }
}

/**
 * One elevation of punched openings.
 *
 * `faceW` is the width of the face being glazed and `across` the extent of the
 * mass behind it, so the same routine serves the frontage and both flanks.
 */
function punchedFacade(
  b: PartsBuilder,
  skin: Skin,
  face: Face,
  faceW: number,
  across: number,
  h: number,
  bays: number,
  storeyH: number,
  groundH: number,
  storeys: number,
  skipGround: boolean,
): void {
  const bayW = faceW / bays;
  const skip = skipGround ? 1 : 0;
  onFace(b, face, (t) => {
    for (let s = skip; s < storeys; s++) {
      const y = groundH + (s - skip) * storeyH + storeyH * 0.5;
      if (y + 1 > h) break;
      for (let i = 0; i < bays; i++) {
        windowBay(t, skin, -faceW / 2 + bayW * (i + 0.5), y, across / 2 + 0.02, bayW * 0.56, storeyH * 0.58);
      }
    }
  });
}

/**
 * The ground floor of an elevation that is not the shop window.
 *
 * A terrace seen from its yard, or a block seen from the service street, still
 * has a way in, light at the bottom and something to carry the rain. Leaving
 * the lowest three metres of a wall bare is what makes a building look like it
 * is standing on a plinth of nothing, and on the plots that face away from the
 * camera that bare strip is the first thing the eye lands on.
 */
function rearElevation(
  b: PartsBuilder,
  skin: Skin,
  face: Face,
  faceW: number,
  across: number,
  groundH: number,
  state: StateName,
): void {
  const z = across / 2 + 0.02;
  const shut = state === "struggling" || state === "dormant";
  onFace(b, face, (t) => {
    // Door in a recessed reveal, off to one side, under a small hood.
    const dx = -faceW * 0.28;
    t.add(skin.base, box(1.7, 2.5, 0.2), [dx, 1.25, z - 0.06]);
    t.add(shut ? M.shutter : M.timberDark, box(1.15, 2.2, 0.09), [dx, 1.1, z + 0.03]);
    if (!shut) t.add(skin.glass, box(0.8, 0.5, 0.05), [dx, 1.95, z + 0.06]);
    t.add(skin.trim, box(2.1, 0.14, 0.55), [dx, 2.62, z + 0.22]);

    // Two openings alongside it, sized to whatever is left of the wall.
    const rest = faceW * 0.5;
    for (const ox of [rest * 0.32, rest * 0.82]) {
      windowBay(t, skin, faceW * 0.06 + ox - rest * 0.5 + faceW * 0.22, groundH * 0.55, z, rest * 0.34, groundH * 0.44);
    }

    // Rainwater goods at the corners, and a meter box. Small, and the things
    // that stop a flat wall reading as a render error.
    for (const sx of [-1, 1]) {
      t.add(M.aluminium, post(0.1, groundH + 0.4, 5), [(sx * (faceW - 0.4)) / 2, (groundH + 0.4) / 2, z + 0.02]);
    }
    t.add(M.aluminium, box(0.5, 0.7, 0.16), [faceW * 0.36, 1.0, z + 0.04]);
  });
}

/**
 * A populated roof.
 *
 * The camera looks down at roughly thirty-five degrees, so a roof is not the
 * top edge of a building — it is a facade, and on a tower it is the largest one
 * the player sees. Every roof in the city used to be a flat plane with one
 * optional object on it, which read as an unfinished model however good the
 * elevations were.
 *
 * Laid out on a slot grid rather than by free scatter, so nothing intersects
 * and a wide roof gets more on it than a narrow one without any of it moving
 * when a neighbouring building changes.
 */
export function roofscape(
  b: PartsBuilder,
  skin: Skin,
  w: number,
  d: number,
  h: number,
  rng: Rng,
  state: StateName,
): void {
  const cols = Math.max(1, Math.min(4, Math.floor(w / 3.2)));
  const rows = Math.max(1, Math.min(4, Math.floor(d / 3.2)));
  const slots: Array<[number, number]> = [];
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      slots.push([
        -w / 2 + (w / cols) * (c + 0.5),
        -d / 2 + (d / rows) * (r + 0.5),
      ]);
    }
  }
  rng.shuffle(slots);

  // A run round the edge: the walkway and the handrail that stop a roof reading
  // as a lid. Cheap, and it is what the eye reads first from above.
  b.add(M.roofFelt, box(w - 0.5, 0.05, d - 0.5), [0, h + 0.19, 0]);
  for (const sz of [-1, 1]) {
    b.add(M.aluminium, box(w - 1.4, 0.06, 0.5), [0, h + 0.24, (sz * (d - 1.6)) / 2]);
  }

  const wanted = Math.min(slots.length, 2 + Math.floor((w * d) / 34));
  const kinds = ["stair", "plant", "tank", "vent", "dish"] as const;
  for (let i = 0; i < wanted; i++) {
    const [x, z] = slots[i];
    const kind = i === 0 ? "stair" : kinds[1 + ((i + Math.floor(w)) % 4)];
    roofItem(b, skin, kind, x, z, h, rng, state);
  }
}

/** One thing standing on a roof, centred on the point it was given. */
function roofItem(
  b: PartsBuilder,
  skin: Skin,
  kind: "tank" | "plant" | "stair" | "dish" | "vent",
  x: number,
  z: number,
  h: number,
  rng: Rng,
  state: StateName,
): void {
  if (kind === "stair") {
    // Lift and stair overrun: the one thing every roof of this size really has.
    const sw = rng.range(1.9, 2.5);
    b.add(skin.body, bevelBox(sw, 2.2, sw * 0.86, 0.08), [x, h + 1.3, z]);
    b.add(M.roofZinc, wedge(sw + 0.3, 0.45, sw * 0.86 + 0.3), [x, h + 2.62, z]);
    b.add(M.ironDark, box(sw * 0.42, 1.5, 0.1), [x, h + 0.95, z + (sw * 0.86) / 2 + 0.06]);
  } else if (kind === "tank") {
    b.add(M.steel, post(0.06, 1.0, 5), [x - 0.55, h + 0.7, z - 0.55]);
    b.add(M.steel, post(0.06, 1.0, 5), [x + 0.55, h + 0.7, z - 0.55]);
    b.add(M.steel, post(0.06, 1.0, 5), [x - 0.55, h + 0.7, z + 0.55]);
    b.add(M.steel, post(0.06, 1.0, 5), [x + 0.55, h + 0.7, z + 0.55]);
    b.add(M.timberDark, post(0.8, 1.5, 9), [x, h + 1.95, z]);
    b.add(state === "struggling" ? M.roofZincWorn : M.roofZinc, new THREE.ConeGeometry(0.9, 0.45, 9), [x, h + 2.9, z]);
  } else if (kind === "plant") {
    // Air handling: two units on a frame, which is what a commercial roof is.
    b.add(M.ironDark, box(2.4, 0.12, 1.9), [x, h + 0.28, z]);
    b.add(M.aluminium, bevelBox(1.1, 0.62, 0.85, 0.05), [x - 0.55, h + 0.65, z]);
    b.add(M.aluminium, bevelBox(1.1, 0.62, 0.85, 0.05), [x + 0.55, h + 0.65, z]);
    b.add(M.steel, box(0.9, 0.05, 0.9), [x - 0.55, h + 0.98, z]);
    b.add(M.steel, box(0.9, 0.05, 0.9), [x + 0.55, h + 0.98, z]);
  } else if (kind === "dish") {
    b.add(M.steel, post(0.07, 2.6, 6), [x, h + 1.5, z]);
    b.add(M.aluminium, new THREE.CylinderGeometry(0.62, 0.62, 0.1, 10), [x, h + 2.5, z], [1.0, 0, 0.3]);
    b.add(M.ironDark, box(0.8, 0.06, 0.8), [x, h + 0.24, z]);
  } else {
    for (const ox of [-0.7, 0, 0.7]) {
      b.add(M.aluminium, post(0.24, 0.7, 7), [x + ox, h + 0.55, z]);
      b.add(M.steel, new THREE.ConeGeometry(0.3, 0.2, 7), [x + ox, h + 1.0, z]);
    }
    b.add(M.ironDark, box(2.2, 0.08, 0.7), [x, h + 0.24, z]);
  }
}

/**
 * Industrial cladding: ribs, a plinth, and a clerestory under the eaves.
 *
 * A working shed is a big simple mass, which is the point of it, but a big
 * simple mass with nothing on its walls is a block of foam. Profiled sheeting
 * and a high glazing band cost four boxes a bay and turn the same silhouette
 * into a building. Authored about the origin so a caller can place it.
 */
export function shedCladding(
  b: PartsBuilder,
  skin: Skin,
  w: number,
  d: number,
  h: number,
  state: StateName,
): void {
  const rib = state === "struggling" ? M.renderCreamFaded : skin.trim;
  const lights = state === "struggling" ? M.glassDim : M.glassLit;

  b.add(M.concreteDark, box(w + 0.24, 1.0, d + 0.24), [0, 0.5, 0]);
  b.add(skin.trim, box(w + 0.3, 0.22, d + 0.3), [0, 1.02, 0]);

  // Sheeting ribs on all four elevations.
  const along = Math.max(3, Math.round(w / 2.2));
  for (let i = 1; i < along; i++) {
    b.add(rib, box(0.12, h - 1.3, d + 0.16), [-w / 2 + (w / along) * i, 1.1 + (h - 1.3) / 2, 0]);
  }
  const across = Math.max(3, Math.round(d / 2.2));
  for (let i = 1; i < across; i++) {
    b.add(rib, box(w + 0.16, h - 1.3, 0.12), [0, 1.1 + (h - 1.3) / 2, -d / 2 + (d / across) * i]);
  }

  // Clerestory: the band of daylight every shed of this kind has, and the one
  // thing that tells the eye how tall the wall is.
  const cy = h - 1.35;
  if (cy > 2.6) {
    b.add(lights, box(w * 0.94, 1.15, d + 0.1), [0, cy, 0]);
    b.add(lights, box(w + 0.1, 1.15, d * 0.94), [0, cy, 0]);
    for (let i = 0; i <= along; i++) {
      b.add(M.aluminium, box(0.14, 1.3, d + 0.18), [-w / 2 + (w / along) * i, cy, 0]);
    }
    for (let i = 0; i <= across; i++) {
      b.add(M.aluminium, box(w + 0.18, 1.3, 0.14), [0, cy, -d / 2 + (d / across) * i]);
    }
    b.add(skin.trim, box(w + 0.22, 0.2, d + 0.22), [0, cy + 0.68, 0]);
    b.add(skin.trim, box(w + 0.22, 0.2, d + 0.22), [0, cy - 0.68, 0]);
  }

  // Rainwater goods on the corners: small, and the thing that reads as "built".
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.add(M.aluminium, post(0.11, h - 1.1, 6), [(sx * (w - 0.2)) / 2, 1.1 + (h - 1.1) / 2, (sz * (d - 0.2)) / 2]);
    }
  }
}

/** Roof clutter so no two tops match. */
export function roofClutter(
  b: PartsBuilder,
  kind: "tank" | "plant" | "stair" | "dish" | "vent",
  w: number,
  d: number,
  h: number,
): void {
  if (kind === "tank") {
    b.add(M.timberDark, post(0.95, 1.8, 10), [w * 0.24, h + 1.85, -d * 0.18]);
    b.add(M.roofZinc, new THREE.ConeGeometry(1.05, 0.55, 10), [w * 0.24, h + 2.95, -d * 0.18]);
    for (const [ox, oz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) {
      b.add(M.steel, post(0.06, 0.95, 5), [w * 0.24 + ox, h + 0.5, -d * 0.18 + oz]);
    }
  } else if (kind === "plant") {
    b.add(M.aluminium, bevelBox(1.6, 0.8, 1.2, 0.08), [-w * 0.22, h + 0.55, d * 0.12]);
    b.add(M.ironDark, box(1.4, 0.1, 1.0), [-w * 0.22, h + 1.0, d * 0.12]);
    b.add(M.aluminium, bevelBox(1.0, 0.55, 0.9, 0.06), [w * 0.26, h + 0.42, -d * 0.22]);
  } else if (kind === "stair") {
    b.add(M.plaster, bevelBox(2.0, 1.8, 1.8, 0.1), [-w * 0.26, h + 1.05, -d * 0.2]);
    b.add(M.roofZinc, wedge(2.2, 0.5, 2.0), [-w * 0.26, h + 2.1, -d * 0.2]);
  } else if (kind === "dish") {
    b.add(M.steel, post(0.09, 2.4, 6), [w * 0.28, h + 1.3, d * 0.2]);
    b.add(M.aluminium, new THREE.CylinderGeometry(0.85, 0.85, 0.14, 12), [w * 0.28, h + 2.5, d * 0.2], [1.0, 0, 0.3]);
    b.add(M.ironDark, post(0.05, 0.7, 4), [w * 0.28, h + 2.2, d * 0.2 + 0.5]);
  } else {
    for (const ox of [-w * 0.2, 0, w * 0.2]) {
      b.add(M.aluminium, bevelBox(0.9, 0.55, 0.9, 0.06), [ox, h + 0.4, -d * 0.24]);
    }
    b.add(M.steel, post(0.14, 1.6, 8), [w * 0.3, h + 0.9, d * 0.1]);
  }
}

/**
 * A generic authored block. Districts call this with different proportions,
 * skins, roofs and bay counts, which is where their character comes from.
 */
export function authoredBlock(
  b: PartsBuilder,
  options: {
    skin: Skin;
    w: number;
    d: number;
    storeys: number;
    storeyH?: number;
    bays: number;
    roof: RoofKind;
    clutter?: "tank" | "plant" | "stair" | "dish" | "vent";
    /** Elevations worth authoring. Default is all four; pass what is on screen. */
    seen?: Faces;
    /** Elevations that front a street and may carry retail at grade. */
    retail?: Faces;
    state: StateName;
    glazedBands?: boolean;
    rng: Rng;
  },
): number {
  const { skin, w, d, bays, roof, state, rng } = options;
  const storeyH = options.storeyH ?? 3.1;
  const h = options.storeys * storeyH;
  const retail = options.retail ?? [];
  const groundH = retail.length > 0 ? 3.4 : storeyH;
  // Nothing is ever authored on a wall the camera cannot reach. Defaults to
  // everything so a caller that has not worked out its orientation still gets a
  // complete building rather than a bald one.
  const seen = options.seen && options.seen.length > 0 ? options.seen : EVERY_FACE;

  b.add(skin.body, bevelBox(w, h, d, 0.1), [0, h / 2, 0]);
  facadeFrame(b, skin, w, d, h, bays, groundH, seen);

  // Punched openings are four boxes per window, per bay, per storey. That is
  // the right grammar for a four-storey street block and the wrong one for a
  // seventeen-storey tower: it is a thousand boxes for one building, and a
  // tower has a curtain wall in real life anyway. Above six storeys the glazing
  // runs in bands, which is cheaper and more honest at once.
  const banded = options.glazedBands || options.storeys >= 6;
  if (banded) {
    for (let s = 1; s < options.storeys; s++) {
      glazingBand(b, skin, s * storeyH + storeyH * 0.5, w, d, storeyH * 0.62, bays);
    }
  } else {
    for (const face of seen) {
      const [faceW, across] = faceSpan(face, w, d);
      const faceBays = Math.max(2, Math.round(bays * (faceW / w) * (face === "front" || face === "back" ? 1 : 0.8)));
      punchedFacade(b, skin, face, faceW, across, h, faceBays, storeyH, groundH, options.storeys, retail.includes(face));
    }
  }

  // Ground floor: the shop window where there is a street, a way in and some
  // light where there is not.
  for (const face of seen) {
    const [faceW, across] = faceSpan(face, w, d);
    if (retail.includes(face)) onFace(b, face, (t) => shopfront(t, skin, faceW, across / 2 + 0.02, state));
    else if (!banded) rearElevation(b, skin, face, faceW, across, groundH, state);
  }
  // A frontage the camera cannot see still exists: the district's people stand
  // on it and it is what the plot is addressed from.
  if (retail.includes("front") && !seen.includes("front")) {
    shopfront(b, skin, w, d / 2 + 0.02, state);
  }

  roofOf(b, skin, roof, w, d, h, rng);
  // A flat top is a facade at this camera angle. The pitched and sawtooth roofs
  // are already an authored shape; the flat ones need something standing on
  // them or the building ends in a blank rectangle.
  if (roof === "parapet" || roof === "stepped") roofscape(b, skin, w, d, h, rng, state);
  else if (options.clutter) roofClutter(b, options.clutter, w, d, h);

  return h;
}
