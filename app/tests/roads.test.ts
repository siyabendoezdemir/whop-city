import { describe, expect, it } from "vitest";

import * as THREE from "three";

import { Rng } from "../src/render/lib/rng";
import { ROADS, layPath, sample } from "../src/render/city/cityPlan";
import {
  buildRoadGraph,
  crossingsOn,
  deckHeight,
  drivableCore,
  findCircuit,
  inJunction,
  subtract,
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
  it("gives every road either a junction or an open end at both ends", () => {
    const loose: string[] = [];
    for (const road of ROADS) {
      const stops = crossingsOn(road, ROADS).map((c) => c.at);
      const open = road.open;
      const meets = (t: number) => stops.some((s) => Math.abs(s - t) < 0.01);
      // The quay road's western end is the tip of the headland, and a headland
      // is allowed to be the end of the road.
      const headland = road.id === "quay-north";
      if (!meets(road.from) && open !== "from" && open !== "both" && !headland) {
        loose.push(`${road.id}@${road.from}`);
      }
      if (!meets(road.to) && open !== "to" && open !== "both") loose.push(`${road.id}@${road.to}`);
    }
    expect(loose).toEqual([]);
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
