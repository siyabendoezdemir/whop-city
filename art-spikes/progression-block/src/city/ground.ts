import * as THREE from "three";

import { PartsBuilder, bevelBox, box, post, slab, wedge } from "../lib/geom";
import { M } from "../scene/materials";
import { Rng } from "../lib/rng";
import { Prop, type InstanceKit } from "./props";

/**
 * The ground the block stands on.
 *
 * One continuous surface: carriageway, kerb, footway, the lot itself, a service
 * lane behind it, and a retaining wall dropping to the water. The lot is not a
 * pad floating in space — you can trace a path from the road across the kerb,
 * over the footway, into the yard and out to the quay without leaving the mesh.
 *
 * This is deliberately state-independent. The place does not change between
 * dormant and healthy; only what is built and what happens on it does. The
 * states add their own surface modules (fresh paving, patched asphalt) on top.
 */

export const SITE = {
  // Street runs along X. Positive Z is toward the camera-facing kerb.
  roadZ0: 9,
  roadZ1: 17,
  kerbZ: 9,
  walkZ0: 5.6,
  walkZ1: 9,

  lotX0: -13,
  lotX1: 13,
  lotZ0: -13.5,
  lotZ1: 5.6,

  laneZ0: -18.5,
  laneZ1: -13.5,

  quayZ0: -23.5,
  quayZ1: -18.5,

  groundY: 0,
  kerbH: 0.15,
  quayDrop: -1.35,
} as const;

/** The tidal creek behind the block, and the shore on its far side. */
export const CREEK = {
  width: 12.5,
  get farZ() {
    return SITE.quayZ0 - this.width;
  },
} as const;

function pavementPlane(
  builder: PartsBuilder,
  material: THREE.Material,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  y: number,
  thickness = 0.16,
) {
  const w = x1 - x0;
  const d = z1 - z0;
  builder.add(material, box(w, thickness, d), [(x0 + x1) / 2, y - thickness / 2, (z0 + z1) / 2]);
}

