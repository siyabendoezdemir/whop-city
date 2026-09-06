import * as THREE from "three";

import { PartsBuilder, bevelBox, box, post, slab, wedge } from "../lib/geom";
import { Rng } from "../lib/rng";
import { ACTOR_SURFACE, M } from "../scene/materials";
import { Prop, type InstanceKit } from "./props";
import { makePerson, type Rig } from "./actors";
import type { EdgeKind, Parcel } from "./parcel";
import {
  crossingsOn,
  deckHeight,
  drivableCore,
  findCircuit,
  buildRoadGraph,
  subtract,
  walkwayWidth,
  type Circuit,
  type Road,
} from "./roads";

export type { Road } from "./roads";

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

/** How far out anything laid on the ground is allowed to run. */
export const REACH = 460;

/**
 * The network.
 *
 * Every road now ends in one of exactly two ways: at another road, or off the
 * edge of the world. The previous layout had seven roads and five of them
 * simply stopped in mid-air, which is the single most model-like thing a city
 * can do — a real street either meets something or carries on past where you
 * can see. A ring road closes the east and south sides, and two highways leave
 * town and run out into the fog.
 */
/**
 * How far a road runs past the junction at its end.
 *
 * Where two roads both *end* at the same crossroads — the four corners of the
 * ring — the one that gives way has its carriageway cut out of the junction,
 * and the one laid through stopped dead on the other's centre line. That left
 * a five-by-ten-metre rectangle of bare ground at each outside corner of the
 * network, and a vehicle turning there had its nose over grass. The through
 * road runs on to the far kerb instead. The overrun is inside the crossing
 * road's own width, so nothing new is visible except the corner being paved.
 */
const CORNER_OVERRUN = 4.5;

export const ROADS: Road[] = [
  // North quay road, running the length of the headland and over the canal.
  {
    id: "quay-north",
    axis: "x",
    at: WORLD.bridgeZ,
    from: -66 - CORNER_OVERRUN,
    to: 128 + CORNER_OVERRUN,
    width: 10,
    grade: "street",
    gaps: [[WORLD.canalX0 - 6.5, WORLD.canalX1 + 6.5]],
    decks: [{ from: WORLD.canalX0 - 6.5, to: WORLD.canalX1 + 6.5, height: 0.585 }],
  },
  // West quay road, from the headland down to the southern edge of town.
  { id: "quay-west", axis: "z", at: -66, from: -84, to: 66, width: 9.5, grade: "street" },
  // The boulevard through the middle of the city, and on out of it.
  { id: "boulevard", axis: "x", at: -18, from: -66, to: REACH, width: 13, grade: "boulevard", open: "to" },
  // Main cross street, headland to the southern street.
  { id: "cross-mid", axis: "z", at: 4, from: -84, to: 30, width: 10, grade: "street" },
  // Eastern cross street through the core.
  { id: "cross-east", axis: "z", at: 52, from: -84, to: -18, width: 9, grade: "street" },
  // Southern street behind the creator blocks.
  { id: "south-street", axis: "x", at: 30, from: -66, to: 128, width: 9, grade: "street" },
  // Service lane behind the maker yards, quay road to southern street.
  { id: "forge-lane", axis: "z", at: -30, from: -84, to: 30, width: 6.5, grade: "lane" },
  // Ring road closing the east side.
  { id: "ring-east", axis: "z", at: 128, from: -84, to: 66, width: 10, grade: "street" },
  // Ring road closing the south side.
  {
    id: "ring-south",
    axis: "x",
    at: 66,
    from: -66 - CORNER_OVERRUN,
    to: 128 + CORNER_OVERRUN,
    width: 10,
    grade: "street",
  },
  // The road south, out of town and over the hill.
  { id: "highway-south", axis: "z", at: 88, from: 66, to: REACH, width: 10, grade: "street", open: "to" },
];

const KERB_H = 0.15;
/**
 * Carriageway marking width.
 *
 * The default framing shows about 9.5 pixels per world unit, so anything under
 * roughly 0.25m is sub-pixel and cannot be rasterised stably — it crawls as the
 * camera moves. This is the floor for painted road detail.
 */
const MARKING_W = 0.3;

