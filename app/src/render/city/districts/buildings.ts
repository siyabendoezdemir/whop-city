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

/**
 * Plinth, pilasters, string course and cornice — the common facade frame.
 *
 * `heavy` is for a banded elevation. A punched wall gets its vertical rhythm
 * from the windows themselves, so its pilasters can be slender strips of trim.
 * A banded one has no such rhythm: it is glass from pier to pier, and if the
 * piers are 26cm of near-white trim on a near-white wall then what the player
 * sees is a stack of horizontal stripes with nothing holding them apart. Every
 * building in the city over six storeys had become one. The verticals on a
 * banded wall are therefore structure — half a metre of the wall's own colour,
 * standing proud of the glass, with proper corner columns.
 */
function facadeFrame(
  b: PartsBuilder,
  skin: Skin,
  w: number,
  d: number,
  h: number,
  bays: number,
  groundH: number,
  seen: Faces,
  heavy = false,
): void {
  b.add(skin.base, box(w + 0.18, groundH * 0.28, d + 0.18), [0, groundH * 0.14, 0]);
  b.add(skin.trim, box(w + 0.22, 0.12, d + 0.22), [0, groundH * 0.28 + 0.06, 0]);
  const pierW = heavy ? 0.62 : 0.26;
  const proud = heavy ? 0.2 : 0.02;
  const material = heavy ? skin.body : skin.trim;
  for (const face of seen) {
    const [faceW, across] = faceSpan(face, w, d);
    const count = Math.max(2, Math.round(bays * (faceW / w)));
    onFace(b, face, (t) => {
      for (let i = 0; i <= count; i++) {
        t.add(material, box(pierW, h - 0.4, 0.2 + proud), [
          -faceW / 2 + (faceW / count) * i,
          h / 2,
          across / 2 + proud / 2,
        ]);
      }
    });
  }
  if (heavy) {
    // Corner columns. Without them the glass runs off the end of the wall and
    // the tower loses its edges, which from this camera is the whole silhouette.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        b.add(skin.body, box(1.0, h - 0.3, 1.0), [(sx * w) / 2, h / 2, (sz * d) / 2]);
      }
    }
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
 * A ribbon of glass in a dark reveal, with a head and a cill in the wall's own
 * colour. Deliberately shallower than the floor it belongs to: the wall between
 * two bands is what a floor plate looks like from outside, and when the band
 * took four fifths of the storey there was no wall left to read. The verticals
 * are not here — they belong to the whole tower rather than to one floor of it,
 * and `facadeFrame` draws them once for the full height.
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
  // A dark reveal behind the glass. Curtain-wall glass here is a pale blue at
  // three-quarter opacity, so on a cream or plaster tower it sat within a few
  // per cent of the wall it was supposed to be a hole in and the whole
  // elevation read as blank render. The spandrel is what makes a band read as
  // an opening on any body colour.
  b.add(M.ironDark, box(w * 0.95, h + 0.12, d + 0.03), [0, y, 0]);
  b.add(M.ironDark, box(w + 0.03, h + 0.12, d * 0.95), [0, y, 0]);
  b.add(skin.glass, box(w * 0.94, h, d + 0.07), [0, y, 0]);
  b.add(skin.glass, box(w + 0.07, h, d * 0.94), [0, y, 0]);

  // Window divisions inside the ribbon. One box serves both opposite faces.
  for (let i = 1; i < mullions; i++) {
    b.add(M.aluminium, box(0.1, h - 0.1, d + 0.1), [-w / 2 + (w / mullions) * i, y, 0]);
  }
  const ribs = Math.max(2, Math.round(mullions * (d / Math.max(w, 0.001))));
  for (let i = 1; i < ribs; i++) {
    b.add(M.aluminium, box(w + 0.1, h - 0.1, 0.1), [0, y, -d / 2 + (d / ribs) * i]);
  }

  // Head and cill: the floor line, in the wall colour, so the storeys count.
  b.add(skin.trim, box(w + 0.16, 0.16, d + 0.16), [0, y + h / 2 + 0.1, 0]);
  b.add(skin.trim, box(w + 0.16, 0.16, d + 0.16), [0, y - h / 2 - 0.1, 0]);
}

