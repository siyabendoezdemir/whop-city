import * as THREE from "three";

import { PartsBuilder, bevelBox, box, post, slab, wedge } from "../lib/geom";
import { Rng } from "../lib/rng";
import { ACTOR_SURFACE, M } from "../scene/materials";
import { Prop, type InstanceKit } from "./props";
import type { Rig } from "./actors";
import type { EdgeKind, Parcel } from "./parcel";

/**
 * The city plan.
 *
 * A promontory. Water to the north and to the west, meeting at a headland, with
 * the city filling the wedge of land between them. That shape is doing real
 * compositional work: in a fixed 45-degree isometric an axis-aligned shoreline
 * always runs diagonally across the frame, so a single coast leaves half the
 * picture dry. Two coasts meeting at a point put water along both top edges and
 * hand the whole lower frame to the city — which is also, conveniently, how San
 * Francisco is actually shaped.
 *
 * Districts are placed by where they land on screen rather than by tidy grid
 * logic: Commerce Core on the headland where the towers read against water,
 * Offer Forge on the west quay where the yard and crane get clear sky behind
 * them, Creator Quarter in the foreground where the camera is closest and the
 * fine grain is legible.
 */

export const WORLD = {
  /** Everything north of this is water. */
  northShore: -92,
  /** Everything west of this is water. */
  westShore: -74,
  /** Where the far banks start. */
  northFar: -122,
  westFar: -110,
  /** Canal inlet cut south out of the north bay. */
  canalX0: 32,
  canalX1: 42,
  canalEndZ: -36,
  bridgeZ: -84,
  ground: 0,
} as const;

export type Road = {
  axis: "x" | "z";
  at: number;
  from: number;
  to: number;
  width: number;
  grade: "boulevard" | "street" | "lane";
  gaps?: Array<[number, number]>;
};

export const ROADS: Road[] = [
  // North quay road, running the length of the headland and over the canal.
  {
    axis: "x",
    at: WORLD.bridgeZ,
    from: -70,
    to: 124,
    width: 10,
    grade: "street",
    gaps: [[WORLD.canalX0 - 6, WORLD.canalX1 + 6]],
  },
  // West quay road.
  { axis: "z", at: -66, from: -84, to: 44, width: 9.5, grade: "street" },
  // The boulevard through the middle of the city.
  { axis: "x", at: -18, from: -66, to: 104, width: 13, grade: "boulevard" },
  // Main cross street, headland to foreground.
  { axis: "z", at: 4, from: -84, to: 40, width: 10, grade: "street" },
  // Eastern cross street through the core.
  { axis: "z", at: 52, from: -84, to: -18, width: 9, grade: "street" },
  // Southern street behind the creator blocks.
  { axis: "x", at: 30, from: -66, to: 76, width: 9, grade: "street" },
  // Service lane behind the maker yards.
  { axis: "z", at: -30, from: -46, to: 16, width: 6.5, grade: "lane" },
];

const KERB_H = 0.15;

function inGap(road: Road, t: number): boolean {
  return Boolean(road.gaps?.some(([a, b]) => t > a && t < b));
}