/** Terrain, both bays, the canal, the bridge and the whole road network. */
export function buildCityGround(kit: InstanceKit, seed: number): THREE.Group {
  const rng = new Rng(seed).fork("city-ground");
  const b = new PartsBuilder();
  const N = WORLD.northShore;
  const W = WORLD.westShore;

  buildLand(b);

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
  for (const side of [-1, 1]) {
    const wx = cx + side * (cw / 2 + 0.45);
    b.add(M.concreteDark, box(1.4, 3.2, clen), [wx, WORLD.ground - 1.5, N + clen / 2]);
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
  for (const road of ROADS) buildRoad(b, kit, rng, road);
  buildJunctions(b);

  return b.build("city-ground", false, true);
}

/**
 * One road, aware of everything that crosses it.
 *
 * Each layer — carriageway, kerb, footway, median, markings, planting — asks
 * the network which stretches belong to a junction and simply does not lay
 * itself there. A junction is then a clear square of asphalt with a footway
 * corner at each side, instead of the previous pile-up of a raised pavement
 * crossing a carriageway and a planted central reservation sealing the mouth
 * of the side street.
 */
function buildRoad(b: PartsBuilder, kit: InstanceKit, rng: Rng, road: Road): void {
  const alongX = road.axis === "x";
  const half = road.width / 2;
  const walkW = walkwayWidth(road.grade);
  const kerbY = WORLD.ground + KERB_H;
  const crossings = crossingsOn(road, ROADS);
  const place = (t: number, off: number): [number, number, number] =>
    alongX ? [t, 0, road.at + off] : [road.at + off, 0, t];
  const along = (from: number, to: number, width: number) =>
    alongX ? ([to - from, width] as const) : ([width, to - from] as const);

  // Where this road gives way: the other carriageway is laid through, so this
  // one stops at its kerb line rather than doubling up on the same plane.
  const yieldsTo = crossings
    .filter((c) => c.yields)
    .map((c) => [c.at - c.half, c.at + c.half] as const);
  const surface = road.grade === "lane" ? M.asphaltPatched : M.asphalt;
  const holes = [...yieldsTo, ...(road.gaps ?? [])];

  for (const [from, to] of subtract(road.from, road.to, holes)) {
    const [w, d] = along(from, to, road.width);
    const p = place((from + to) / 2, 0);
    b.add(surface, box(w, 0.24, d), [p[0], WORLD.ground - 0.12, p[2]]);
  }

  // Kerb and footway stop clear of every junction, on both sides.
  const corners = crossings.map((c) => [c.at - c.reach, c.at + c.reach] as const);
  const edgeHoles = [...corners, ...(road.gaps ?? [])];
  for (const side of [-1, 1]) {
    for (const [from, to] of subtract(road.from, road.to, edgeHoles)) {
      const kp = place((from + to) / 2, side * (half + 0.17));
      const [kw, kd] = along(from, to, 0.34);
      b.add(M.kerb, box(kw, KERB_H, kd), [kp[0], WORLD.ground + KERB_H / 2, kp[2]]);
      const wp = place((from + to) / 2, side * (half + 0.34 + walkW / 2));
      const [ww, wd] = along(from, to, walkW);
      b.add(M.sidewalk, box(ww, 0.18, wd), [wp[0], kerbY - 0.09, wp[2]]);
      // Paving joints used to be modelled here as 5cm plates. At the default
      // framing 5cm is under half a pixel, so every one of them landed on a
      // different part of the pixel grid as the camera crept along and popped
      // in and out — the footways crawled. M.sidewalk already carries a
      // procedural paving-seam texture, which is the right place for detail
      // this fine, so the geometry is gone and nothing is lost.
    }
  }

  if (road.grade === "boulevard") {
    // Central reservation, broken at every junction so traffic can turn across
    // it and so the side streets are not walled off.
    for (const [from, to] of subtract(road.from, road.to, edgeHoles)) {
      const mid = (from + to) / 2;
      const [kw, kd] = along(from, to, 2.4);
      b.add(M.kerb, box(kw, 0.2, kd), [
        alongX ? mid : road.at,
        WORLD.ground + 0.1,
        alongX ? road.at : mid,
      ]);
      const [gw, gd] = along(from + 0.5, to - 0.5, 1.9);
      b.add(M.grass, box(gw, 0.1, gd), [
        alongX ? mid : road.at,
        WORLD.ground + 0.2,
        alongX ? road.at : mid,
      ]);
      for (let t = from + 5; t < to - 3; t += 11) {
        const p = place(t, 0);
        Prop.tree(kit, [p[0], WORLD.ground + 0.24, p[2]], rng.range(0, 6.2), rng.range(0.92, 1.2));
      }
    }
  } else if (road.grade !== "lane") {
    // A real lane marking is about 15cm, which is 1.4 pixels here and
    // therefore crawls. Widened until it survives the pixel grid: at this
    // scale the line still reads as a lane marking and it stops flickering.
    for (const [from, to] of subtract(road.from, road.to, [...corners, ...holes])) {
      for (let t = from + 2; t < to - 1; t += 6) {
        const p = place(t, 0);
        b.add(M.roadLine, box(...boxSpan(alongX, 3, MARKING_W), 0.02), [
          p[0],
          WORLD.ground + 0.006,
          p[2],
        ]);
      }
    }
  }

  if (road.grade !== "lane") {
    const verge = subtract(road.from + 4, road.to - 4, edgeHoles);
    for (const [from, to] of verge) {
      // Street furniture is a town thing. Out on the highway the verge is
      // planted with an avenue rather than a pavement's worth of pits and
      // lanterns — which reads better and stops a road that runs to the fog
      // from costing as much as the city it leaves.
      const town = inTown(alongX ? (from + to) / 2 : road.at, alongX ? road.at : (from + to) / 2);
      const spacing = town ? 13 : 30;
      for (let t = from + 5; t < to - 3; t += spacing) {
        for (const side of [-1, 1]) {
          const p = place(t, side * (half + 1.6));
          if (town) b.add(M.dirt, box(1.5, 0.06, 1.5), [p[0], kerbY - 0.02, p[2]]);
          if (town) Prop.tree(kit, [p[0], kerbY, p[2]], rng.range(0, 6.2), rng.range(0.86, 1.12));
          else kit.place("tree.far", [p[0], kerbY - 0.1, p[2]], rng.range(0, 6.2), rng.range(0.8, 1.1));
        }
      }
      if (!town) continue;
      for (let t = from + 12; t < to - 6; t += 23) {
        const p = place(t, half + 1.0);
        Prop.lamp(kit, [p[0], kerbY, p[2]], alongX ? Math.PI : Math.PI / 2);
      }
    }
  }
}

/** The rectangle the built city occupies. Everything outside it is country. */
export function inTown(x: number, z: number): boolean {
  return x > -84 && x < 148 && z > -100 && z < 96;
}

/** Box dimensions for something that runs along X or along Z. */
function boxSpan(alongX: boolean, length: number, width: number): [number, number] {
  return alongX ? [length, width] : [width, length];
}

/**
 * A flat slab cut from an outline given in world XZ.
 *
 * `ExtrudeGeometry` works in the shape's own XY plane and extrudes along +Z, so
 * the outline goes in as (x, −z) and the result is laid down and pushed up from
 * y = 0 to y = `thickness`. One-off geometry by definition: every junction
 * corner is a different polygon, so none of this is worth caching.
 */
function pad(outline: ReadonlyArray<readonly [number, number]>, thickness: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  outline.forEach(([x, z], i) => (i === 0 ? shape.moveTo(x, -z) : shape.lineTo(x, -z)));
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * How much is taken off the square at a junction corner, and in how many steps.
 *
 * Three metres is the small end of a real kerb radius and about as much as the
 * narrower footways here can give up. Four segments is enough that the arc
 * reads as a curve at every framing the game allows.
 */
const CORNER_RADIUS = 3.0;
const CORNER_STEPS = 4;

/**
 * The junctions themselves: footway corners and crossing stripes.
 *
 * Built from the network rather than from a hand-written list of coordinates,
 * so a road added to the plan gets proper corners without anyone remembering
 * to come back here.
 *
 * The corners are radiused. They used to be square boxes of footway butted
 * into a square hole in the carriageway, which is wrong twice over. It looks
 * wrong — a right-angled kerb is a thing you only see in a plan drawing, and at
 * this camera the junctions read as a paint job rather than as junctions. And
 * it drives wrong: traffic turning at a junction follows an arc that cuts
 * inside the corner, and a nine-metre bus cuts further inside than that, so
 * what the player kept seeing was a coach mounting the pavement at a crossroads.
 * A three-metre radius gives back about the two metres of diagonal the turn
 * needs.
 */
function buildJunctions(b: PartsBuilder): void {
  const kerbY = WORLD.ground + KERB_H;
  const seen = new Set<string>();

  for (const road of ROADS) {
    if (road.axis !== "x") continue;
    for (const cross of crossingsOn(road, ROADS)) {
      const key = `${cross.at}:${road.at}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const halfX = cross.half;
      const halfZ = road.width / 2;
      const walkX = walkwayWidth(cross.other.grade);
      const walkZ = walkwayWidth(road.grade);
      const surface = road.grade === "lane" && cross.other.grade === "lane" ? M.asphaltPatched : M.asphalt;

      // A paved corner in each quadrant, joining the two footways round the
      // turn. Without these the pavement simply stopped at every junction.
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          // The centre the kerb curves about: one radius in from each kerb
          // line, so the arc is tangent to both.
          const radius = Math.min(CORNER_RADIUS, walkX * 0.95, walkZ * 0.95);
          const ox = cross.at + sx * (halfX + radius);
          const oz = road.at + sz * (halfZ + radius);
          /** A point on the corner arc, at `r` from the centre. */
          const on = (r: number, i: number): [number, number] => {
            const a = (Math.PI / 2) * (i / CORNER_STEPS);
            return [ox - sx * r * Math.cos(a), oz - sz * r * Math.sin(a)];
          };

          // Carriageway in the bite the radius takes out of the corner.
          const bite: Array<[number, number]> = [[cross.at + sx * halfX, road.at + sz * halfZ]];
          for (let i = 0; i <= CORNER_STEPS; i++) bite.push(on(radius, i));
          b.add(surface, pad(bite, 0.24), [0, WORLD.ground - 0.24, 0]);

          // Footway: the corner rectangle with the same curve cut out of it.
          const ax = cross.at + sx * (halfX + 0.34);
          const bx = cross.at + sx * (halfX + 0.34 + walkX);
          const az = road.at + sz * (halfZ + 0.34);
          const bz = road.at + sz * (halfZ + 0.34 + walkZ);
          const walk: Array<[number, number]> = [];
          for (let i = 0; i <= CORNER_STEPS; i++) walk.push(on(radius - 0.34, i));
          walk.push([bx, az], [bx, bz], [ax, bz]);
          b.add(M.sidewalk, pad(walk, 0.18), [0, kerbY - 0.18, 0]);

          // Kerb round the curve, then out along both straights to meet the
          // runs the road itself laid.
          for (let i = 0; i < CORNER_STEPS; i++) {
            const a = (Math.PI / 2) * ((i + 0.5) / CORNER_STEPS);
            const rr = radius - 0.17;
            b.add(
              M.kerb,
              box(0.34, KERB_H, (Math.PI / 2 / CORNER_STEPS) * rr + 0.08),
              [ox - sx * rr * Math.cos(a), WORLD.ground + KERB_H / 2, oz - sz * rr * Math.sin(a)],
              [0, Math.atan2(sx * Math.sin(a), -sz * Math.cos(a)), 0],
            );
          }
          const runX = walkX + 0.34 - radius;
          const runZ = walkZ + 0.34 - radius;
          if (runX > 0.1) {
            b.add(M.kerb, box(runX, KERB_H, 0.34), [
              cross.at + sx * (halfX + radius + runX / 2),
              WORLD.ground + KERB_H / 2,
              road.at + sz * (halfZ + 0.17),
            ]);
          }
          if (runZ > 0.1) {
            b.add(M.kerb, box(0.34, KERB_H, runZ), [
              cross.at + sx * (halfX + 0.17),
              WORLD.ground + KERB_H / 2,
              road.at + sz * (halfZ + radius + runZ / 2),
            ]);
          }
        }
      }

      // Crossing stripes on each approach, set back from the middle so the
      // turning space stays clear.
      if (road.grade === "lane" || cross.other.grade === "lane") continue;
      const bars = (
        count: number,
        origin: [number, number],
        stepX: number,
        stepZ: number,
        w: number,
        d: number,
      ) => {
        for (let i = 0; i < count; i++) {
          b.add(M.roadLine, box(w, 0.02, d), [
            origin[0] + stepX * i,
            WORLD.ground + 0.008,
            origin[1] + stepZ * i,
          ]);
        }
      };
      const acrossX = Math.max(3, Math.floor(cross.other.width / 1.6));
      for (const sz of [-1, 1]) {
        bars(
          acrossX,
          [cross.at - cross.other.width / 2 + 0.8, road.at + sz * (halfZ - 1.5)],
          1.6,
          0,
          0.62,
          2.6,
        );
      }
      const acrossZ = Math.max(3, Math.floor(road.width / 1.6));
      for (const sx of [-1, 1]) {
        bars(
          acrossZ,
          [cross.at + sx * (halfX - 1.5), road.at - road.width / 2 + 0.8],
          0,
          1.6,
          2.6,
          0.62,
        );
      }
    }
  }
}

/**
 * The land, and where it stops.
 *
 * The first pass stood the city on a three-hundred-metre square of dark
 * concrete. Two things were wrong with that and both were plainly visible: the
 * square ran out, so panning south-east walked you off the end of the world
 * onto a grey cliff over nothing; and the parts of it no building stood on read
 * as an enormous empty car park, because that is what an unbroken field of
 * paving is.
 *
 * It is open country now. The plain runs far enough in every direction that no
 * camera the game allows can reach its edge, the distance is eaten by the fog
 * rather than by a boundary, and the city sits in the middle of it. Nothing is
 * paved except what somebody paved: carriageways, footways, quays and plots.
 * The green between them is the ground the city was built on.
 *
 * Land and water tile the plane exactly — near shore, channel, far shore, with
 * the two arms of the channel meeting at the corner. The old layout left a
 * notch there where the north and west banks failed to meet, which showed as a
 * step in the far shoreline every time the camera looked north-west.
 */
function buildLand(b: PartsBuilder): void {
  const N = WORLD.northShore;
  const W = WORLD.westShore;
  const NF = WORLD.northFar;
  const WF = WORLD.westFar;
  const R = REACH + 320;
  // Sits just below WORLD.ground. Every carriageway's top face is at
  // WORLD.ground, and two coplanar surfaces are two surfaces with an equal
  // claim on the same depth values. It happens to resolve consistently under an
  // orthographic camera looking at horizontal planes, but that is luck rather
  // than design and it would not survive a perspective camera.
  const y = WORLD.ground - 0.88;
  const plane = (x0: number, x1: number, z0: number, z1: number, material = M.grass) => {
    b.add(material, box(x1 - x0, 1.6, z1 - z0), [(x0 + x1) / 2, y, (z0 + z1) / 2]);
  };

  // The city's own side of the water, in three pieces so the canal is a hole in
  // the land rather than a stripe painted on top of it. It was the latter: the
  // inlet was authored under a slab that covered it completely, which left a
  // handsome bridge spanning a perfectly solid street.
  plane(W, WORLD.canalX0, N, R);
  plane(WORLD.canalX1, R, N, R);
  plane(WORLD.canalX0, WORLD.canalX1, WORLD.canalEndZ, R);
  // The far shore, an L that closes the corner the old layout left open.
  plane(-R, R, -R, NF);
  plane(-R, WF, NF, R);

  // The channel between them, at one level so it reads as one body of water,
  // and deep enough that no camera angle finds daylight under the shoreline.
  const water = (x0: number, x1: number, z0: number, z1: number) => {
    b.add(M.water, box(x1 - x0, 1.4, z1 - z0), [
      (x0 + x1) / 2,
      WORLD.ground - 2.44,
      (z0 + z1) / 2,
    ]);
  };
  water(WF, R, NF, N);
  water(WF, W, N, R);
  water(WORLD.canalX0, WORLD.canalX1, N, WORLD.canalEndZ);

  // Shoreline. The quays only run the length of the city; past them the coast
  // is a bank, and it has to be there, because the land is a slab with a
  // visible cut face and the water is below it.
  const bank = (x0: number, x1: number, z0: number, z1: number) => {
    b.add(M.dirt, box(x1 - x0, 2.9, z1 - z0), [(x0 + x1) / 2, WORLD.ground - 1.4, (z0 + z1) / 2]);
  };
  bank(W - 1.2, R, N - 1.2, N + 1.2);
  bank(W - 1.2, W + 1.2, N, R);
  bank(-R, R, NF - 1.2, NF + 1.2);
  bank(WF - 1.2, WF + 1.2, NF, R);
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
    // Nine and a half metres, not ten and a half. These streets are six to ten
    // metres of carriageway; a full-length coach on them is the size of the
    // shops it drives past.
    b.add(paint, bevelBox(2.5, 2.5, 9.4, 0.22), [0, 1.65, 0]);
    b.add(M.glassDim, box(2.54, 1.0, 7.4), [0, 2.25, -0.4]);
    b.add(M.glassDim, box(2.2, 1.2, 0.1), [0, 2.2, 4.65]);
    b.add(M.plaster, box(2.56, 0.34, 9.3), [0, 0.72, 0]);
    // Skirt down to axle height. Looking down at thirty-five degrees you see
    // under a vehicle, and half a metre of daylight between a bus and its own
    // shadow reads as a bus hovering over the road.
    b.add(M.ironDark, box(2.42, 0.44, 9.0), [0, 0.44, 0]);
    b.add(M.roofZinc, box(2.3, 0.16, 8.9), [0, 2.95, 0]);
    b.add(M.aluminium, bevelBox(1.2, 0.3, 2.0, 0.06), [0.4, 3.1, -2.4]);
    b.add(M.signLit, box(1.5, 0.3, 0.08), [0, 2.75, 4.71]);
    for (const oz of [-3.2, 3.0]) {
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

/**
 * A driveable path: a closed circuit turned into a smooth, offset, sampled
 * polyline with a length, so anything following it can be positioned by
 * distance travelled and never has to be teleported.
 */
export type Path = {
  readonly points: readonly THREE.Vector3[];
  /** Cumulative arc length at each point; last entry is the total. */
  readonly marks: readonly number[];
  readonly length: number;
};

/** Corner radius, in metres, for a vehicle turning at a junction. */
const TURN_RADIUS = 7;
/**
 * The same, for the turn that goes the short way round.
 *
 * A lane offset to the right of travel puts its corner *outside* the junction
 * on one of the two turns, and a rounded corner always cuts to the inside — so
 * on that turn the arc leaves the carriageway rather than crossing it. Seven
 * metres of radius bulges two and a half metres past the lane corner, which on
 * a nine-metre street is the far side of the kerb. Four and a half is about the
 * least the sum of the path's own cut and a long vehicle's body cut comes to.
 */
const TIGHT_RADIUS = 4.5;

/**
 * Offsets a circuit into its own lane and rounds off the corners.
 *
 * Two things make the difference between a route and a slideshow. The offset
 * is taken to the right of travel, so opposing streams sit on their own sides
 * of the centre line and a loop driven clockwise and the same loop driven the
 * other way do not overlap. And the corners are arcs rather than vertices, so
 * a vehicle leans into a turn over a couple of car lengths instead of snapping
 * ninety degrees in one frame.
 */
export function layPath(circuit: Circuit, offset: number, height: (x: number, z: number) => number): Path {
  const n = circuit.points.length;
  const at = (i: number) => circuit.points[((i % n) + n) % n];

  // Offset each leg to the right, then meet consecutive legs at their corner.
  const corners: Array<{ x: number; z: number; inX: number; inZ: number; outX: number; outZ: number }> = [];
  for (let i = 0; i < n; i++) {
    const previous = at(i - 1);
    const here = at(i);
    const next = at(i + 1);
    const dIn = unit(here.x - previous.x, here.z - previous.z);
    const dOut = unit(next.x - here.x, next.z - here.z);
    const rIn = { x: dIn.z, z: -dIn.x };
    const rOut = { x: dOut.z, z: -dOut.x };
    const point = meet(
      { x: here.x + rIn.x * offset, z: here.z + rIn.z * offset },
      dIn,
      { x: here.x + rOut.x * offset, z: here.z + rOut.z * offset },
      dOut,
    );
    corners.push({ x: point.x, z: point.z, inX: dIn.x, inZ: dIn.z, outX: dOut.x, outZ: dOut.z });
  }

  const shape: Array<{ x: number; z: number }> = [];
  const push = (x: number, z: number) => {
    const last = shape[shape.length - 1];
    if (last && Math.abs(last.x - x) < 0.01 && Math.abs(last.z - z) < 0.01) return;
    shape.push({ x, z });
  };

  for (let i = 0; i < n; i++) {
    const c = corners[i];
    const previous = corners[(i - 1 + n) % n];
    const runIn = Math.hypot(c.x - previous.x, c.z - previous.z);
    const turn = c.inX * c.outZ - c.inZ * c.outX;
    const radius = turn * offset < 0
      ? Math.min(TIGHT_RADIUS, runIn * 0.3)
      : Math.min(TURN_RADIUS, runIn * 0.4);
    const straight = Math.abs(turn) < 0.01;
    if (straight || radius < 0.5) {
      push(c.x, c.z);
      continue;
    }
    const ax = c.x - c.inX * radius;
    const az = c.z - c.inZ * radius;
    const bx = c.x + c.outX * radius;
    const bz = c.z + c.outZ * radius;
    const steps = 5;
    for (let s = 0; s <= steps; s++) {
      const k = s / steps;
      const j = 1 - k;
      push(j * j * ax + 2 * j * k * c.x + k * k * bx, j * j * az + 2 * j * k * c.z + k * k * bz);
    }
  }

  // Sample the running surface along the whole closed loop, not just at its
  // corners. The height is only known where the path is measured, and a run
  // between two junctions is one straight line: sampled at its ends alone, the
  // bridge in the middle of the quay road does not exist as far as a vehicle is
  // concerned, and it drives through the canal at ground level.
  const STRIDE = 6;
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < shape.length; i++) {
    const a = shape[i];
    const bee = shape[(i + 1) % shape.length];
    points.push(new THREE.Vector3(a.x, height(a.x, a.z), a.z));
    const steps = Math.floor(Math.hypot(bee.x - a.x, bee.z - a.z) / STRIDE);
    for (let s = 1; s <= steps; s++) {
      const k = s / (steps + 1);
      const ix = a.x + (bee.x - a.x) * k;
      const iz = a.z + (bee.z - a.z) * k;
      points.push(new THREE.Vector3(ix, height(ix, iz), iz));
    }
  }

  const marks = [0];
  for (let i = 1; i <= points.length; i++) {
    const a = points[i - 1];
    const bee = points[i % points.length];
    marks.push(marks[i - 1] + a.distanceTo(bee));
  }
  return { points, marks, length: marks[marks.length - 1] };
}

function unit(x: number, z: number): { x: number; z: number } {
  const length = Math.hypot(x, z) || 1;
  return { x: x / length, z: z / length };
}

/** Where two offset lines meet. Parallel legs fall back to the first point. */
function meet(
  p: { x: number; z: number },
  d: { x: number; z: number },
  q: { x: number; z: number },
  e: { x: number; z: number },
): { x: number; z: number } {
  const denominator = d.x * e.z - d.z * e.x;
  if (Math.abs(denominator) < 1e-6) return p;
  const t = ((q.x - p.x) * e.z - (q.z - p.z) * e.x) / denominator;
  return { x: p.x + d.x * t, z: p.z + d.z * t };
}

/** Position and heading a given distance along a path. */
export function sample(path: Path, distance: number, into: THREE.Vector3): number {
  const total = path.length;
  const s = ((distance % total) + total) % total;
  // Linear scan from a proportional guess: paths are short and near-uniform.
  let i = Math.min(path.points.length - 1, Math.floor((s / total) * path.points.length));
  while (i > 0 && path.marks[i] > s) i--;
  while (i < path.points.length - 1 && path.marks[i + 1] <= s) i++;
  const a = path.points[i];
  const b = path.points[(i + 1) % path.points.length];
  const span = path.marks[i + 1] - path.marks[i] || 1;
  const k = (s - path.marks[i]) / span;
  into.lerpVectors(a, b, k);
  return Math.atan2(b.x - a.x, b.z - a.z);
}

/** Running-surface height anywhere on the network, so bridges are driven over. */
function surfaceHeight(x: number, z: number): number {
  let lift = 0;
  for (const road of ROADS) {
    if (!road.decks) continue;
    const across = road.axis === "x" ? z - road.at : x - road.at;
    if (Math.abs(across) > road.width / 2 + 1) continue;
    lift = Math.max(lift, deckHeight(road, road.axis === "x" ? x : z));
  }
  return WORLD.ground + 0.02 + lift;
}

/**
 * Traffic.
 *
 * Empty carriageways were the loudest remaining tell that this was a model
 * rather than a place. Each vehicle is a single merged mesh under the shared
 * actor material, so a dozen of them cost a dozen draw calls.
 *
 * What they drive is the difference from the first pass. Every vehicle now
 * follows a closed circuit found in the road graph: it turns at junctions,
 * keeps right, climbs the bridge deck rather than being switched off underneath
 * it, and comes back round to where it started. Nothing pops into or out of
 * existence, because nothing ever needs to.
 */
/**
 * The roads traffic is allowed to plan on.
 *
 * Service lanes are out. `forge-lane` is six and a half metres wide, which
 * leaves three and a quarter either side of the centre line: a lane offset of
 * three puts a two-and-a-half-metre bus's outside wheels a foot past the kerb
 * before it has even reached a corner. A lane is for the yard it serves, and
 * the through routes are the streets.
 */
export const DRIVEN_ROADS = ROADS.filter((road) => road.grade !== "lane");
/** Distance right of the centre line for a vehicle. Half the carriageway, near enough. */
export const LANE_OFFSET = 2.6;

export function buildTraffic(seed: number): Rig[] {
  const rng = new Rng(seed).fork("traffic");
  const graph = drivableCore(buildRoadGraph(DRIVEN_ROADS));
  const rigs: Rig[] = [];

  const routes: Path[] = [];
  for (let i = 0; i < 6; i++) {
    const circuit = findCircuit(graph, rng, 4);
    if (!circuit) continue;
    // Both sides of the road: the same loop driven each way, offset right.
    routes.push(layPath(circuit, LANE_OFFSET, surfaceHeight));
    routes.push(layPath(reverse(circuit), LANE_OFFSET, surfaceHeight));
  }
  if (routes.length === 0) return rigs;

  const front = new THREE.Vector3();
  const rear = new THREE.Vector3();
  for (const [index, path] of routes.entries()) {
    // Long circuits carry more traffic than short ones, as they would.
    const count = Math.max(1, Math.min(4, Math.round(path.length / 150)));
    for (let i = 0; i < count; i++) {
      const kind: VehicleKind = rng.pick(["car", "hatch", "hatch", "car", "pickup", "bus", "truck"]);
      const group = vehicleGeometry(kind, rng.pick(PAINTS));
      const speed = rng.range(6.5, 9.5) * (kind === "bus" || kind === "truck" ? 0.8 : 1);
      const start = path.length * ((i + rng.range(0.02, 0.3)) / count) + index * 11;
      // Half the wheelbase. A vehicle used to be put at one point on its lane
      // and turned to that point's tangent, which is fine on a straight and
      // wrong on a corner: a junction turn is a seven-metre arc, and a rigid
      // body laid along the tangent at the middle of an arc has both its ends
      // swung wide of it. On a nine-metre bus that is two metres of overhang at
      // each end, and what the player saw was a coach parked diagonally across
      // the footway at every crossroads in the city.
      //
      // Spanning two samples half a wheelbase apart puts the axles on the line
      // the vehicle is driving and lets the middle cut in, which is what a long
      // vehicle actually does.
      const half = AXLES[kind] / 2;
      rigs.push({
        group,
        update: (t: number) => {
          const at = start + t * speed;
          sample(path, at + half, front);
          sample(path, at - half, rear);
          group.position.addVectors(front, rear).multiplyScalar(0.5);
          group.rotation.y = Math.atan2(front.x - rear.x, front.z - rear.z);
        },
      });
    }
  }

  return rigs;
}

/** Axle-to-axle, per body. Only used to sit a vehicle on the lane it is on. */
const AXLES: Record<VehicleKind, number> = {
  car: 3.0,
  hatch: 2.4,
  pickup: 3.0,
  bus: 7.0,
  truck: 5.4,
};

function reverse(circuit: Circuit): Circuit {
  return { points: [...circuit.points].reverse(), legs: [...circuit.legs].reverse() };
}

/**
 * People on the pavement.
 *
 * Same graph, one lane further out and a good deal slower. Walkers used to run
 * a straight line between two authored points and snap back to the start, which
 * is exactly as convincing as it sounds; these follow the footway round corners
 * and keep going.
 */
export function buildPedestrians(seed: number): Rig[] {
  const rng = new Rng(seed).fork("pedestrians");
  const graph = drivableCore(buildRoadGraph(DRIVEN_ROADS));
  const rigs: Rig[] = [];

  const paths: Path[] = [];
  // On the footway, not past it. A street here is nine to ten metres wide with
  // a 3.2m footway outside its kerb, so the paving runs from about 4.8 to 8.0
  // out from the centre line; the old 8.4–9.6 put every walker in the city on
  // the far side of it, tramping across front gardens and forecourts.
  for (let i = 0; i < 5; i++) {
    const circuit = findCircuit(graph, rng, 4);
    if (!circuit) continue;
    paths.push(layPath(circuit, rng.range(6.9, 7.7), surfaceHeight));
    paths.push(layPath(reverse(circuit), rng.range(6.9, 7.7), surfaceHeight));
  }

  const position = new THREE.Vector3();
  for (const path of paths) {
    const count = Math.max(1, Math.min(3, Math.round(path.length / 260)));
    for (let i = 0; i < count; i++) {
      const rig = makePerson({
        pose: rng.chance(0.25) ? "carry" : "walk",
        build: rng.range(0.92, 1.08),
        body: rng.pick([M.personBody, M.personAlt, M.accentDeep, M.renderTeal]),
        hat: rng.chance(0.3) ? "cap" : "none",
        seed: rng.next() * 1e6,
      });
      const speed = rng.range(1.1, 1.6);
      const start = path.length * ((i + rng.range(0.05, 0.4)) / count);
      rigs.push({
        group: rig.group,
        update: (t: number) => {
          const heading = sample(path, start + t * speed, position);
          rig.group.position.set(position.x, position.y + 0.14, position.z);
          const step = t * speed * 3.4;
          rig.group.position.y += Math.abs(Math.sin(step)) * 0.06;
          rig.group.rotation.y = heading;
          rig.group.rotation.z = Math.sin(step) * 0.08;
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

  // East of the core: mid-rise continuing the downtown grain toward the ring.
  rowZ(74, -80, -26, 8, 15, 16);
  rowZ(98, -80, -26, 10, 22, 17);
  rowX(-56, 68, 122, 8, 17, 15);
  rowX(-30, 68, 122, 7, 14, 15);
  // Between the boulevard and the southern street, east of the quarter.
  rowX(8, 92, 122, 6, 11, 15);
  // South of the ring road: held low, so nothing stands in front of the
  // Creator Quarter in the foreground.
  rowX(82, 20, 122, 4.5, 7.5, 14);
  rowX(46, -58, -40, 4.5, 7.0, 14);
  // West side, behind the forge and running off the left edge.
  rowX(82, -58, 4, 4.5, 7.5, 14);
  // Far bank north.
  rowX(WORLD.northFar - 12, -260, 320, 9, 20, 20);
  rowX(WORLD.northFar - 34, -260, 320, 12, 30, 24);
  // Far bank west.
  rowZ(WORLD.westFar - 12, -150, 260, 8, 18, 20);
  rowZ(WORLD.westFar - 34, -150, 260, 11, 28, 24);

  for (const blk of blocks) {
    const base = 0.15;
    // Standing on open ground now rather than on a paved slab, so every block
    // brings its own forecourt. Without it a nine-storey office grows straight
    // out of a meadow.
    b.add(M.sidewalk, box(blk.w + 7, 0.2, blk.d + 7), [blk.x, base - 0.06, blk.z]);
    const body = rng.pick(bodies);
    b.add(body, box(blk.w, blk.h, blk.d), [blk.x, base + blk.h / 2, blk.z]);
    b.add(M.concreteDark, box(blk.w + 0.15, 0.75, blk.d + 0.15), [blk.x, base + 0.37, blk.z]);

    // The low rows are the ones the ring road runs in front of, which puts them
    // in the near foreground of the default framing. They used to be finished
    // exactly like the far-bank towers — a flat gravel deck behind a white
    // parapet — and at four metres tall, twenty metres from the camera, that
    // reads as a cardboard box with a lid. A shallow pitch and a ridge is both
    // cheaper than a parapet and the correct building.
    const low = blk.h < 8;
    if (low) {
      // Pitched, and not all the same pitch. A row of these runs the whole
      // width of the near foreground, so one roof shape repeated eight times
      // along the bottom of the frame is a tiling pattern rather than a
      // street.
      const slate = rng.pick([M.roofZinc, M.roofZincWorn, M.roofSheet]);
      const turn = rng.chance(0.5) ? Math.PI : 0;
      if (rng.chance(0.72)) {
        b.add(slate, wedge(blk.w + 0.7, 1.5, blk.d + 0.7), [blk.x, base + blk.h + 0.75, blk.z], [0, turn, 0]);
        b.add(M.fascia, box(blk.w + 0.8, 0.22, 0.24), [
          blk.x,
          base + blk.h + 0.06,
          blk.z + (turn ? -1 : 1) * ((blk.d + 0.7) / 2),
        ]);
      } else {
        b.add(M.fascia, box(blk.w + 0.4, 0.3, blk.d + 0.4), [blk.x, base + blk.h + 0.1, blk.z]);
        b.add(M.gravel, box(blk.w - 0.3, 0.22, blk.d - 0.3), [blk.x, base + blk.h + 0.2, blk.z]);
        b.add(slate, box(blk.w * 0.3, 0.7, blk.d * 0.4), [blk.x + blk.w * 0.24, base + blk.h + 0.55, blk.z]);
      }
    } else {
      b.add(M.fascia, box(blk.w + 0.3, 0.34, blk.d + 0.3), [blk.x, base + blk.h + 0.08, blk.z]);
      // A dark deck sitting proud of the parapet. Without it the lit top face
      // of every box reads as a white slab and the massing glares.
      b.add(M.gravel, box(blk.w - 0.25, 0.24, blk.d - 0.25), [blk.x, base + blk.h + 0.2, blk.z]);
    }

    // Storey lines. Two boxes per floor serve all four elevations, and the
    // spandrel behind them is what stops pale glass on a pale body reading as
    // a smudge — the same fix the authored blocks needed.
    const floors = Math.max(1, Math.floor((blk.h - 1.6) / 2.7));
    for (let f = 0; f < floors; f++) {
      const y = base + 2.0 + f * 2.7;
      if (y > base + blk.h - 0.9) break;
      b.add(M.ironDark, box(blk.w * 0.84, 1.34, blk.d + 0.02), [blk.x, y, blk.z]);
      b.add(M.ironDark, box(blk.w + 0.02, 1.34, blk.d * 0.84), [blk.x, y, blk.z]);
      b.add(M.glassDim, box(blk.w * 0.8, 1.1, blk.d + 0.06), [blk.x, y, blk.z]);
      b.add(M.glassDim, box(blk.w + 0.06, 1.1, blk.d * 0.8), [blk.x, y, blk.z]);
    }
    if (!low && rng.chance(0.6)) {
      // Overrun and plant, not a plain slab.
      //
      // This was one `aluminium` box — the palest, most metallic material in
      // the palette — up to two and a half metres tall and a third of the
      // roof across. Thirty-odd of these stand behind the city, and every one
      // of them read as a blank white lid balanced on a grey block.
      const rw = blk.w * rng.range(0.2, 0.32);
      const rd = blk.d * rng.range(0.22, 0.32);
      const rh = rng.range(1.2, 2.4);
      const rx = blk.x + rng.range(-blk.w * 0.2, blk.w * 0.2);
      const rz = blk.z + rng.range(-blk.d * 0.2, blk.d * 0.2);
      b.add(body, box(rw, rh, rd), [rx, base + blk.h + rh / 2, rz]);
      b.add(M.fascia, box(rw + 0.24, 0.2, rd + 0.24), [rx, base + blk.h + rh + 0.1, rz]);
      b.add(M.ironDark, box(rw * 0.9, 0.6, 0.1), [rx, base + blk.h + rh * 0.55, rz + rd / 2 + 0.06]);
      for (const ox of [-1, 1]) {
        b.add(M.steelPainted, box(1.3, 0.55, 1.0), [rx + ox * (rw / 2 + 1.2), base + blk.h + 0.4, rz]);
      }
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
