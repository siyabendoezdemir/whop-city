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

/** Plinth, pilasters, string course and cornice — the common facade frame. */
function facadeFrame(
  b: PartsBuilder,
  skin: Skin,
  w: number,
  d: number,
  h: number,
  bays: number,
  groundH: number,
): void {
  b.add(skin.base, box(w + 0.18, groundH * 0.28, d + 0.18), [0, groundH * 0.14, 0]);
  b.add(skin.trim, box(w + 0.22, 0.12, d + 0.22), [0, groundH * 0.28 + 0.06, 0]);
  const bayW = w / bays;
  for (let i = 0; i <= bays; i++) {
    b.add(skin.trim, box(0.26, h - 0.4, 0.2), [-w / 2 + i * bayW, h / 2, d / 2 + 0.02]);
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

/** Continuous glazed band, for the taller commercial masses. */
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
  for (let i = 0; i <= mullions; i++) {
    const x = -w / 2 + (w / mullions) * i;
    b.add(skin.trim, box(0.12, h + 0.1, d + 0.14), [x, y, 0]);
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
 * One face of punched openings, authored facing +Z and then rotated into place.
 *
 * `faceW` is the width of the face being glazed and `otherW` the depth it sits
 * proud of, so the same routine serves the frontage and both flanks.
 */
function punchedFacade(
  b: PartsBuilder,
  skin: Skin,
  faceW: number,
  otherW: number,
  h: number,
  bays: number,
  storeyH: number,
  groundH: number,
  storeys: number,
  hasShopfront: boolean,
  yaw: number,
): void {
  const tmp = new PartsBuilder();
  const bayW = faceW / bays;
  const skip = hasShopfront && Math.abs(yaw) < 0.01 ? 1 : 0;
  let emitted = 0;

  for (let s = skip; s < storeys; s++) {
    const y = groundH + (s - skip) * storeyH + storeyH * 0.5;
    if (y + 1 > h) break;
    for (let i = 0; i < bays; i++) {
      windowBay(tmp, skin, -faceW / 2 + bayW * (i + 0.5), y, otherW / 2 + 0.02, bayW * 0.56, storeyH * 0.58);
      emitted++;
    }
  }
  if (emitted === 0) return;

  const group = tmp.build("facade");
  group.rotation.y = yaw;
  group.updateMatrixWorld(true);
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      b.add(child.material as THREE.Material, child.geometry.clone().applyMatrix4(child.matrixWorld));
    }
  });
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
    shopfront?: boolean;
    state: StateName;
    glazedBands?: boolean;
    rng: Rng;
  },
): number {
  const { skin, w, d, bays, roof, state, rng } = options;
  const storeyH = options.storeyH ?? 3.1;
  const h = options.storeys * storeyH;
  const groundH = options.shopfront ? 3.4 : storeyH;

  b.add(skin.body, bevelBox(w, h, d, 0.1), [0, h / 2, 0]);
  facadeFrame(b, skin, w, d, h, bays, groundH);

  // Punched openings are four boxes per window, on three faces, per storey.
  // That is the right grammar for a four-storey street block and the wrong one
  // for a seventeen-storey tower: it is a thousand boxes for one building, and
  // a tower has a curtain wall in real life anyway. Above six storeys the
  // glazing runs in bands, which is cheaper and more honest at once.
  if (options.glazedBands || options.storeys >= 6) {
    for (let s = 1; s < options.storeys; s++) {
      glazingBand(b, skin, s * storeyH + storeyH * 0.5, w, d, storeyH * 0.62, bays);
    }
  } else {
    // Every face the camera can see needs openings. Glazing only the frontage
    // was leaving a blank painted wall on the two flanks, which is exactly what
    // makes a block read as an extruded rectangle rather than a building.
    punchedFacade(b, skin, w, d, h, bays, storeyH, groundH, options.storeys, options.shopfront ?? false, 0);
    const sideBays = Math.max(2, Math.round(bays * 0.72 * (d / w)));
    for (const yaw of [Math.PI / 2, -Math.PI / 2]) {
      punchedFacade(b, skin, d, w, h, sideBays, storeyH, groundH, options.storeys, options.shopfront ?? false, yaw);
    }
  }

  if (options.shopfront) shopfront(b, skin, w, d / 2 + 0.02, state);
  roofOf(b, skin, roof, w, d, h, rng);
  if (options.clutter) roofClutter(b, options.clutter, w, d, h);

  return h;
}