/** Terrain, both bays, the canal, the bridge and the whole road network. */
export function buildCityGround(kit: InstanceKit, seed: number): THREE.Group {
  const rng = new Rng(seed).fork("city-ground");
  const b = new PartsBuilder();
  const kerbY = WORLD.ground + KERB_H;
  const N = WORLD.northShore;
  const W = WORLD.westShore;

  // -------------------------------------------------------------- landmass
  // One quadrant of land. The two bays are the space it does not occupy.
  b.add(M.concreteDark, box(300, 1.6, 300), [W + 150, WORLD.ground - 0.8, N + 150]);

  // Bays. Two planes at the same level so they read as one body of water.
  b.add(M.water, box(420, 0.12, N - WORLD.northFar), [10, WORLD.ground - 1.8, (N + WORLD.northFar) / 2]);
  b.add(M.water, box(W - WORLD.westFar, 0.12, 300), [(W + WORLD.westFar) / 2, WORLD.ground - 1.8, N + 150]);

  // Far banks, with a strip of built-up shore so the horizon is not empty.
  b.add(M.concreteDark, box(460, 1.8, 120), [10, WORLD.ground - 0.9, WORLD.northFar - 60]);
  b.add(M.concreteDark, box(120, 1.8, 340), [WORLD.westFar - 60, WORLD.ground - 0.9, N + 150]);

  // -------------------------------------------------------------- quays
  const quay = (
    alongX: boolean,
    at: number,
    from: number,
    to: number,
    outward: number,
  ) => {
    const len = to - from;
    const mid = (from + to) / 2;
    const pos = (off: number): [number, number, number] =>
      alongX ? [mid, 0, at + off] : [at + off, 0, mid];
    const wall = pos(outward * 0.4);
    b.add(M.concreteDark, box(alongX ? len : 1.4, 2.6, alongX ? 1.4 : len), [
      wall[0],
      WORLD.ground - 1.2,
      wall[2],
    ]);
    const cope = pos(outward * 0.4);
    b.add(M.kerb, slab(alongX ? len : 1.8, 0.18, alongX ? 1.8 : len, 0.05), [
      cope[0],
      WORLD.ground + 0.07,
      cope[2],
    ]);
    const walk = pos(-outward * 2.2);
    b.add(M.sidewalk, box(alongX ? len : 4.6, 0.2, alongX ? 4.6 : len), [
      walk[0],
      WORLD.ground + 0.06,
      walk[2],
    ]);
    for (let t = from + 4; t < to; t += 7) {
      const p = alongX ? [t, WORLD.ground, at - outward * 1.1] : [at - outward * 1.1, WORLD.ground, t];
      kit.place("bollard", p as [number, number, number], 0, 1.25);
    }
  };
  quay(true, N, -74, 130, -1);
  quay(false, W, N, 130, -1);

  // Mooring detail on the water: a pier and a barge on each bay.
  buildPier(b, kit, [-20, WORLD.ground, N], 0);
  buildBarge(b, [22, WORLD.ground, N - 13], 0.22);
  buildPier(b, kit, [W, WORLD.ground, 6], Math.PI / 2);
  buildBarge(b, [W - 12, WORLD.ground, 26], Math.PI / 2 + 0.14);

  // ----------------------------------------------------------- canal inlet
  const cw = WORLD.canalX1 - WORLD.canalX0;
  const cx = (WORLD.canalX0 + WORLD.canalX1) / 2;
  const clen = WORLD.canalEndZ - N;
  b.add(M.water, box(cw, 0.12, clen), [cx, WORLD.ground - 1.8, N + clen / 2]);
  for (const side of [-1, 1]) {
    const wx = cx + side * (cw / 2 + 0.45);
    b.add(M.concreteDark, box(0.9, 2.4, clen), [wx, WORLD.ground - 1.1, N + clen / 2]);
    b.add(M.kerb, slab(1.3, 0.16, clen, 0.04), [wx, WORLD.ground + 0.06, N + clen / 2]);
    b.add(M.sidewalk, box(3.2, 0.18, clen), [wx + side * 2.0, WORLD.ground + 0.05, N + clen / 2]);
    for (let z = N + 8; z < WORLD.canalEndZ - 4; z += 9) {
      kit.place("bollard", [wx - side * 1.0, WORLD.ground, z], 0, 1.1);
    }
    for (let z = N + 12; z < WORLD.canalEndZ - 6; z += 16) {
      Prop.lamp(kit, [wx + side * 3.2, WORLD.ground + 0.05, z], side > 0 ? -Math.PI / 2 : Math.PI / 2);
    }
  }
  // Stepped head, so the canal terminates rather than stopping.
  for (let i = 0; i < 5; i++) {
    b.add(M.concrete, box(cw + 2.2, 0.34, 1.2), [cx, WORLD.ground - 1.6 + i * 0.36, WORLD.canalEndZ + i * 1.2]);
  }

  buildBridge(b, kit);
  buildHeadland(b, kit, rng);

  // ----------------------------------------------------------------- roads
  for (const road of ROADS) {
    const alongX = road.axis === "x";
    const length = road.to - road.from;
    const mid = (road.from + road.to) / 2;
    const half = road.width / 2;
    const walkW = road.grade === "boulevard" ? 4.4 : road.grade === "street" ? 3.2 : 1.5;
    const place = (t: number, off: number): [number, number, number] =>
      alongX ? [t, 0, road.at + off] : [road.at + off, 0, t];

    const step = 4;
    for (let t = road.from; t < road.to; t += step) {
      if (inGap(road, t + step / 2)) continue;
      const p = place(t + step / 2, 0);
      b.add(
        road.grade === "lane" ? M.asphaltPatched : M.asphalt,
        box(alongX ? step : road.width, 0.24, alongX ? road.width : step),
        [p[0], WORLD.ground - 0.12, p[2]],
      );
    }

    for (const side of [-1, 1]) {
      const kp = place(mid, side * (half + 0.17));
      b.add(M.kerb, box(alongX ? length : 0.34, KERB_H, alongX ? 0.34 : length), [
        kp[0],
        WORLD.ground + KERB_H / 2,
        kp[2],
      ]);
      const wp = place(mid, side * (half + 0.34 + walkW / 2));
      b.add(M.sidewalk, box(alongX ? length : walkW, 0.18, alongX ? walkW : length), [
        wp[0],
        kerbY - 0.09,
        wp[2],
      ]);
      for (let t = road.from; t < road.to; t += 2.6) {
        const jp = place(t, side * (half + 0.34 + walkW / 2));
        b.add(M.sidewalkWorn, box(alongX ? 0.05 : walkW, 0.012, alongX ? walkW : 0.05), [
          jp[0],
          kerbY + 0.007,
          jp[2],
        ]);
      }
    }

    if (road.grade === "boulevard") {
      b.add(M.kerb, box(alongX ? length : 2.4, 0.2, alongX ? 2.4 : length), [
        alongX ? mid : road.at,
        WORLD.ground + 0.1,
        alongX ? road.at : mid,
      ]);
      b.add(M.grass, box(alongX ? length - 1 : 1.9, 0.1, alongX ? 1.9 : length - 1), [
        alongX ? mid : road.at,
        WORLD.ground + 0.2,
        alongX ? road.at : mid,
      ]);
      for (let t = road.from + 7; t < road.to - 5; t += 11) {
        const p = place(t, 0);
        Prop.tree(kit, [p[0], WORLD.ground + 0.24, p[2]], rng.range(0, 6.2), rng.range(0.92, 1.2));
      }
    } else if (road.grade !== "lane") {
      for (let t = road.from + 2; t < road.to; t += 6) {
        if (inGap(road, t)) continue;
        const p = place(t, 0);
        b.add(M.roadLine, box(alongX ? 3 : 0.16, 0.02, alongX ? 0.16 : 3), [p[0], WORLD.ground + 0.006, p[2]]);
      }
    }

    if (road.grade !== "lane") {
      for (let t = road.from + 9; t < road.to - 6; t += 13) {
        if (inGap(road, t)) continue;
        for (const side of [-1, 1]) {
          const p = place(t, side * (half + 1.6));
          b.add(M.dirt, box(1.5, 0.06, 1.5), [p[0], kerbY - 0.02, p[2]]);
          Prop.tree(kit, [p[0], kerbY, p[2]], rng.range(0, 6.2), rng.range(0.86, 1.12));
        }
      }
      for (let t = road.from + 16; t < road.to - 8; t += 23) {
        if (inGap(road, t)) continue;
        const p = place(t, half + 1.0);
        Prop.lamp(kit, [p[0], kerbY, p[2]], alongX ? Math.PI : Math.PI / 2);
      }
    }
  }

  // Zebra crossings at the two junctions the camera looks straight at.
  for (const [jx, jz] of [
    [4, -18],
    [52, -18],
    [4, -84],
  ] as const) {
    for (let i = 0; i < 7; i++) {
      b.add(M.roadLine, box(0.62, 0.02, 8), [jx - 3 + i, WORLD.ground + 0.008, jz + 10.5]);
    }
  }

  return b.build("city-ground", false, true);
}

