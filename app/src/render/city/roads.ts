import { Rng } from "../lib/rng";

/**
 * The road network, as a graph rather than a list of stripes.
 *
 * The first pass treated each road as an independent rectangle of asphalt and
 * drew kerbs, footways, medians and street trees along its whole length. That
 * is fine until two roads cross, and then it is wrong in four separate ways at
 * once: two coplanar carriageways fight for the same depth values, a kerb runs
 * across the mouth of the side street, a raised footway crosses the
 * carriageway, and the boulevard's planted median walls the junction off so
 * nothing could turn even in principle.
 *
 * So the network is modelled properly. Roads know where they cross; the
 * drawing code asks for the crossing spans and leaves them alone; and the
 * traffic asks for the graph and drives it. Every junction is a real junction,
 * and a vehicle turning left at one is following an edge rather than being
 * teleported by a modulo.
 */

export type Grade = "boulevard" | "street" | "lane";

export type Road = {
  readonly id: string;
  readonly axis: "x" | "z";
  /** The coordinate the road holds constant. */
  readonly at: number;
  readonly from: number;
  readonly to: number;
  readonly width: number;
  readonly grade: Grade;
  /** Spans with no carriageway laid, because something else carries the road. */
  readonly gaps?: ReadonlyArray<readonly [number, number]>;
  /** Spans carried on a deck, and how high the running surface sits. */
  readonly decks?: ReadonlyArray<{ from: number; to: number; height: number }>;
  /**
   * Runs off the edge of the world rather than ending at a junction.
   *
   * A road with an open end is not a dead end that needs a turning head — it
   * is a road to somewhere else, and it is drawn as one. Traffic does not use
   * open ends, because a vehicle that drove down one would have to vanish.
   */
  readonly open?: "from" | "to" | "both";
};

/** Footway width by grade. Used for drawing and for setting junction extents. */
export function walkwayWidth(grade: Grade): number {
  return grade === "boulevard" ? 4.4 : grade === "street" ? 3.2 : 1.5;
}

/** Which road's carriageway is laid through a shared junction. */
function priority(road: Road): number {
  const byGrade = road.grade === "boulevard" ? 300 : road.grade === "street" ? 200 : 100;
  // Ties go to the east–west road, so a whole avenue is continuous rather than
  // alternating with whichever cross street happened to be declared first.
  return byGrade + (road.axis === "x" ? 10 : 0) + road.width;
}

export function inGap(road: Road, t: number): boolean {
  return Boolean(road.gaps?.some(([a, b]) => t > a && t < b));
}

/** Height of the running surface at a point along the road. */
export function deckHeight(road: Road, t: number): number {
  for (const deck of road.decks ?? []) {
    if (t <= deck.from || t >= deck.to) continue;
    // Ramp over the first and last few metres so nothing steps up a kerb.
    const ramp = 7;
    const up = Math.min(1, (t - deck.from) / ramp);
    const down = Math.min(1, (deck.to - t) / ramp);
    const k = Math.min(up, down);
    return deck.height * (k * k * (3 - 2 * k));
  }
  return 0;
}

export type Crossing = {
  readonly other: Road;
  /** Position along this road's axis. */
  readonly at: number;
  /** Half-width of the other road's carriageway. */
  readonly half: number;
  /** Half-width including the other road's footways. */
  readonly reach: number;
  /** True when the other road's carriageway is laid through the junction. */
  readonly yields: boolean;
};

/** Every place another road crosses this one, ordered along its axis. */
export function crossingsOn(road: Road, roads: readonly Road[]): Crossing[] {
  const found: Crossing[] = [];
  for (const other of roads) {
    if (other === road || other.axis === road.axis) continue;
    const at = other.at;
    const meets = other.from <= road.at && road.at <= other.to;
    if (!meets || at < road.from || at > road.to) continue;
    if (inGap(road, at) || inGap(other, road.at)) continue;
    found.push({
      other,
      at,
      half: other.width / 2,
      reach: other.width / 2 + walkwayWidth(other.grade),
      yields: priority(other) > priority(road),
    });
  }
  return found.sort((a, b) => a.at - b.at);
}

/** Whether `t` falls inside a junction, measured out to `pad` past the kerb. */
export function inJunction(
  road: Road,
  roads: readonly Road[],
  t: number,
  pad: "carriageway" | "footway" = "footway",
): boolean {
  for (const cross of crossingsOn(road, roads)) {
    const half = pad === "carriageway" ? cross.half : cross.reach;
    if (t > cross.at - half && t < cross.at + half) return true;
  }
  return false;
}

/**
 * Subtracts a set of intervals from a run, returning what is left.
 *
 * The workhorse behind every "and stop at the junction" behaviour: a kerb, a
 * footway or a median is a run minus the junctions it would otherwise block.
 */
export function subtract(
  from: number,
  to: number,
  holes: ReadonlyArray<readonly [number, number]>,
): Array<[number, number]> {
  const sorted = [...holes].filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  const runs: Array<[number, number]> = [];
  let cursor = from;
  for (const [a, b] of sorted) {
    if (b <= cursor) continue;
    if (a > cursor) runs.push([cursor, Math.min(a, to)]);
    cursor = Math.max(cursor, b);
    if (cursor >= to) break;
  }
  if (cursor < to) runs.push([cursor, to]);
  return runs.filter(([a, b]) => b - a > 0.05);
}

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

export type GraphNode = {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  /** Edge indices leaving this node. */
  readonly out: number[];
};

export type GraphEdge = {
  readonly road: Road;
  readonly a: string;
  readonly b: string;
  /** Direction of travel from a to b, as a unit vector in XZ. */
  readonly dx: number;
  readonly dz: number;
  readonly length: number;
};

