/**
 * The city in plan, as rectangles.
 *
 * Roads and plots are both authored as axis-aligned boxes on the ground, which
 * means the question "is anything standing where something else already is"
 * has an exact answer that costs nothing to compute. Nothing here renders; it
 * is the flat truth behind the world, used by the plan drawing (`pnpm plan`)
 * and by the test that stops a plot creeping back onto a carriageway.
 *
 * It exists because that fault is invisible to every other check we have. A
 * plot boundary is not a thing that gets drawn, so a screenshot can show the
 * symptom — grass painted over asphalt, a building the traffic drives through
 * — without ever showing the cause, and the geometry tests all pass because
 * every individual piece is built exactly as authored. The pieces were simply
 * authored on top of each other.
 */

import type { Parcel } from "./parcel";
import { walkwayWidth, type Road } from "./roads";

export type Rect = { readonly x0: number; readonly x1: number; readonly z0: number; readonly z1: number };

/** A road's running surface: ground a vehicle may be on and nothing else may. */
export function carriageway(road: Road): Rect {
  const half = road.width / 2;
  return road.axis === "x"
    ? { x0: road.from, x1: road.to, z0: road.at - half, z1: road.at + half }
    : { x0: road.at - half, x1: road.at + half, z0: road.from, z1: road.to };
}

/**
 * The carriageway plus the footway beside it.
 *
 * The line a plot boundary should sit behind. Flush with the asphalt is not
 * good enough: a parcel draws its kerb outward from its own edge, so a
 * boundary on the carriageway edge lays the kerb on the running surface.
 */
export function corridor(road: Road): Rect {
  const half = road.width / 2 + walkwayWidth(road.grade);
  return road.axis === "x"
    ? { x0: road.from, x1: road.to, z0: road.at - half, z1: road.at + half }
    : { x0: road.at - half, x1: road.at + half, z0: road.from, z1: road.to };
}

/**
 * A plot's footprint in world space.
 *
 * Every parcel is laid on an axis, so a quarter turn swaps width and depth and
 * the rectangle stays square to the world. Worth stating rather than assuming:
 * reading the yaw the other way round is how a plot can look right in the
 * table and sit across a road in the world.
 */
export function footprint(parcel: Parcel): Rect {
  const quarters = Math.round(parcel.yaw / (Math.PI / 2));
  const swapped = Math.abs(quarters % 2) === 1;
  const halfX = (swapped ? parcel.depth : parcel.width) / 2;
  const halfZ = (swapped ? parcel.width : parcel.depth) / 2;
  return {
    x0: parcel.centre.x - halfX,
    x1: parcel.centre.x + halfX,
    z0: parcel.centre.z - halfZ,
    z1: parcel.centre.z + halfZ,
  };
}

/** Shared ground, or null. A shared edge is not an overlap. */
export function intersect(a: Rect, b: Rect): Rect | null {
  const x0 = Math.max(a.x0, b.x0);
  const x1 = Math.min(a.x1, b.x1);
  const z0 = Math.max(a.z0, b.z0);
  const z1 = Math.min(a.z1, b.z1);
  return x1 - x0 > 0.01 && z1 - z0 > 0.01 ? { x0, x1, z0, z1 } : null;
}

export type Trespass = {
  readonly parcel: string;
  readonly road: string;
  readonly area: Rect;
  /** How far past the kerb the plot reaches, in metres. */
  readonly depth: number;
};

/** Every place a plot stands on ground a road owns. Worst first. */
export function trespasses(
  parcels: readonly Parcel[],
  roads: readonly Road[],
  extent: (road: Road) => Rect = carriageway,
): Trespass[] {
  const out: Trespass[] = [];
  for (const parcel of parcels) {
    const plot = footprint(parcel);
    for (const road of roads) {
      const over = intersect(plot, extent(road));
      if (!over) continue;
      out.push({
        parcel: parcel.id,
        road: road.id,
        area: over,
        depth: Math.min(over.x1 - over.x0, over.z1 - over.z0),
      });
    }
  }
  return out.sort((a, b) => b.depth - a.depth);
}

/**
 * What a trespassing plot would have to be to stand behind its kerb.
 *
 * Pulls each offending side back to the edge of the strip it is inside. A road
 * is only a boundary *across* its width — along its length it runs past
 * everything, and treating that as an edge to retreat from is how a first
 * attempt at this proposed plots five hundred metres wide.
 */
export function behindTheKerb(parcel: Parcel, roads: readonly Road[]): Rect {
  const plot = footprint(parcel);
  let { x0, x1, z0, z1 } = plot;
  for (const road of roads) {
    const strip = corridor(road);
    if (!intersect(plot, strip)) continue;
    if (road.axis === "x") {
      if (z0 > strip.z0 && z0 < strip.z1) z0 = strip.z1;
      if (z1 > strip.z0 && z1 < strip.z1) z1 = strip.z0;
    } else {
      if (x0 > strip.x0 && x0 < strip.x1) x0 = strip.x1;
      if (x1 > strip.x0 && x1 < strip.x1) x1 = strip.x0;
    }
  }
  return { x0, x1, z0, z1 };
}