/**
 * The headland: waterfront promenade and ferry terminal.
 *
 * The land between the two quay roads and the point is the first thing the eye
 * lands on, and left as bare paving it read as a car park. A promenade and a
 * working ferry berth give the point a reason to exist and put arriving people
 * at the top of the composition.
 */
function buildHeadland(b: PartsBuilder, kit: InstanceKit, rng: Rng): void {
  const N = WORLD.northShore;
  const y = WORLD.ground;

  // Promenade lawn and paving between the quay road and the water.
  b.add(M.grass, box(48, 0.14, 8.5), [-38, y + 0.13, N + 12.5]);
  b.add(M.sidewalk, box(48, 0.1, 3.0), [-38, y + 0.16, N + 6.6]);
  for (let i = 0; i < 8; i++) {
    const x = -60 + i * 6.2;
    Prop.tree(kit, [x, y + 0.2, N + 13.5], rng.range(0, 6.2), rng.range(0.95, 1.25));
  }
  for (const x of [-52, -40, -28]) Prop.bench(kit, [x, y + 0.2, N + 9.2], Math.PI);
  for (const x of [-56, -34, -22]) Prop.planter(kit, [x, y + 0.2, N + 8.0], 0);

  // Ferry terminal: a shed with a big canopy, on a raised deck at the water.
  const tx = -8;
  const tz = N + 4.5;
  b.add(M.concrete, box(20, 0.5, 11), [tx, y + 0.05, tz]);
  b.add(M.plaster, box(13.5, 5.2, 8.2), [tx, y + 2.9, tz]);
  b.add(M.concreteDark, box(13.9, 0.7, 8.6), [tx, y + 0.65, tz]);
  b.add(M.glass, box(12.0, 2.6, 8.35), [tx, y + 2.9, tz]);
  b.add(M.glass, box(13.6, 2.6, 7.0), [tx, y + 2.9, tz]);
  for (let i = 0; i <= 5; i++) b.add(M.fascia, box(0.22, 2.8, 8.45), [tx - 6 + i * 2.4, y + 2.9, tz]);
  b.add(M.fascia, box(14.2, 0.4, 8.9), [tx, y + 5.6, tz]);
  b.add(M.roofZinc, wedge(14.6, 1.5, 9.2), [tx, y + 6.6, tz]);
  b.add(M.signBoard, box(7.0, 0.9, 0.18), [tx, y + 6.1, tz + 4.6]);
  b.add(M.signLit, box(5.4, 0.42, 0.09), [tx, y + 6.1, tz + 4.72]);
  // Canopy over the berth, on slender columns.
  for (const ox of [-8.6, -2.9, 2.9, 8.6]) {
    b.add(M.steelPainted, post(0.16, 4.6, 8), [tx + ox, y + 2.4, tz - 6.6]);
  }
  b.add(M.steelPainted, box(19.5, 0.3, 0.34), [tx, y + 4.75, tz - 6.6]);
  b.add(M.glassDim, box(19.5, 0.12, 5.6), [tx, y + 4.9, tz - 4.2], [-0.05, 0, 0]);
  // Gangway and pontoon out over the water.
  b.add(M.ironDark, box(3.4, 0.24, 7.0), [tx + 3, y - 0.3, tz - 9.6], [0.09, 0, 0]);
  b.add(M.timberDark, box(9.0, 0.5, 4.4), [tx + 3, y - 1.05, tz - 14.2]);
  b.add(M.ironDark, box(9.2, 0.1, 0.1), [tx + 3, y - 0.2, tz - 16.3]);
  for (let i = 0; i <= 6; i++) b.add(M.ironDark, post(0.05, 0.8, 4), [tx - 1.4 + i * 1.5, y - 0.6, tz - 16.3]);
  kit.place("bollard", [tx - 1.5, y - 0.75, tz - 12.4], 0, 1.1);
  kit.place("bollard", [tx + 7.4, y - 0.75, tz - 12.4], 0, 1.1);
}