/**
 * Retail at grade: a run of separate shops, not one long window.
 *
 * This used to draw a single unit the full width of whatever face it was given.
 * A commercial block face is ten to fourteen metres, so every building in the
 * city got one twelve-metre plate-glass window under one continuous
 * twelve-metre scarlet awning — a red bar wrapped round the whole of downtown,
 * and the loudest wrong note in the frame by a distance.
 *
 * A frontage is let in units of five or six metres. Each gets its own pier,
 * window, stallriser, fascia and sign, and only some of them put an awning out.
 * The variation is taken from the unit's index rather than from an Rng so the
 * same wall is the same wall every time it is built.
 */
export function shopfront(
  b: PartsBuilder,
  skin: Skin,
  w: number,
  z: number,
  state: StateName,
  awningMaterial?: THREE.Material,
): void {
  const shut = state === "struggling" || state === "dormant";
  const units = Math.max(1, Math.round(w / 5.6));
  const unitW = w / units;
  // Fabric comes in more than one colour, and a parade where every blind
  // matches reads as one shop with a very long window.
  const awnings = [M.canvasAwning, M.renderTeal, M.canvasAwningFaded, M.timber];

  // The fascia the whole parade hangs off, and a pier between each pair.
  b.add(M.ironDark, box(w, 0.52, 0.34), [0, 3.24, z - 0.04]);
  for (let i = 0; i <= units; i++) {
    b.add(skin.base, box(0.46, 2.98, 0.42), [-w / 2 + unitW * i, 1.49, z - 0.02]);
  }

  for (let i = 0; i < units; i++) {
    const cx = -w / 2 + unitW * (i + 0.5);
    const glassW = unitW - 0.9;
    b.add(M.ironDark, box(glassW + 0.3, 2.6, 0.24), [cx, 1.5, z - 0.06]);
    if (shut) {
      b.add(M.shutter, box(glassW, 2.3, 0.1), [cx, 1.42, z + 0.04]);
      for (let r = 0; r < 9; r++) {
        b.add(M.steel, box(glassW, 0.04, 0.13), [cx, 0.42 + r * 0.25, z + 0.05]);
      }
    } else {
      b.add(skin.glass, box(glassW, 2.16, 0.08), [cx, 1.48, z + 0.04]);
      // A door in one half and a window in the other: the transom and the
      // mullion between them are what make the unit read as a shop.
      b.add(M.aluminium, box(0.1, 2.16, 0.13), [cx + glassW * (i % 2 ? -0.18 : 0.18), 1.48, z + 0.07]);
      b.add(M.aluminium, box(glassW, 0.09, 0.13), [cx, 2.26, z + 0.07]);
      b.add(M.timberDark, box(glassW, 0.36, 0.14), [cx, 0.44, z + 0.06]);
    }
    // Fascia sign over the unit, lit while the business is trading.
    b.add(M.signBoard, box(unitW - 0.62, 0.56, 0.12), [cx, 2.98, z + 0.1]);
    b.add(state === "healthy" ? M.signLit : M.signDead, box(unitW - 1.5, 0.3, 0.07), [cx, 2.98, z + 0.17]);
    if (!shut && (i + units) % 3 !== 0) {
      const cloth = awningMaterial ?? awnings[(i * 2 + units) % awnings.length];
      b.add(cloth, box(unitW - 0.7, 0.1, 1.15), [cx, 2.54, z + 0.62], [0.17, 0, 0]);
      b.add(cloth, box(unitW - 0.7, 0.24, 0.09), [cx, 2.41, z + 1.16]);
    }
  }
}

export type RoofKind = "parapet" | "pitched" | "stepped" | "monitor" | "terrace" | "sawtooth";

/**
 * A deck inside a parapet.
 *
 * The parapet used to be one solid box the size of the whole building, sat on
 * top of it. Everything underneath — the felt, the walkway, every tank, stair
 * and duct roofscape put up there — was therefore inside a lid, and since this
 * camera looks down at thirty-five degrees the top of a building is the largest
 * single surface the player sees. Every flat-roofed block in the city was
 * finishing in a blank cream slab, which is most of the city.
 *
 * A parapet is four walls. Four boxes and a coping instead of one box, and the
 * roof exists.
 */
