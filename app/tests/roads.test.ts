import { describe, expect, it } from "vitest";

import * as THREE from "three";

import { Rng } from "../src/render/lib/rng";
import { DRIVEN_ROADS, LANE_OFFSET, ROADS, layPath, sample } from "../src/render/city/cityPlan";
import {
  buildRoadGraph,
  crossingsOn,
  deckHeight,
  drivableCore,
  findCircuit,
  inJunction,
  subtract,
  type Circuit,
  type Road,
} from "../src/render/city/roads";

const grid: Road[] = [
  { id: "a", axis: "x", at: 0, from: 0, to: 100, width: 10, grade: "street" },
  { id: "b", axis: "x", at: 60, from: 0, to: 100, width: 10, grade: "street" },
  { id: "c", axis: "z", at: 0, from: 0, to: 60, width: 10, grade: "street" },
  { id: "d", axis: "z", at: 100, from: 0, to: 60, width: 10, grade: "street" },
];

describe("subtract", () => {
  it("returns the whole run when nothing is in the way", () => {
    expect(subtract(0, 10, [])).toEqual([[0, 10]]);
  });

  it("cuts a hole out of the middle", () => {
    expect(subtract(0, 10, [[4, 6]])).toEqual([
      [0, 4],
      [6, 10],
    ]);
  });

  it("merges overlapping holes", () => {
    expect(subtract(0, 10, [[2, 6], [4, 8]])).toEqual([
      [0, 2],
      [8, 10],
    ]);
  });

  it("clips holes that hang off either end", () => {
    expect(subtract(0, 10, [[-5, 3], [8, 20]])).toEqual([[3, 8]]);
  });

  it("drops slivers too small to see", () => {
    expect(subtract(0, 10, [[0, 9.99]])).toEqual([]);
  });
});

describe("crossings", () => {
  it("finds where two roads meet, and only where they meet", () => {
    const found = crossingsOn(grid[0], grid);
    expect(found.map((c) => c.at)).toEqual([0, 100]);
  });

  it("ignores a road that stops short", () => {
    const short: Road = { id: "e", axis: "z", at: 50, from: 20, to: 40, width: 8, grade: "lane" };
    expect(crossingsOn(grid[0], [...grid, short]).map((c) => c.at)).toEqual([0, 100]);
  });

  it("hands the junction to the wider road", () => {
    const wide: Road = { id: "w", axis: "z", at: 50, from: -10, to: 70, width: 13, grade: "boulevard" };
    const [meeting] = crossingsOn(grid[0], [...grid, wide]).filter((c) => c.at === 50);
    expect(meeting.yields).toBe(true);
    const [reverse] = crossingsOn(wide, [...grid, wide]).filter((c) => c.at === 0);
    expect(reverse.yields).toBe(false);
  });

  it("knows what falls inside a junction", () => {
    expect(inJunction(grid[0], grid, 0)).toBe(true);
    expect(inJunction(grid[0], grid, 30)).toBe(false);
  });
});