/**
 * Traffic.
 *
 * Empty carriageways were the loudest remaining tell that this was a model
 * rather than a place. Each vehicle is a single merged mesh under the shared
 * actor material, so a dozen of them cost a dozen draw calls, and each runs a
 * fixed loop along one carriageway at its own speed and phase.
 */
type VehicleKind = "car" | "hatch" | "bus" | "truck" | "pickup";

function vehicleGeometry(kind: VehicleKind, paint: THREE.Material): THREE.Group {
  const b = new PartsBuilder();
  const wheel = (ox: number, oz: number, r = 0.32) =>
    b.add(M.tyre, new THREE.CylinderGeometry(r, r, 0.22, 10), [ox, r, oz], [0, 0, Math.PI / 2]);

  if (kind === "bus") {
    b.add(paint, bevelBox(2.5, 2.5, 10.5, 0.22), [0, 1.65, 0]);
    b.add(M.glassDim, box(2.54, 1.0, 8.4), [0, 2.25, -0.4]);
    b.add(M.glassDim, box(2.2, 1.2, 0.1), [0, 2.2, 5.2]);
    b.add(M.plaster, box(2.56, 0.34, 10.4), [0, 0.72, 0]);
    b.add(M.roofZinc, box(2.3, 0.16, 10.0), [0, 2.95, 0]);
    b.add(M.aluminium, bevelBox(1.2, 0.3, 2.0, 0.06), [0.4, 3.1, -2.4]);
    b.add(M.signLit, box(1.5, 0.3, 0.08), [0, 2.75, 5.26]);
    for (const oz of [-3.6, 3.4]) {
      wheel(-1.16, oz, 0.42);
      wheel(1.16, oz, 0.42);
    }
  } else if (kind === "truck") {
    b.add(M.plaster, bevelBox(2.3, 1.7, 2.6, 0.16), [0, 1.5, 2.8]);
    b.add(M.glassDim, box(2.1, 0.7, 0.1), [0, 1.9, 4.06]);
    b.add(paint, bevelBox(2.4, 2.4, 6.0, 0.14), [0, 1.85, -1.2]);
    b.add(M.aluminium, box(2.44, 0.18, 5.8), [0, 3.0, -1.2]);
    b.add(M.ironDark, box(2.5, 0.34, 8.6), [0, 0.66, 0.6]);
    for (const oz of [-2.8, 2.6]) {
      wheel(-1.06, oz, 0.4);
      wheel(1.06, oz, 0.4);
    }
  } else if (kind === "pickup") {
    b.add(paint, bevelBox(2.0, 1.15, 2.5, 0.16), [0, 1.05, 0.9]);
    b.add(M.glassDim, box(1.85, 0.6, 2.2), [0, 1.5, 0.85]);
    b.add(paint, box(2.0, 0.6, 2.6), [0, 0.78, -1.5]);
    b.add(M.ironDark, box(1.7, 0.34, 2.2), [0, 0.9, -1.5]);
    b.add(M.plaster, box(2.04, 0.26, 5.4), [0, 0.6, 0]);
    for (const oz of [-1.5, 1.5]) {
      wheel(-0.94, oz, 0.33);
      wheel(0.94, oz, 0.33);
    }
  } else {
    const long = kind === "car";
    b.add(paint, bevelBox(1.95, 0.85, long ? 4.4 : 3.6, 0.22), [0, 0.78, 0]);
    b.add(paint, bevelBox(1.7, 0.72, long ? 2.1 : 1.9, 0.24), [0, 1.42, long ? -0.2 : 0.1]);
    b.add(M.glassDim, box(1.74, 0.5, long ? 1.9 : 1.7), [0, 1.5, long ? -0.2 : 0.1]);
    b.add(M.ironDark, box(1.99, 0.2, long ? 4.3 : 3.5), [0, 0.5, 0]);
    b.add(M.signLit, box(1.3, 0.14, 0.08), [0, 0.85, long ? 2.22 : 1.82]);
    for (const oz of long ? [-1.5, 1.5] : [-1.2, 1.2]) {
      wheel(-0.88, oz);
      wheel(0.88, oz);
    }
  }
  return b.buildSingle(`vehicle-${kind}`, ACTOR_SURFACE);
}