export function buildGround(kit: InstanceKit, seed: number): THREE.Group {
  const rng = new Rng(seed).fork("ground");
  const b = new PartsBuilder();
  const S = SITE;
  const SPAN_X0 = -62;
  const SPAN_X1 = 62;

  // ------------------------------------------------------------------ land
  // Continuous terrain under everything, with the channel cut out of it. The
  // block is a place on a landmass, not a tray of paving floating in sky.
  b.add(M.concreteDark, box(360, 1.2, 120), [0, S.groundY - 0.62, S.quayZ0 + 60]);
  // Opposite bank of the creek. Deliberately close: a narrow tidal channel, as
  // Mission Creek actually is, so the far shore reads inside this framing
  // instead of sitting beyond the top of the frame.
  b.add(M.concreteDark, box(360, 1.4, 130), [0, S.groundY - 0.7, CREEK.farZ - 65]);
  b.add(M.concrete, box(360, 1.1, 1.4), [0, S.quayDrop + 0.45, CREEK.farZ]);

  // ------------------------------------------------------------ carriageway
  pavementPlane(b, M.asphalt, SPAN_X0, SPAN_X1, S.roadZ0, S.roadZ1, S.groundY, 0.22);

  // Centre line, dashed, and a solid edge line by the kerb.
  for (let x = SPAN_X0 + 2; x < SPAN_X1; x += 5.4) {
    b.add(M.roadLine, box(2.9, 0.02, 0.17), [x, S.groundY + 0.005, (S.roadZ0 + S.roadZ1) / 2]);
  }
  b.add(M.roadLine, box(SPAN_X1 - SPAN_X0, 0.02, 0.12), [0, S.groundY + 0.005, S.roadZ0 + 0.55]);

  // Drainage gullies along the channel.
  for (let x = -46; x <= 46; x += 11.5) {
    b.add(M.ironDark, box(0.62, 0.03, 0.4), [x, S.groundY + 0.012, S.roadZ0 + 0.28]);
  }

  // ------------------------------------------------------------------ kerb
  const kerbY = S.groundY + S.kerbH;
  b.add(M.kerb, box(SPAN_X1 - SPAN_X0, S.kerbH, 0.34), [0, S.groundY + S.kerbH / 2, S.kerbZ - 0.17]);

  // ----------------------------------------------------------------- footway
  pavementPlane(b, M.sidewalk, SPAN_X0, SPAN_X1, S.walkZ0, S.kerbZ - 0.34, kerbY, 0.18);

  // Paving joints, so the footway is not one flat sheet.
  for (let x = SPAN_X0; x <= SPAN_X1; x += 2.4) {
    b.add(M.sidewalkWorn, box(0.05, 0.012, S.kerbZ - 0.34 - S.walkZ0), [
      x,
      kerbY + 0.007,
      (S.walkZ0 + S.kerbZ - 0.34) / 2,
    ]);
  }
  b.add(M.sidewalkWorn, box(SPAN_X1 - SPAN_X0, 0.012, 0.05), [0, kerbY + 0.007, S.walkZ0 + 1.6]);

  // Tree pits with a metal grille, punched into the footway.
  for (const x of [-19.5, -8.5, 8.5, 19.5]) {
    b.add(M.dirt, box(1.5, 0.06, 1.5), [x, kerbY - 0.02, S.walkZ0 + 1.4]);
    b.add(M.ironDark, box(1.62, 0.03, 0.09), [x, kerbY + 0.005, S.walkZ0 + 0.62]);
    b.add(M.ironDark, box(1.62, 0.03, 0.09), [x, kerbY + 0.005, S.walkZ0 + 2.18]);
  }

  // Crossing at the left edge of frame — implies the street continues.
  for (let i = 0; i < 6; i++) {
    b.add(M.roadLine, box(0.55, 0.02, S.roadZ1 - S.roadZ0 - 0.4), [
      -28 + i * 0.95,
      S.groundY + 0.006,
      (S.roadZ0 + S.roadZ1) / 2,
    ]);
  }

  // -------------------------------------------------------------- the lot
  // Slightly raised over the footway, with a threshold step at the frontage.
  const lotY = kerbY + 0.06;
  pavementPlane(b, M.concrete, S.lotX0 - 9, S.lotX1 + 9, S.lotZ0, S.lotZ1, lotY, 0.24);
  b.add(M.kerb, box(S.lotX1 - S.lotX0 + 18, 0.07, 0.3), [0, lotY - 0.02, S.lotZ1 - 0.15]);

  // Yard apron on the right third: a different, rougher surface than the plaza.
  pavementPlane(b, M.yardApron, 2.4, S.lotX1 + 8.6, S.lotZ0 + 0.4, 2.2, lotY + 0.004, 0.05);
  // Expansion joints across the apron.
  for (let x = 3.2; x < S.lotX1 + 8; x += 3.1) {
    b.add(M.concreteDark, box(0.06, 0.014, 1.8 - S.lotZ0), [x, lotY + 0.02, (S.lotZ0 + 0.4 + 2.2) / 2]);
  }

  // Planted strip along the west boundary.
  pavementPlane(b, M.grass, S.lotX0 - 8.6, S.lotX0 - 3.4, S.lotZ0 + 1.2, 3.4, lotY + 0.03, 0.08);
  b.add(M.kerb, box(0.22, 0.16, 3.4 - S.lotZ0 - 1.2), [
    S.lotX0 - 3.4,
    lotY + 0.04,
    (S.lotZ0 + 1.2 + 3.4) / 2,
  ]);

  // ------------------------------------------------- service lane and quay
  pavementPlane(b, M.asphaltPatched, SPAN_X0, SPAN_X1, S.laneZ0, S.laneZ1, lotY - 0.12, 0.2);

  // Retaining wall down to the quay: the terrain edge.
  const wallTop = lotY - 0.12;
  const wallH = wallTop - (S.quayDrop + 0.2);
  b.add(M.concreteDark, box(SPAN_X1 - SPAN_X0, wallH, 0.7), [
    0,
    wallTop - wallH / 2,
    S.laneZ0 - 0.35,
  ]);
  b.add(M.kerb, slab(SPAN_X1 - SPAN_X0, 0.16, 0.96, 0.04), [0, wallTop + 0.06, S.laneZ0 - 0.35]);

  pavementPlane(b, M.concrete, SPAN_X0, SPAN_X1, S.quayZ0, S.quayZ1, S.quayDrop + 0.2, 0.3);

  // Quay furniture: bollards and a mooring edge, then water beyond.
  b.add(M.concreteDark, box(SPAN_X1 - SPAN_X0, 0.34, 0.5), [0, S.quayDrop + 0.1, S.quayZ0 + 0.25]);
  // The channel runs well past the frame on every side, so no plane edge is
  // ever visible as a hard line across the water.
  b.add(M.water, box(360, 0.1, CREEK.width + 1.0), [
    0,
    S.quayDrop - 0.3,
    (S.quayZ0 + CREEK.farZ) / 2,
  ]);

  // Steps from lane down to quay, at the right of frame.
  for (let i = 0; i < 5; i++) {
    b.add(M.concrete, box(2.6, 0.26, 0.42), [17.5, wallTop - 0.13 - i * 0.26, S.laneZ0 - 0.2 - i * 0.42]);
  }

  // ------------------------------------------------------ street furniture
  const ground = b.build("ground", false, true);

  // Instanced items that belong to the street rather than the lot.
  for (const x of [-19.5, -8.5, 8.5, 19.5]) {
    Prop.tree(kit, [x, kerbY, SITE.walkZ0 + 1.4], rng.range(0, Math.PI * 2), rng.range(0.94, 1.14));
  }
  for (const x of [-24, -2.5, 22]) {
    Prop.lamp(kit, [x, kerbY, SITE.kerbZ - 0.9], Math.PI);
  }
  for (let x = -30; x <= 30; x += 3.4) {
    if (Math.abs(x) < 14) continue; // frontage stays open for the lot
    kit.place("bollard", [x, kerbY, SITE.kerbZ - 0.75], 0, rng.range(0.94, 1.06));
  }
  for (const x of [-11.5, 25]) {
    kit.place("bin", [x, kerbY, SITE.walkZ0 + 0.5]);
  }

  // Quay bollards.
  for (let x = -34; x <= 34; x += 7) {
    kit.place("bollard", [x, SITE.quayDrop + 0.2, SITE.quayZ0 + 0.9], 0, 1.25);
  }

  return ground;
}