describe("the network as authored", () => {
  /** Whether a point is inside some other road's carriageway. */
  function paved(x: number, z: number, self: Road): boolean {
    return ROADS.some((other) => {
      if (other === self || other.axis === self.axis) return false;
      const along = other.axis === "x" ? x : z;
      const across = other.axis === "x" ? z - other.at : x - other.at;
      return along >= other.from && along <= other.to && Math.abs(across) <= other.width / 2 + 0.01;
    });
  }

  it("gives every road either a junction or an open end at both ends", () => {
    // Ending "at a junction" means ending on the crossing road's asphalt, not
    // on its centre line: the road laid through a corner runs on to the far
    // kerb so the corner is paved.
    const loose: string[] = [];
    for (const road of ROADS) {
      const open = road.open;
      const at = (t: number): [number, number] =>
        road.axis === "x" ? [t, road.at] : [road.at, t];
      if (open !== "from" && open !== "both" && !paved(...at(road.from), road)) {
        loose.push(`${road.id}@${road.from}`);
      }
      if (open !== "to" && open !== "both" && !paved(...at(road.to), road)) {
        loose.push(`${road.id}@${road.to}`);
      }
    }
    expect(loose).toEqual([]);
  });

  it("paves the outside corners, where two roads both run out", () => {
    // The four corners of the ring. Each is a point just outside both centre
    // lines, which used to be bare ground.
    const corners: Array<[number, number]> = [
      [-69, -87],
      [131, -87],
      [-69, 69],
      [131, 69],
    ];
    for (const [x, z] of corners) {
      const covered = ROADS.some((road) => {
        const along = road.axis === "x" ? x : z;
        const across = road.axis === "x" ? z - road.at : x - road.at;
        return along >= road.from && along <= road.to && Math.abs(across) <= road.width / 2;
      });
      expect(covered, `nothing paved at ${x}, ${z}`).toBe(true);
    }
  });

  it("leaves nothing a vehicle could drive into and not out of", () => {
    const core = drivableCore(buildRoadGraph(ROADS));
    expect(core.edges.length).toBeGreaterThan(20);
    for (const node of core.nodes.values()) {
      expect(node.out.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("lifts the running surface over the canal and puts it back down", () => {
    const quay = ROADS.find((r) => r.id === "quay-north")!;
    expect(deckHeight(quay, 37)).toBeGreaterThan(0.5);
    expect(deckHeight(quay, -20)).toBe(0);
    expect(deckHeight(quay, 100)).toBe(0);
  });
});

describe("circuits", () => {
  it("closes, and only uses roads that exist", () => {
    const core = drivableCore(buildRoadGraph(ROADS));
    const rng = new Rng("circuit-test");
    for (let i = 0; i < 20; i++) {
      const circuit = findCircuit(core, rng, 4);
      expect(circuit).not.toBeNull();
      expect(circuit!.points.length).toBeGreaterThanOrEqual(4);
      // Every leg runs along one axis: a circuit that cut a diagonal across a
      // block would mean the walk left the network.
      const n = circuit!.points.length;
      for (let k = 0; k < n; k++) {
        const a = circuit!.points[k];
        const b = circuit!.points[(k + 1) % n];
        const straight = Math.abs(a.x - b.x) < 0.01 || Math.abs(a.z - b.z) < 0.01;
        expect(straight).toBe(true);
      }
    }
  });

  it("drives without teleporting, all the way round and back to the start", () => {
    const core = drivableCore(buildRoadGraph(ROADS));
    const circuit = findCircuit(core, new Rng("drive"), 4)!;
    const path = layPath(circuit, 3, () => 0);
    expect(path.length).toBeGreaterThan(60);

    const here = new THREE.Vector3();
    const before = new THREE.Vector3();
    const speed = 8;
    const dt = 1 / 30;
    let worst = 0;
    sample(path, 0, before);
    // Two full laps, so the seam where the loop closes is crossed twice.
    for (let step = 1; step * dt * speed < path.length * 2; step++) {
      sample(path, step * dt * speed, here);
      worst = Math.max(worst, here.distanceTo(before));
      before.copy(here);
    }
    // A vehicle at 8 m/s covers 0.27m per frame. Anything near a metre is a
    // jump, and anything near the loop length is the old modulo snapping back.
    expect(worst).toBeLessThan(0.5);
  });

  it("keeps opposing streams on their own side of the road", () => {
    const core = drivableCore(buildRoadGraph(ROADS));
    const circuit = findCircuit(core, new Rng("sides"), 4)!;
    const forward = layPath(circuit, 3, () => 0);
    const backward = layPath(
      { points: [...circuit.points].reverse(), legs: [...circuit.legs].reverse() },
      3,
      () => 0,
    );
    // Sample both and check no point of one lands on top of a point of the
    // other: same lane in both directions would be a head-on collision.
    let closest = Infinity;
    for (const a of forward.points) {
      for (const b of backward.points) {
        closest = Math.min(closest, Math.hypot(a.x - b.x, a.z - b.z));
      }
    }
    expect(closest).toBeGreaterThan(2);
  });
});

/**
 * How far inside a carriageway a point is. Negative means it is over the kerb.
 *
 * Bridge gaps are not holes for this purpose: the deck carries the road across
 * them, which is the whole point of the bridge.
 */
function clearance(x: number, z: number): number {
  let best = Number.NEGATIVE_INFINITY;
  for (const road of DRIVEN_ROADS) {
    const along = road.axis === "x" ? x : z;
    if (along < road.from || along > road.to) continue;
    const across = road.axis === "x" ? z - road.at : x - road.at;
    best = Math.max(best, road.width / 2 - Math.abs(across));
  }
  return best;
}

function reversed(circuit: Circuit): Circuit {
  return { points: [...circuit.points].reverse(), legs: [...circuit.legs].reverse() };
}

describe("what the traffic actually drives over", () => {
  /**
   * The bus, because it is the worst case by a distance.
   *
   * A vehicle is placed at the midpoint of two samples half a wheelbase apart,
   * so its body cuts inside the arc it is turning through — which is what a
   * long vehicle does, and which on top of the path's own corner cut used to
   * put a nine-metre coach a clear two metres onto the footway at every
   * crossroads in the city. The junction corners are radiused now and the turn
   * that goes the short way round is laid tighter; this pins both.
   */
  it("never puts a bus further over a kerb than the corner radius allows", () => {
    const core = drivableCore(buildRoadGraph(DRIVEN_ROADS));
    const rng = new Rng("kerb-watch");
    const front = new THREE.Vector3();
    const rear = new THREE.Vector3();
    // Wheelbase, half-length and half-width of the authored bus body.
    const axle = 3.5;
    const nose = 4.7;
    const flank = 1.25;

    let worst = 0;
    let where = "nowhere";
    let checked = 0;
    for (let i = 0; i < 6; i++) {
      const circuit = findCircuit(core, rng, 4);
      if (!circuit) continue;
      for (const run of [circuit, reversed(circuit)]) {
        const path = layPath(run, LANE_OFFSET, () => 0);
        for (let s = 0; s < path.length; s += 0.5) {
          sample(path, s + axle, front);
          sample(path, s - axle, rear);
          const cx = (front.x + rear.x) / 2;
          const cz = (front.z + rear.z) / 2;
          const yaw = Math.atan2(front.x - rear.x, front.z - rear.z);
          const sin = Math.sin(yaw);
          const cos = Math.cos(yaw);
          for (const dl of [nose, -nose]) {
            for (const dw of [flank, -flank]) {
              const px = cx + sin * dl + cos * dw;
              const pz = cz + cos * dl - sin * dw;
              checked++;
              const over = -clearance(px, pz);
              if (over > worst) {
                worst = over;
                where = `${px.toFixed(1)}, ${pz.toFixed(1)}`;
              }
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(4000);
    // Measures zero as authored: the body never leaves the carriageway at all,
    // never mind the extra the three-metre kerb radius gives back on the
    // diagonal. The tolerance is there so a corner that starts clipping is a
    // failure rather than a rounding argument.
    expect(worst, `worst overhang at ${where}`).toBeLessThan(0.25);
  });

  it("keeps traffic off the service lanes, which are too narrow for it", () => {
    expect(DRIVEN_ROADS.every((road) => road.grade !== "lane")).toBe(true);
    expect(ROADS.some((road) => road.grade === "lane")).toBe(true);
  });
});