const PAINTS = [M.vanBody, M.accent, M.renderTeal, M.plaster, M.accentDeep, M.ironDark, M.vanAccent];

export function buildTraffic(seed: number): Rig[] {
  const rng = new Rng(seed).fork("traffic");
  const rigs: Rig[] = [];
  const y = WORLD.ground + 0.02;

  // Route, lane offset and how many vehicles share it.
  const routes: Array<{ road: Road; lane: number; count: number; speed: number }> = [
    { road: ROADS[2], lane: 4.2, count: 4, speed: 7.5 },
    { road: ROADS[2], lane: -4.2, count: 3, speed: 6.8 },
    { road: ROADS[0], lane: 2.6, count: 2, speed: 8.4 },
    { road: ROADS[3], lane: 2.7, count: 2, speed: 6.2 },
    { road: ROADS[1], lane: -2.6, count: 2, speed: 5.6 },
  ];

  for (const route of routes) {
    const { road, lane } = route;
    const alongX = road.axis === "x";
    // Nearside lane runs one way, offside the other, as a real street does.
    const forward = lane > 0;
    const span = road.to - road.from;
    for (let i = 0; i < route.count; i++) {
      const kind: VehicleKind = rng.pick(["car", "hatch", "hatch", "car", "pickup", "bus", "truck"]);
      const group = vehicleGeometry(kind, rng.pick(PAINTS));
      const offset = (i + rng.range(0.05, 0.4)) / route.count;
      const speed = route.speed * rng.range(0.85, 1.15);
      const heading = alongX
        ? forward
          ? Math.PI / 2
          : -Math.PI / 2
        : forward
          ? 0
          : Math.PI;
      group.rotation.y = heading;
      rigs.push({
        group,
        update: (t: number) => {
          const p = ((t * speed) / span + offset) % 1;
          const travel = forward ? road.from + p * span : road.to - p * span;
          if (alongX) group.position.set(travel, y, road.at + lane);
          else group.position.set(road.at + lane, y, travel);
          // Hide while crossing a bridge gap in the carriageway.
          group.visible = !inGap(road, travel);
        },
      });
    }
  }

  return rigs;
}

/**
 * Water life.
 *
 * A ferry working the bay between the headland terminal and the far bank. The
 * water was the one part of the composition with nothing happening in it, and a
 * boat crossing it does more for the sense of a living place than any number of
 * extra pedestrians would.
 */
export function buildWaterLife(): Rig[] {
  const b = new PartsBuilder();
  const y = WORLD.ground;

  b.add(M.plaster, box(6.4, 1.7, 21), [0, y - 1.5, 0]);
  b.add(M.plaster, wedge(6.4, 1.7, 4.6), [0, y - 1.5, 12.8], [0, Math.PI, 0]);
  b.add(M.accentDeep, box(6.6, 0.42, 21.2), [0, y - 0.72, 0]);
  b.add(M.timberPale, box(6.2, 0.22, 20.6), [0, y - 0.5, 0]);
  b.add(M.plaster, box(5.0, 2.5, 11.5), [0, y + 0.85, -1.6]);
  b.add(M.glass, box(5.1, 1.3, 11.6), [0, y + 1.3, -1.6]);
  for (let i = 0; i <= 5; i++) b.add(M.fascia, box(0.16, 1.5, 11.7), [-2.2 + i * 0.88, y + 1.3, -1.6]);
  b.add(M.fascia, box(5.4, 0.3, 11.9), [0, y + 2.25, -1.6]);
  b.add(M.plaster, box(3.4, 1.8, 3.6), [0, y + 3.3, -4.4]);
  b.add(M.glass, box(3.5, 0.9, 3.7), [0, y + 3.5, -4.4]);
  b.add(M.roofZinc, box(3.8, 0.22, 3.9), [0, y + 4.3, -4.4]);
  b.add(M.steel, post(0.12, 2.6, 6), [0, y + 5.6, -4.4]);
  b.add(M.accent, box(0.1, 0.7, 1.1), [0, y + 6.4, -3.9]);
  for (const ox of [-2.6, 2.6]) {
    for (const oz of [-8, 0, 8]) b.add(M.ironDark, post(0.05, 0.9, 4), [ox, y + 0.1, oz]);
    b.add(M.ironDark, box(0.07, 0.07, 19), [ox, y + 0.52, 0]);
  }

  const hull = b.build("ferry");

  // Wake: two flat wedges that stretch with speed, so the boat looks driven.
  const wake = new PartsBuilder();
  wake.add(M.sidewalk, wedge(9, 0.06, 16), [0, y - 1.72, -11], [0, Math.PI, 0]);
  const wakeMesh = wake.build("ferry-wake");
  wakeMesh.children.forEach((c) => {
    if (c instanceof THREE.Mesh) {
      c.castShadow = false;
      c.receiveShadow = false;
    }
  });

  const group = new THREE.Group();
  group.add(hull, wakeMesh);

  // Fixed route across the north bay, looping with a pause at each end.
  const a = new THREE.Vector3(-4, 0, WORLD.northShore - 9);
  const c = new THREE.Vector3(96, 0, WORLD.northFar + 22);
  const period = 46;

  return [
    {
      group,
      update: (t: number) => {
        const cycle = (t % period) / period;
        // Out, hold, back, hold.
        let s: number;
        let heading: number;
        if (cycle < 0.42) {
          s = cycle / 0.42;
          heading = 1;
        } else if (cycle < 0.5) {
          s = 1;
          heading = 1;
        } else if (cycle < 0.92) {
          s = 1 - (cycle - 0.5) / 0.42;
          heading = -1;
        } else {
          s = 0;
          heading = -1;
        }
        const eased = s * s * (3 - 2 * s);
        group.position.lerpVectors(a, c, eased);
        group.position.y = Math.sin(t * 0.9) * 0.1;
        const dir = c.clone().sub(a).multiplyScalar(heading);
        group.rotation.y = Math.atan2(dir.x, dir.z);
        group.rotation.z = Math.sin(t * 0.7) * 0.018;
        // Wake only while under way.
        const moving = cycle < 0.42 || (cycle >= 0.5 && cycle < 0.92);
        wakeMesh.visible = moving;
        wakeMesh.scale.z = moving ? 1 : 0.001;
      },
    },
  ];
}