/**
 * Working creek: a timber pier and a moored barge.
 *
 * The water was a large flat pale area at the top of frame. Something on it
 * gives the eye a reason to travel there and confirms the channel is a working
 * waterway rather than a backdrop.
 */
export function buildCreek(kit: InstanceKit, seed: number): THREE.Group {
  const rng = new Rng(seed).fork("creek");
  const b = new PartsBuilder();
  const waterY = SITE.quayDrop - 0.25;

  // Pier deck on piles, reaching out from the quay.
  const px = 22;
  const deckY = SITE.quayDrop + 0.5;
  b.add(M.timberDark, box(5.6, 0.24, 9.0), [px, deckY, SITE.quayZ0 - 3.6]);
  for (let i = 0; i < 5; i++) {
    b.add(M.timberPale, box(5.7, 0.06, 0.9), [px, deckY + 0.15, SITE.quayZ0 - 0.9 - i * 1.9]);
  }
  for (const ox of [-2.4, 2.4]) {
    for (let i = 0; i < 4; i++) {
      b.add(M.timberDark, post(0.17, 2.0, 7), [px + ox, waterY + 0.6, SITE.quayZ0 - 1.2 - i * 2.3]);
    }
  }
  // Handrail down one side.
  b.add(M.ironDark, box(0.08, 0.08, 8.6), [px + 2.5, deckY + 1.0, SITE.quayZ0 - 3.6]);
  for (let i = 0; i < 5; i++) {
    b.add(M.ironDark, post(0.045, 1.0, 5), [px + 2.5, deckY + 0.62, SITE.quayZ0 - 1.0 - i * 2.0]);
  }

  // A flat-topped working barge alongside, low in the water.
  const bx = 8.5;
  const bz = SITE.quayZ0 - 5.4;
  b.add(M.steelRust, bevelBox(13.5, 1.25, 4.6, 0.18), [bx, waterY + 0.42, bz]);
  b.add(M.timberDark, box(12.6, 0.14, 3.9), [bx, waterY + 1.06, bz]);
  b.add(M.steelRust, box(13.6, 0.22, 0.22), [bx, waterY + 1.12, bz + 2.25]);
  b.add(M.steelRust, box(13.6, 0.22, 0.22), [bx, waterY + 1.12, bz - 2.25]);
  // Wheelhouse and a small stack at one end.
  b.add(M.renderCream, bevelBox(2.3, 1.9, 3.0, 0.12), [bx - 5.0, waterY + 2.0, bz]);
  b.add(M.glassDim, box(2.0, 0.7, 0.08), [bx - 5.0, waterY + 2.4, bz + 1.52]);
  b.add(M.roofZinc, box(2.7, 0.16, 3.4), [bx - 5.0, waterY + 3.0, bz]);
  b.add(M.ironDark, post(0.22, 1.3, 8), [bx - 6.1, waterY + 3.3, bz - 0.9]);
  // Deck cargo.
  for (let i = 0; i < 4; i++) {
    kit.place("crate", [bx + 1.2 + i * 1.5, waterY + 1.13, bz + rng.range(-1.0, 1.0)], rng.range(0, 1.2));
  }
  kit.place("drum", [bx + 4.6, waterY + 1.13, bz - 1.3], 0.4);

  return b.build("creek", true, true);
}