function parapetDeck(
  b: PartsBuilder,
  skin: Skin,
  w: number,
  d: number,
  h: number,
  wallH: number,
  deck: THREE.Material = M.roofFelt,
): void {
  const t = 0.32;
  b.add(deck, box(w + t, 0.16, d + t), [0, h + 0.08, 0]);
  const walls: Array<[number, number, number, number]> = [
    [w + t * 2, t, 0, (d + t) / 2],
    [w + t * 2, t, 0, -(d + t) / 2],
    [t, d + t * 2, (w + t) / 2, 0],
    [t, d + t * 2, -(w + t) / 2, 0],
  ];
  for (const [sx, sz, px, pz] of walls) {
    b.add(skin.trim, box(sx, wallH, sz), [px, h + wallH / 2, pz]);
    b.add(M.fascia, box(sx + 0.14, 0.14, sz + 0.14), [px, h + wallH + 0.07, pz]);
  }
}

/**
 * An occupied roof: decking, planting, rails, a way up and somewhere to sit.
 *
 * The Creator Quarter's signature, and at the top of its ladder the single
 * largest surface the camera is given — a twelve-by-twelve deck seen from
 * above at thirty-five degrees is a bigger shape than either elevation under
 * it. It used to be one pale timber plane with a planter at each end and a
 * pergola in the middle, which at two storeys was a roof terrace and at eight
 * was a tennis court with a shed on it.
 *
 * Everything here is laid out from `w` and `d`, so a small deck gets a table
 * and a big one gets a garden.
 */