/** A timber pier out over the water. */
function buildPier(b: PartsBuilder, kit: InstanceKit, at: [number, number, number], yaw: number): void {
  const inner = new PartsBuilder();
  inner.add(M.timberDark, box(5.0, 0.34, 17), [0, -0.17, -8.5]);
  for (let i = 0; i < 6; i++) {
    for (const ox of [-2.0, 2.0]) {
      inner.add(M.timberDark, post(0.22, 2.6, 6), [ox, -1.5, -1.6 - i * 3.0]);
    }
  }
  for (let i = 0; i <= 8; i++) {
    for (const ox of [-2.4, 2.4]) {
      inner.add(M.timberDark, post(0.1, 1.0, 5), [ox, 0.4, -1.0 - i * 2.0]);
    }
  }
  for (const ox of [-2.4, 2.4]) inner.add(M.ironDark, box(0.08, 0.08, 16.4), [ox, 0.88, -8.4]);
  const group = inner.build("pier");
  group.position.set(...at);
  group.rotation.y = yaw;
  group.updateMatrixWorld(true);
  group.traverse((c) => {
    if (c instanceof THREE.Mesh) b.add(c.material as THREE.Material, c.geometry.clone().applyMatrix4(c.matrixWorld));
  });
  const nose = new THREE.Vector3(0, 0, -16).applyEuler(new THREE.Euler(0, yaw, 0));
  kit.place("bollard", [at[0] + nose.x, at[1] + 0.2, at[2] + nose.z], 0, 1.3);
}

/** A moored barge, so the water is worked rather than decorative. */
function buildBarge(b: PartsBuilder, at: [number, number, number], yaw: number): void {
  const inner = new PartsBuilder();
  inner.add(M.steelRust, box(6.5, 1.5, 17), [0, -0.6, 0]);
  inner.add(M.steelRust, wedge(6.5, 1.5, 3.4), [0, -0.6, 9.7], [0, Math.PI, 0]);
  inner.add(M.ironDark, box(6.9, 0.34, 17.4), [0, 0.2, 0]);
  inner.add(M.steel, box(5.4, 0.5, 12.5), [0, 0.0, -1.2]);
  inner.add(M.plaster, box(4.4, 2.4, 3.6), [0, 1.4, -6.4]);
  inner.add(M.glassDim, box(4.5, 0.8, 3.7), [0, 2.0, -6.4]);
  inner.add(M.roofZinc, box(4.8, 0.22, 3.9), [0, 2.7, -6.4]);
  inner.add(M.steel, post(0.16, 2.2, 6), [1.4, 3.7, -6.4]);
  for (let i = 0; i < 3; i++) {
    inner.add(i % 2 ? M.accentDeep : M.renderTeal, box(2.2, 2.0, 2.4), [
      i === 1 ? 0 : i === 0 ? -1.3 : 1.3,
      1.3,
      1.4 + i * 2.8,
    ]);
  }
  const group = inner.build("barge");
  group.position.set(...at);
  group.rotation.y = yaw;
  group.updateMatrixWorld(true);
  group.traverse((c) => {
    if (c instanceof THREE.Mesh) b.add(c.material as THREE.Material, c.geometry.clone().applyMatrix4(c.matrixWorld));
  });
}