/**
 * Neighbouring massing.
 *
 * Cut off by the frame on three sides so the block reads as part of a city
 * rather than a diorama. Still authored — every one has a roof, a parapet, a
 * window band and a ground-floor base — but simplified, and pushed back into
 * the haze by the fog.
 */
export function buildNeighbours(seed: number): THREE.Group {
  const rng = new Rng(seed).fork("neighbours");
  const b = new PartsBuilder();

  type Block = { x: number; z: number; w: number; d: number; h: number; body: THREE.Material };
  const bodies = [M.brick, M.renderCream, M.renderTeal, M.plaster, M.brickDark, M.renderClay];

  const blocks: Block[] = [];

  /**
   * Height is governed by where a block sits relative to the camera.
   *
   * The view looks down the +X/+Z diagonal, so anything nearer the camera than
   * the lot will occlude it. Everything on the near side is kept single-storey
   * — it frames the bottom of the composition — and all the real skyline mass
   * is pushed behind the lot where it belongs.
   */
  const NEAR_MAX_H = 6.2;

  // The across-street row is authored, not generated — see ./neighbours. Only
  // its continuation beyond the frame edges is filled in here.
  let cursor = -78;
  while (cursor < -34) {
    const w = rng.range(8, 13);
    const d = rng.range(10, 14);
    blocks.push({
      x: cursor + w / 2,
      z: SITE.roadZ1 + d / 2 + rng.range(1.6, 2.8),
      w,
      d,
      h: rng.range(4.4, NEAR_MAX_H),
      body: rng.pick(bodies),
    });
    cursor += w + rng.range(0.8, 2.2);
  }
  cursor = 34;
  while (cursor < 78) {
    const w = rng.range(8, 13);
    const d = rng.range(10, 14);
    blocks.push({
      x: cursor + w / 2,
      z: SITE.roadZ1 + d / 2 + rng.range(1.6, 2.8),
      w,
      d,
      h: rng.range(4.4, NEAR_MAX_H),
      body: rng.pick(bodies),
    });
    cursor += w + rng.range(0.8, 2.2);
  }

  // Right flank, also on the near side — kept low for the same reason.
  let z = SITE.lotZ0 - 2;
  while (z < SITE.lotZ1 + 6) {
    const d = rng.range(6, 10);
    const w = rng.range(9, 14);
    blocks.push({
      x: SITE.lotX1 + 9.5 + w / 2,
      z: z + d / 2,
      w,
      d,
      h: rng.range(4.0, NEAR_MAX_H),
      body: rng.pick(bodies),
    });
    z += d + rng.range(0.6, 1.4);
  }

  // Left flank sits behind the lot in screen space, so it can carry height and
  // give the block something to stand against.
  z = SITE.lotZ0 - 6;
  while (z < SITE.lotZ1 + 2) {
    const d = rng.range(7, 12);
    const w = rng.range(10, 16);
    blocks.push({
      x: SITE.lotX0 - 8.5 - w / 2,
      z: z + d / 2,
      w,
      d,
      h: rng.range(8, 17),
      body: rng.pick(bodies),
    });
    z += d + rng.range(0.6, 1.6);
  }

  // The far bank: the actual skyline, across the water and softened by haze.
  // Kept clear of the channel so nothing appears to stand in it.
  // Two ranks across the creek, so the far shore has depth rather than reading
  // as one wall. The near rank is low enough to keep the water visible.
  for (const [zBase, hMin, hMax, depth] of [
    [CREEK.farZ - 8, 5, 11, 11],
    [CREEK.farZ - 24, 14, 30, 18],
  ] as const) {
    cursor = -120;
    while (cursor < 120) {
      const w = rng.range(9, 19);
      blocks.push({
        x: cursor + w / 2,
        z: zBase - rng.range(0, 7),
        w,
        d: depth,
        h: rng.range(hMin, hMax),
        body: rng.pick(bodies),
      });
      cursor += w + rng.range(1.5, 4.5);
    }
  }

  for (const blk of blocks) {
    const base = 0.15;
    b.add(blk.body, bevelBox(blk.w, blk.h, blk.d, 0.1), [blk.x, base + blk.h / 2, blk.z]);
    // Parapet and a ground-floor plinth give the silhouette a top and a bottom.
    b.add(M.fascia, box(blk.w + 0.24, 0.34, blk.d + 0.24), [blk.x, base + blk.h + 0.1, blk.z]);
    b.add(M.concreteDark, box(blk.w + 0.12, 0.7, blk.d + 0.12), [blk.x, base + 0.35, blk.z]);

    // Window bands rather than individual windows — reads at this distance.
    const floors = Math.max(1, Math.floor((blk.h - 1.6) / 2.5));
    for (let f = 0; f < floors; f++) {
      const y = base + 1.9 + f * 2.5;
      if (y > base + blk.h - 0.8) break;
      b.add(M.glassDim, box(blk.w * 0.82, 0.95, blk.d + 0.06), [blk.x, y, blk.z]);
      b.add(M.glassDim, box(blk.w + 0.06, 0.95, blk.d * 0.82), [blk.x, y, blk.z]);
    }

    // A roof box or two so the skyline is not a flat comb.
    if (rng.chance(0.55)) {
      const rw = blk.w * rng.range(0.24, 0.42);
      const rh = rng.range(0.8, 2.1);
      b.add(M.roofFelt, bevelBox(rw, rh, blk.d * 0.32, 0.06), [
        blk.x + rng.range(-blk.w * 0.2, blk.w * 0.2),
        base + blk.h + rh / 2,
        blk.z + rng.range(-blk.d * 0.2, blk.d * 0.2),
      ]);
    }
    if (rng.chance(0.35)) {
      b.add(M.roofZinc, wedge(blk.w * 0.9, 1.5, blk.d * 0.9), [blk.x, base + blk.h + 0.9, blk.z]);
    }
  }

  return b.build("neighbours", true, true);
}