function terraceDeck(
  b: PartsBuilder,
  skin: Skin,
  w: number,
  d: number,
  h: number,
  rng: Rng,
): void {
  parapetDeck(b, skin, w, d, h, 0.42, M.timberPale);

  // Board joints. Ten thin strips across a pale plane, which is the cheapest
  // thing in the file and the single biggest difference to how the deck reads:
  // without them it is a blank rectangle at any size.
  const boards = Math.max(4, Math.min(11, Math.round(w / 1.3)));
  for (let i = 1; i < boards; i++) {
    b.add(M.timber, box(0.07, 0.04, d - 0.4), [-w / 2 + (w / boards) * i, h + 0.18, 0]);
  }

  // Planting round the edge, in runs rather than as two long troughs, so a wide
  // deck reads as a garden and a narrow one as a window box.
  const runs = Math.max(1, Math.min(4, Math.round(w / 3.4)));
  const runW = (w - 1.2) / runs;
  for (const sz of [-1, 1]) {
    for (let i = 0; i < runs; i++) {
      if (runs > 2 && i === Math.floor(runs / 2) && sz > 0) continue; // The way out onto the deck.
      const px = -(w - 1.2) / 2 + runW * (i + 0.5);
      b.add(M.planter, box(runW - 0.35, 0.42, 0.8), [px, h + 0.38, (sz * (d - 1.7)) / 2]);
      b.add(M.foliageDeep, box(runW - 0.6, 0.34, 0.62), [px, h + 0.68, (sz * (d - 1.7)) / 2]);
    }
  }

  // Rails on all four sides. Three of them used to be missing, and a terrace
  // whose deck runs off the edge of the building does not read as a place.
  const rail = (along: "x" | "z", at: number) => {
    const span = along === "x" ? w : d;
    const posts = Math.max(3, Math.round(span / 1.9));
    for (let i = 0; i <= posts; i++) {
      const t = -span / 2 + (span / posts) * i;
      b.add(M.ironDark, post(0.03, 0.95, 4), along === "x" ? [t, h + 0.62, at] : [at, h + 0.62, t]);
    }
    b.add(
      M.ironDark,
      along === "x" ? box(span, 0.06, 0.06) : box(0.06, 0.06, span),
      along === "x" ? [0, h + 1.07, at] : [at, h + 1.07, 0],
    );
  };
  for (const side of [-1, 1]) {
    rail("x", side * (d / 2 - 0.12));
    rail("z", side * (w / 2 - 0.12));
  }

  // The way up. A roof garden nobody can reach reads as a decorated lid, and
  // the overrun is what gives the terrace a silhouette from street level.
  const sw = Math.min(2.4, w * 0.26);
  const sx = -w / 2 + sw * 0.75;
  const sz = -d * 0.24;
  b.add(skin.body, bevelBox(sw, 2.1, sw * 0.9, 0.08), [sx, h + 1.47, sz]);
  b.add(M.roofZinc, wedge(sw + 0.3, 0.42, sw * 0.9 + 0.3), [sx, h + 2.73, sz]);
  b.add(M.ironDark, box(sw * 0.44, 1.5, 0.1), [sx, h + 1.15, sz + (sw * 0.9) / 2 + 0.06]);

  // What the roof is actually for.
  //
  // Three of these, because the Quarter has eight or nine terraces in one shot
  // and they were all the same deck with the same pergola on it — a run of
  // identical roofs is as strong a tell as an untextured one, and from above it
  // is the tell the player gets first.
  const px = w * 0.14;
  const kind = rng.int(0, 2);
  if (kind === 0) {
    // Pergola, table, benches.
    const pw = Math.min(w * 0.42, 5.2);
    const pd = Math.min(d * 0.5, 3.6);
    for (const ox of [-pw / 2, pw / 2]) {
      for (const oz of [-pd / 2, pd / 2]) b.add(M.timber, post(0.09, 2.3, 5), [px + ox, h + 1.3, oz]);
    }
    b.add(M.timber, box(pw + 0.4, 0.14, pd + 0.3), [px, h + 2.45, 0]);
    const slats = Math.max(4, Math.round(pw / 0.55));
    for (let i = 0; i <= slats; i++) {
      b.add(M.timber, box(0.1, 0.1, pd + 0.3), [px - pw / 2 + (pw / slats) * i, h + 2.56, 0]);
    }
    b.add(M.timberDark, box(pw * 0.55, 0.09, 0.85), [px, h + 0.95, 0]);
    for (const oz of [-0.75, 0.75]) b.add(M.timberDark, box(pw * 0.55, 0.08, 0.32), [px, h + 0.62, oz]);
  } else if (kind === 1) {
    // A studio in the corner: the live/work district's roof extension.
    const sw = Math.min(w * 0.46, 5.4);
    const sd = Math.min(d * 0.5, 4.2);
    b.add(skin.body, bevelBox(sw, 2.5, sd, 0.08), [px, h + 1.4, -d * 0.1]);
    b.add(skin.glass, box(sw * 0.82, 1.5, sd + 0.06), [px, h + 1.6, -d * 0.1]);
    b.add(skin.glass, box(sw + 0.06, 1.5, sd * 0.7), [px, h + 1.6, -d * 0.1]);
    for (let i = 1; i < 3; i++) {
      b.add(M.aluminium, box(0.1, 1.5, sd + 0.12), [px - sw / 2 + (sw / 3) * i, h + 1.6, -d * 0.1]);
    }
    b.add(M.roofZinc, wedge(sw + 0.4, 0.8, sd + 0.4), [px, h + 2.7, -d * 0.1]);
    b.add(M.timberDark, post(0.55, 0.72, 8), [px - sw * 0.3, h + 0.52, d * 0.28]);
    for (const a of [0.4, 2.5, 4.6]) {
      b.add(M.timberDark, post(0.24, 0.4, 6), [px - sw * 0.3 + Math.cos(a) * 1.2, h + 0.36, d * 0.28 + Math.sin(a) * 1.2]);
    }
  } else {
    // Growing beds and a potting shed. The most planted of the three, and the
    // one that reads greenest from directly above.
    const beds = Math.max(2, Math.min(4, Math.round(w / 3.6)));
    for (let i = 0; i < beds; i++) {
      const bx = -w * 0.3 + (w * 0.62 * i) / Math.max(1, beds - 1);
      b.add(M.planter, box(1.5, 0.34, d * 0.42), [bx, h + 0.34, d * 0.04]);
      b.add(M.foliageDeep, box(1.25, 0.26, d * 0.38), [bx, h + 0.6, d * 0.04]);
    }
    b.add(M.timberDark, bevelBox(2.2, 2.0, 1.9, 0.07), [w * 0.3, h + 1.15, -d * 0.28]);
    b.add(M.roofZinc, wedge(2.5, 0.55, 2.2), [w * 0.3, h + 2.4, -d * 0.28]);
    b.add(M.steel, post(0.55, 1.5, 8), [w * 0.3 - 1.9, h + 0.9, -d * 0.28]);
  }

  // On a big deck there is room left over: a tub, and the plant every occupied
  // roof actually has.
  if (w > 9) {
    b.add(M.planter, post(0.6, 0.7, 8), [-w * 0.36, h + 0.51, -d * 0.06]);
    b.add(M.foliageDeep, new THREE.SphereGeometry(rng.range(0.65, 0.85), 6, 4), [-w * 0.36, h + 1.32, -d * 0.06]);
    b.add(M.ironDark, box(2.2, 0.12, 1.7), [w * 0.3, h + 0.24, d * 0.3]);
    b.add(M.steelPainted, bevelBox(1.9, 0.75, 1.4, 0.06), [w * 0.3, h + 0.66, d * 0.3]);
  }
}

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
    parapetDeck(b, skin, w, d, h, 0.66);
  } else if (kind === "pitched") {
    b.add(skin.roof, wedge(w + 0.5, 1.9, d + 0.5), [0, h + 0.95, 0]);
    b.add(M.fascia, box(w + 0.62, 0.2, 0.2), [0, h + 0.1, d / 2 + 0.3]);
  } else if (kind === "stepped") {
    parapetDeck(b, skin, w, d, h, 0.5);
    const upper = 2.2;
    b.add(skin.body, bevelBox(w * 0.7, upper, d * 0.6, 0.1), [0, h + upper / 2, -d * 0.12]);
    b.add(skin.trim, box(w * 0.76, 0.36, d * 0.64), [0, h + upper, -d * 0.12]);
    b.add(skin.glass, box(w * 0.56, 1.2, 0.08), [0, h + 1.0, -d * 0.12 + d * 0.3]);
  } else if (kind === "monitor") {
    parapetDeck(b, skin, w, d, h, 0.5);
    b.add(skin.body, box(w * 0.46, 1.2, d * 0.4), [0, h + 0.75, 0]);
    b.add(skin.glass, box(w * 0.42, 0.75, d * 0.42), [0, h + 0.85, 0]);
    b.add(skin.roof, wedge(w * 0.52, 0.5, d * 0.48), [0, h + 1.6, 0]);
  } else if (kind === "terrace") {
    terraceDeck(b, skin, w, d, h, rng);
  } else {
    // Sawtooth, the maker signature.
    const bays = Math.max(3, Math.round(w / 3));
    const bayW = w / bays;
    const rise = 2.2;
    // North light is glass you look *into*, and a workshop interior is darker
    // than the sky. Emissive warm glazing over the whole vertical face of every
    // tooth turned the forge's sheds into banks of glowing yellow panels — the
    // roof stopped reading as a roof and the district stopped reading as a
    // works. Cool glass, over a spandrel, with mullions at a bay and a half.
    const lights = skin.glass === M.glassDim ? M.glassDim : M.glass;
    const glazedH = rise * 0.62;
    const mullions = Math.max(3, Math.round(d / 1.9));
    for (let i = 0; i < bays; i++) {
      const xa = -w / 2 + i * bayW;
      const xb = xa + bayW;
      const len = Math.hypot(bayW, rise);
      b.add(skin.roof, box(len, 0.16, d), [(xa + xb) / 2, h + rise / 2, 0], [0, 0, Math.atan2(rise, bayW)]);
      // Spandrel below the glazing, so the tooth has a solid base rather than
      // running glass down to the gutter.
      b.add(skin.body, box(0.2, rise - glazedH, d - 0.2), [xb - 0.06, h + (rise - glazedH) / 2, 0]);
      b.add(M.ironDark, box(0.14, glazedH + 0.16, d - 0.36), [xb - 0.05, h + rise - glazedH / 2 - 0.14, 0]);
      b.add(lights, box(0.11, glazedH, d - 0.5), [xb - 0.02, h + rise - glazedH / 2 - 0.14, 0]);
      for (let m = 1; m < mullions; m++) {
        b.add(M.steelPainted, box(0.15, glazedH, 0.08), [xb - 0.02, h + rise - glazedH / 2 - 0.14, -d / 2 + (d / mullions) * m]);
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

    // Two openings in the wall that is left over, kept clear of the door and
    // of the corner. The expression this replaces worked out to 0.525 × faceW
    // at its right-hand edge, so on every rear elevation in the city the
    // outer window and its stone cill hung a hand's breadth past the corner
    // of the building — a ledge sticking out of thin air on the return wall.
    const from = dx + 1.2;
    const to = faceW / 2 - 0.7;
    const winW = Math.min((to - from) / 2.6, faceW * 0.19);
    if (winW > 0.4) {
      for (const k of [0.26, 0.74]) {
        windowBay(t, skin, from + (to - from) * k, groundH * 0.55, z, winW, groundH * 0.44);
      }
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

  // Walkway boards across the deck: the thing that gives a roof a direction and
  // a sense of scale before any of the plant on it is legible.
  for (const sz of [-1, 1]) {
    b.add(M.steelPainted, box(w - 1.4, 0.06, 0.5), [0, h + 0.2, (sz * (d - 1.6)) / 2]);
  }

  const wanted = Math.min(slots.length, 2 + Math.floor((w * d) / 34));
  // Weighted toward the things a roof is mostly made of. A dish is a landmark,
  // not a fitting, and cycling one in every fourth slot put four black discs on
  // sticks over every block in the city.
  const kinds = ["plant", "tank", "vent", "plant", "vent", "dish"] as const;
  for (let i = 0; i < wanted; i++) {
    const [x, z] = slots[i];
    const kind = i === 0 ? "stair" : kinds[(i + Math.floor(w)) % kinds.length];
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
    // Painted rather than bare metal — a mirror-finish box in a scene lit by a
    // sky gradient and one sun reflects the ground and comes out nearly black,
    // which is what turned every roof's plant into a set of dark smudges.
    b.add(M.ironDark, box(2.4, 0.12, 1.9), [x, h + 0.28, z]);
    b.add(M.steelPainted, bevelBox(1.1, 0.62, 0.85, 0.05), [x - 0.55, h + 0.65, z]);
    b.add(M.steelPainted, bevelBox(1.1, 0.62, 0.85, 0.05), [x + 0.55, h + 0.65, z]);
    b.add(M.aluminium, box(0.9, 0.05, 0.9), [x - 0.55, h + 0.98, z]);
    b.add(M.aluminium, box(0.9, 0.05, 0.9), [x + 0.55, h + 0.98, z]);
  } else if (kind === "dish") {
    b.add(M.steelPainted, post(0.07, 1.9, 6), [x, h + 1.15, z]);
    b.add(M.steelPainted, new THREE.CylinderGeometry(0.52, 0.52, 0.1, 10), [x, h + 1.85, z], [1.0, 0, 0.3]);
    b.add(M.ironDark, box(0.7, 0.06, 0.7), [x, h + 0.24, z]);
  } else {
    for (const ox of [-0.7, 0, 0.7]) {
      b.add(M.steelPainted, post(0.24, 0.7, 7), [x + ox, h + 0.55, z]);
      b.add(M.aluminium, new THREE.ConeGeometry(0.3, 0.2, 7), [x + ox, h + 1.0, z]);
    }
    b.add(M.ironDark, box(2.2, 0.08, 0.7), [x, h + 0.24, z]);
  }
}

/**
 * Industrial cladding: a dado, structural bays, and a clerestory.
 *
 * A working shed is a big simple mass, which is the point of it, but a big
 * simple mass with nothing on its walls is a block of foam — and the forge's
 * sheds are the largest single planes in the city.
 *
 * The first attempt at this put sheeting ribs on in the trim colour, which for
 * a cream shed is #f6f1e6 against #f1e6d3: invisible from ten metres, never
 * mind sixty. Cladding reads by tone, not by relief, at a fixed camera. So the
 * wall is divided the way a real portal frame divides it — dark dado to truck
 * height, painted steel casings on the frame lines, daylight under the eaves —
 * and every one of those is a different colour from the sheeting between them.
 *
 * Authored about the origin so a caller can place it.
 */
export function shedCladding(
  b: PartsBuilder,
  skin: Skin,
  w: number,
  d: number,
  h: number,
  state: StateName,
): void {
  const casing = state === "struggling" ? M.steelRust : M.steelPainted;
  const lights = state === "struggling" ? M.glassDim : M.glass;

  // Plinth and dado. A shed is knocked about at the bottom, so it is protected
  // to about the height of a lorry deck, and that band is what gives the wall a
  // base to stand on.
  const dado = Math.min(1.9, h * 0.18);
  b.add(M.concreteDark, box(w + 0.24, dado, d + 0.24), [0, dado / 2, 0]);
  b.add(skin.trim, box(w + 0.34, 0.2, d + 0.34), [0, dado + 0.06, 0]);

  // Frame lines. Wide enough to be more than one pixel at working distance, and
  // spaced like the portal frames the sawtooth above is sitting on.
  //
  // Interior lines only. A box spanning the full width and standing exactly on
  // the end wall is not a frame line, it is a coat of paint over the whole
  // elevation, and putting one at each end of both runs is how the first
  // version turned a cream shed into a grey one.
  const along = Math.max(3, Math.round(w / 3.4));
  const across = Math.max(2, Math.round(d / 3.4));
  const upper = h - dado - 0.3;
  for (let i = 1; i < along; i++) {
    b.add(casing, box(0.34, upper, d + 0.2), [-w / 2 + (w / along) * i, dado + upper / 2, 0]);
  }
  for (let i = 1; i < across; i++) {
    b.add(casing, box(w + 0.2, upper, 0.34), [0, dado + upper / 2, -d / 2 + (d / across) * i]);
  }

  // Clerestory: the band of daylight every shed of this kind has, and the one
  // thing that tells the eye how tall the wall is. Divided at roughly two
  // metres, because an undivided ribbon fourteen metres long is a stripe of
  // paint rather than a window.
  const bandH = Math.min(1.25, (h - dado) * 0.26);
  const cy = h - 1.4;
  if (cy > dado + 1.4) {
    b.add(lights, box(w * 0.97, bandH, d + 0.14), [0, cy, 0]);
    b.add(lights, box(w + 0.14, bandH, d * 0.97), [0, cy, 0]);
    for (let i = 1; i < along * 2; i++) {
      b.add(casing, box(0.14, bandH + 0.06, d + 0.18), [-w / 2 + (w / (along * 2)) * i, cy, 0]);
    }
    for (let i = 1; i < across * 2; i++) {
      b.add(casing, box(w + 0.18, bandH + 0.06, 0.14), [0, cy, -d / 2 + (d / (across * 2)) * i]);
    }
    b.add(skin.trim, box(w + 0.3, 0.22, d + 0.3), [0, cy + bandH / 2 + 0.11, 0]);
    b.add(skin.trim, box(w + 0.3, 0.22, d + 0.3), [0, cy - bandH / 2 - 0.11, 0]);
  }

  // Eaves gutter, and rainwater goods at the corners.
  b.add(casing, box(w + 0.44, 0.3, d + 0.44), [0, h - 0.18, 0]);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.add(casing, post(0.14, h - dado, 6), [(sx * (w + 0.3)) / 2, dado + (h - dado) / 2, (sz * (d + 0.3)) / 2]);
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

  // Punched openings are four boxes per window, per bay, per storey. That is
  // the right grammar for a four-storey street block and the wrong one for a
  // seventeen-storey tower: it is a thousand boxes for one building, and a
  // tower has a curtain wall in real life anyway. Above six storeys the glazing
  // runs in bands, which is cheaper and more honest at once.
  const banded = options.glazedBands || options.storeys >= 6;

  b.add(skin.body, bevelBox(w, h, d, 0.1), [0, h / 2, 0]);
  facadeFrame(b, skin, w, d, h, bays, groundH, seen, banded);

  if (banded) {
    for (let s = 1; s < options.storeys; s++) {
      glazingBand(b, skin, s * storeyH + storeyH * 0.5, w, d, storeyH * 0.5, bays);
    }
    // A cornice, and the parapet the roof sits behind. A banded tower that just
    // stops at its top course reads as a column that has been sawn off.
    b.add(skin.trim, box(w + 0.7, 0.5, d + 0.7), [0, h - 0.25, 0]);
    b.add(M.fascia, box(w + 0.9, 0.16, d + 0.9), [0, h + 0.02, 0]);
  } else {
    for (const face of seen) {
      const [faceW, across] = faceSpan(face, w, d);
      const faceBays = Math.max(2, Math.round(bays * (faceW / w) * (face === "front" || face === "back" ? 1 : 0.8)));
      punchedFacade(b, skin, face, faceW, across, h, faceBays, storeyH, groundH, options.storeys, retail.includes(face));
    }
  }

  // Ground floor: the shop window where there is a street, a way in and some
  // light where there is not. A banded tower needs this as much as a terrace
  // does — more, because the first thing under a hundred feet of glass is the
  // only part of it at human scale, and leaving it bare stood every tower in
  // the city on a blank plinth.
  for (const face of seen) {
    const [faceW, across] = faceSpan(face, w, d);
    if (retail.includes(face)) onFace(b, face, (t) => shopfront(t, skin, faceW, across / 2 + 0.02, state));
    else rearElevation(b, skin, face, faceW, across, groundH, state);
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