/** The bridge carrying the quay road over the canal. */
function buildBridge(b: PartsBuilder, kit: InstanceKit): void {
  const cx = (WORLD.canalX0 + WORLD.canalX1) / 2;
  const span = WORLD.canalX1 - WORLD.canalX0 + 13;
  const z = WORLD.bridgeZ;
  const w = 11.5;
  const deckY = WORLD.ground + 0.4;

  b.add(M.concrete, box(span, 0.6, w), [cx, deckY - 0.22, z]);
  b.add(M.asphalt, box(span - 0.6, 0.13, w - 2.8), [cx, deckY + 0.12, z]);
  for (const side of [-1, 1]) {
    b.add(M.kerb, box(span, 0.22, 0.42), [cx, deckY + 0.18, z + side * (w / 2 - 1.4)]);
    b.add(M.sidewalk, box(span, 0.15, 1.2), [cx, deckY + 0.14, z + side * (w / 2 - 0.65)]);
    b.add(M.concreteDark, box(span, 0.55, 0.3), [cx, deckY + 0.46, z + side * (w / 2)]);
    b.add(M.steelPainted, box(span, 0.11, 0.11), [cx, deckY + 1.3, z + side * (w / 2)]);
    for (let i = 0; i <= 14; i++) {
      b.add(M.steelPainted, post(0.055, 0.9, 5), [cx - span / 2 + (span / 14) * i, deckY + 0.9, z + side * (w / 2)]);
    }
  }
  for (const side of [-1, 1]) {
    b.add(M.concreteDark, box(4.0, 3.0, w + 1.2), [cx + side * (span / 2 - 1.4), WORLD.ground - 1.2, z]);
  }
  for (const ox of [-4.0, 4.0]) {
    b.add(M.concreteDark, box(1.9, 3.0, w - 2.4), [cx + ox, WORLD.ground - 1.5, z]);
    b.add(M.concreteDark, wedge(1.9, 0.9, w - 2.4), [cx + ox, WORLD.ground - 3.0, z]);
  }
  for (const ox of [-span / 2 + 3.5, 0, span / 2 - 3.5]) {
    Prop.lamp(kit, [cx + ox, deckY + 0.35, z + w / 2 - 0.7], Math.PI);
  }
}

/**
 * Surrounding massing.
 *
 * Fills the land beyond the authored districts and the far banks across both
 * bays, so the city has a horizon instead of an edge. Everything on the near
 * side of the frame is held low deliberately — the foreground belongs to the
 * Creator Quarter, and a tall block there would sit in front of it.
 */
export function buildSurroundings(seed: number): THREE.Group {
  const rng = new Rng(seed).fork("surroundings");
  const b = new PartsBuilder();
  const bodies = [M.brick, M.renderCream, M.renderTeal, M.plaster, M.brickDark, M.renderClay];

  type Blk = { x: number; z: number; w: number; d: number; h: number };
  const blocks: Blk[] = [];

  const rowX = (z: number, from: number, to: number, hMin: number, hMax: number, depth: number) => {
    let cursor = from;
    while (cursor < to) {
      const w = rng.range(9, 18);
      blocks.push({ x: cursor + w / 2, z, w, d: depth, h: rng.range(hMin, hMax) });
      cursor += w + rng.range(1.4, 3.6);
    }
  };
  const rowZ = (x: number, from: number, to: number, hMin: number, hMax: number, depth: number) => {
    let cursor = from;
    while (cursor < to) {
      const d = rng.range(9, 18);
      blocks.push({ x, z: cursor + d / 2, w: depth, d, h: rng.range(hMin, hMax) });
      cursor += d + rng.range(1.4, 3.6);
    }
  };

  // East of the core: mid-rise continuing the downtown grain off-frame.
  rowZ(74, -80, -26, 8, 15, 16);
  rowZ(98, -80, -10, 10, 22, 17);
  rowX(-56, 68, 130, 8, 17, 15);
  // South and south-east: held low and pushed back, so nothing stands in front
  // of the Creator Quarter in the foreground.
  rowX(64, 30, 124, 4.5, 7.5, 15);
  // West side, behind the forge and running off the left edge.
  rowX(66, -58, 12, 4.5, 7.5, 15);
  // Far bank north.
  rowX(WORLD.northFar - 12, -170, 230, 9, 20, 20);
  rowX(WORLD.northFar - 34, -170, 230, 12, 30, 24);
  // Far bank west.
  rowZ(WORLD.westFar - 12, -150, 190, 8, 18, 20);
  rowZ(WORLD.westFar - 34, -150, 190, 11, 28, 24);

  for (const blk of blocks) {
    const base = 0.15;
    b.add(rng.pick(bodies), box(blk.w, blk.h, blk.d), [blk.x, base + blk.h / 2, blk.z]);
    b.add(M.fascia, box(blk.w + 0.3, 0.34, blk.d + 0.3), [blk.x, base + blk.h + 0.08, blk.z]);
    // A dark deck sitting proud of the parapet. Without it the lit top face of
    // every box reads as a white slab and the massing glares.
    b.add(M.gravel, box(blk.w - 0.25, 0.24, blk.d - 0.25), [blk.x, base + blk.h + 0.2, blk.z]);
    b.add(M.concreteDark, box(blk.w + 0.15, 0.75, blk.d + 0.15), [blk.x, base + 0.37, blk.z]);
    const floors = Math.max(1, Math.floor((blk.h - 1.6) / 2.7));
    for (let f = 0; f < floors; f++) {
      const y = base + 2.0 + f * 2.7;
      if (y > base + blk.h - 0.9) break;
      b.add(M.glassDim, box(blk.w * 0.8, 1.1, blk.d + 0.06), [blk.x, y, blk.z]);
      b.add(M.glassDim, box(blk.w + 0.06, 1.1, blk.d * 0.8), [blk.x, y, blk.z]);
    }
    if (rng.chance(0.5)) {
      const rw = blk.w * rng.range(0.22, 0.4);
      const rh = rng.range(0.9, 2.4);
      b.add(M.aluminium, box(rw, rh, blk.d * 0.3), [
        blk.x + rng.range(-blk.w * 0.2, blk.w * 0.2),
        base + blk.h + rh / 2,
        blk.z + rng.range(-blk.d * 0.2, blk.d * 0.2),
      ]);
    }
  }

  return b.build("surroundings", true, true);
}