export type RoadGraph = {
  readonly nodes: ReadonlyMap<string, GraphNode>;
  readonly edges: readonly GraphEdge[];
};

function nodeId(x: number, z: number): string {
  return `${x.toFixed(2)}:${z.toFixed(2)}`;
}

/**
 * Junctions and the runs between them.
 *
 * Open ends are left out entirely — an edge that leads off the map is an edge
 * a vehicle can only leave by disappearing. Closed ends stay in, get pruned
 * below if nothing can be done with them, and otherwise serve as the turning
 * heads they are.
 */
export function buildRoadGraph(roads: readonly Road[]): RoadGraph {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  const node = (x: number, z: number): GraphNode => {
    const id = nodeId(x, z);
    let existing = nodes.get(id);
    if (!existing) {
      existing = { id, x, z, out: [] };
      nodes.set(id, existing);
    }
    return existing;
  };

  const link = (road: Road, from: GraphNode, to: GraphNode) => {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const length = Math.hypot(dx, dz);
    if (length < 1) return;
    from.out.push(edges.length);
    edges.push({ road, a: from.id, b: to.id, dx: dx / length, dz: dz / length, length });
    to.out.push(edges.length);
    edges.push({ road, a: to.id, b: from.id, dx: -dx / length, dz: -dz / length, length });
  };

  for (const road of roads) {
    const openFrom = road.open === "from" || road.open === "both";
    const openTo = road.open === "to" || road.open === "both";
    const stops = crossingsOn(road, roads).map((c) => c.at);
    const marks = [...(openFrom ? [] : [road.from]), ...stops, ...(openTo ? [] : [road.to])];
    const unique = [...new Set(marks.map((m) => Number(m.toFixed(3))))].sort((a, b) => a - b);
    const point = (t: number): [number, number] =>
      road.axis === "x" ? [t, road.at] : [road.at, t];

    for (let i = 0; i < unique.length - 1; i++) {
      const [ax, az] = point(unique[i]);
      const [bx, bz] = point(unique[i + 1]);
      // A run split by a bridge gap is still one run: the bridge carries it.
      link(road, node(ax, az), node(bx, bz));
    }
  }

  return { nodes, edges };
}

/**
 * Drops everything a vehicle could enter but not leave.
 *
 * Applied repeatedly, because removing a stub can strand the run behind it.
 * What is left is the part of the network that is genuinely circulable, which
 * is the only part traffic is allowed to plan on.
 */
export function drivableCore(graph: RoadGraph): RoadGraph {
  const alive = new Set(graph.edges.map((_, index) => index));
  // Edges are stored in forward/back pairs, so a run is retired as a pair.
  const twin = (index: number) => (index % 2 === 0 ? index + 1 : index - 1);

  for (;;) {
    const leaving = new Map<string, number[]>();
    for (const index of alive) {
      const edge = graph.edges[index];
      const list = leaving.get(edge.a);
      if (list) list.push(index);
      else leaving.set(edge.a, [index]);
    }
    let cut = false;
    for (const list of leaving.values()) {
      if (list.length !== 1 || !alive.has(list[0])) continue;
      alive.delete(list[0]);
      alive.delete(twin(list[0]));
      cut = true;
    }
    if (!cut) break;
  }

  const kept: GraphEdge[] = [];
  const remap = new Map<number, number>();
  for (const index of [...alive].sort((a, b) => a - b)) {
    remap.set(index, kept.length);
    kept.push(graph.edges[index]);
  }
  const out = new Map<string, GraphNode>();
  for (const [id, n] of graph.nodes) {
    const links = n.out.filter((i) => remap.has(i)).map((i) => remap.get(i)!);
    if (links.length > 0) out.set(id, { ...n, out: links });
  }
  return { nodes: out, edges: kept };
}

export type Circuit = {
  /** Junction positions, in order, closed (last connects back to first). */
  readonly points: ReadonlyArray<{ x: number; z: number }>;
  /** The road each leg runs along, for lane widths and deck heights. */
  readonly legs: readonly Road[];
};

/**
 * A closed route through the network.
 *
 * Walks the graph without immediately reversing, and closes the loop the first
 * time it steps onto a node it has already visited. A walk on a finite graph
 * has to repeat a node within one pass of its node count, so this terminates
 * quickly and always returns a genuine cycle — which is what lets a vehicle
 * drive forever without a single teleport.
 */
export function findCircuit(graph: RoadGraph, rng: Rng, minLegs = 4): Circuit | null {
  const ids = [...graph.nodes.keys()];
  if (ids.length === 0) return null;

  for (let attempt = 0; attempt < 24; attempt++) {
    const start = graph.nodes.get(rng.pick(ids))!;
    const path: GraphNode[] = [start];
    const legs: Road[] = [];
    const seen = new Map<string, number>([[start.id, 0]]);
    let previous = -1;

    for (let step = 0; step < ids.length + 2; step++) {
      const here = path[path.length - 1];
      const options = here.out.filter((i) => {
        const back = i % 2 === 0 ? i + 1 : i - 1;
        return previous === -1 || back !== previous;
      });
      const choices = options.length > 0 ? options : here.out;
      if (choices.length === 0) break;
      const index = rng.pick(choices);
      const edge = graph.edges[index];
      const next = graph.nodes.get(edge.b);
      if (!next) break;
      previous = index;
      legs.push(edge.road);

      const earlier = seen.get(next.id);
      if (earlier !== undefined) {
        const points = path.slice(earlier).map((n) => ({ x: n.x, z: n.z }));
        const cycleLegs = legs.slice(earlier);
        if (points.length >= minLegs) return { points, legs: cycleLegs };
        break;
      }
      seen.set(next.id, path.length);
      path.push(next);
    }
  }
  return null;
}