// ---------------------------------------------------------------------------
// Parcels
// ---------------------------------------------------------------------------

const E = (front: EdgeKind, back: EdgeKind, left: EdgeKind, right: EdgeKind) => ({
  front,
  back,
  left,
  right,
});

/** Frontage facing west, for the plots along the west quay. */
const FACE_WEST = -Math.PI / 2;
/** Frontage facing south, for the plots on the north side of the boulevard. */
const FACE_SOUTH = 0;
/** Frontage facing north, for the plots on the south side of the boulevard. */
const FACE_NORTH = Math.PI;

/**
 * The authored parcel layout.
 *
 * Three districts with deliberately different grain. Commerce Core is deep
 * plots on the headland; Offer Forge is wide shallow waterfront plots served by
 * a rear lane; Creator Quarter is a fine-grained run of small plots in the
 * foreground.
 */
export const PARCELS: Parcel[] = [
  // ------------------------------------------------- Commerce Core (headland)
  {
    id: "core-landmark",
    centre: { x: 20, z: -62 },
    width: 28,
    depth: 22,
    yaw: FACE_SOUTH,
    edges: E("street", "street", "street", "street"),
    level: 0.21,
  },
  {
    id: "core-north",
    centre: { x: -12, z: -64 },
    width: 26,
    depth: 26,
    yaw: FACE_SOUTH,
    edges: E("street", "street", "street", "street"),
    level: 0.21,
  },
  {
    id: "core-east",
    centre: { x: 20, z: -34 },
    width: 28,
    depth: 18,
    yaw: FACE_NORTH,
    edges: E("boulevard", "street", "street", "street"),
    level: 0.21,
  },
  {
    id: "core-southeast",
    centre: { x: -14, z: -34 },
    width: 22,
    depth: 18,
    yaw: FACE_NORTH,
    edges: E("boulevard", "street", "street", "street"),
    level: 0.21,
  },

  // -------------------------------------------------- Offer Forge (west quay)
  // Rotated: frontage looks west at the quay road, service lane behind.
  {
    id: "forge-hero",
    centre: { x: -46, z: -8 },
    width: 32,
    depth: 20,
    yaw: FACE_WEST,
    edges: E("street", "alley", "neighbour", "street"),
    level: 0.21,
  },
  {
    id: "forge-north",
    centre: { x: -46, z: -42 },
    width: 26,
    depth: 20,
    yaw: FACE_WEST,
    edges: E("street", "alley", "street", "neighbour"),
    level: 0.21,
  },
  {
    id: "forge-south",
    centre: { x: -46, z: 22 },
    width: 22,
    depth: 20,
    yaw: FACE_WEST,
    edges: E("street", "alley", "neighbour", "street"),
    level: 0.21,
  },

  // ------------------------------------------------ Creator Quarter (near)
  {
    id: "creator-park",
    centre: { x: -14, z: 8 },
    width: 26,
    depth: 26,
    yaw: FACE_NORTH,
    edges: E("boulevard", "street", "street", "park"),
    level: 0.21,
  },
  {
    id: "creator-terrace",
    centre: { x: 18, z: 8 },
    width: 24,
    depth: 26,
    yaw: FACE_NORTH,
    edges: E("boulevard", "street", "park", "street"),
    level: 0.21,
  },
  {
    id: "creator-venue",
    centre: { x: 48, z: 8 },
    width: 26,
    depth: 26,
    yaw: FACE_NORTH,
    edges: E("boulevard", "street", "street", "neighbour"),
    level: 0.21,
  },
  // The one struggling sub-lot: small, in-frame, clearly the odd one out.
  {
    id: "creator-struggling",
    centre: { x: 72, z: 8 },
    width: 16,
    depth: 26,
    yaw: FACE_NORTH,
    edges: E("boulevard", "street", "neighbour", "street"),
    level: 0.21,
  },
];
