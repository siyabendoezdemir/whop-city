/**
 * Where the game meets the world.
 *
 * The authored parcel layout is the board. Each parcel is a plot, and a plot's
 * **level** is the one number the renderer needs: it decides whether there is
 * anything standing there at all and, if there is, how tall it is.
 *
 * The ladder, and what it looks like from the street:
 *
 *   0   vacant ground — hoarding, gravel, weeds, a board saying what could go
 *       here. A brand new city is entirely this, which is the point: the
 *       skyline is something the business builds, not something it is handed.
 *   1   a small building, still part-scaffolded
 *   2   finished, low-rise
 *   3   mid-rise
 *   4   high-rise
 *   5   a tower with a crown on it
 *
 * The ladder lives here rather than in the renderer because it is a game rule:
 * how much a business has to earn before downtown gets another floor. The
 * renderer reads it and builds to it.
 *
 * It does not predict how tall the result comes out. A plot is not one prism —
 * it has a flue, or a crown, or a fly tower — so what a floating marker has to
 * clear is measured off the geometry after it is built, not computed from the
 * ladder. Two functions here used to do that arithmetic and nothing read them.
 */

import type { StateName } from "../render/city/districts/buildings";
import { PARCELS } from "../render/city/cityPlan";
import type { DistrictId } from "../city/projection";

const DISTRICT_BY_PREFIX: Array<[string, DistrictId]> = [
  ["core", "commerce-core"],
  ["forge", "offer-forge"],
  ["creator", "creator-quarter"],
];

export function districtOfPlot(parcelId: string): DistrictId {
  for (const [prefix, district] of DISTRICT_BY_PREFIX) {
    if (parcelId.startsWith(prefix)) return district;
  }
  return "creator-quarter";
}

/** The board: every parcel id, grouped by the district that owns it. */
export const PLOT_IDS: Record<DistrictId, readonly string[]> = {
  "commerce-core": PARCELS.filter((parcel) => districtOfPlot(parcel.id) === "commerce-core").map((p) => p.id),
  "offer-forge": PARCELS.filter((parcel) => districtOfPlot(parcel.id) === "offer-forge").map((p) => p.id),
  "creator-quarter": PARCELS.filter((parcel) => districtOfPlot(parcel.id) === "creator-quarter").map((p) => p.id),
};

/** Where a plot's works stand, and how big its parcel is, for picking. */
export function plotSite(parcelId: string): { x: number; z: number; width: number; depth: number } {
  const parcel = PARCELS.find((entry) => entry.id === parcelId);
  if (!parcel) return { x: 0, z: 0, width: 10, depth: 10 };
  return { x: parcel.centre.x, z: parcel.centre.z, width: parcel.width, depth: parcel.depth };
}

// ---------------------------------------------------------------------------
// Massing
// ---------------------------------------------------------------------------

/**
 * Storeys per level, per district.
 *
 * Three different curves on purpose. Downtown is where the skyline comes from,
 * so Commerce Core climbs hardest; the Forge is a working district of sheds
 * and stacks and stays broad; the Quarter is in the foreground, so it is held
 * low or it would stand in front of everything behind it. Grown all the way,
 * the three read as a city with a downtown rather than as eleven towers.
 */
const STOREYS: Record<DistrictId, readonly number[]> = {
  "commerce-core": [0, 3, 5, 8, 12, 17],
  "offer-forge": [0, 2, 3, 5, 7, 10],
  "creator-quarter": [0, 2, 3, 4, 6, 8],
};

/** Floor-to-floor, per district. Commercial floors are taller than live/work. */
export const STOREY_HEIGHT: Record<DistrictId, number> = {
  "commerce-core": 3.4,
  "offer-forge": 3.2,
  "creator-quarter": 3.0,
};

/** How many storeys stand on this plot at this level. Zero means vacant. */
export function storeysFor(parcelId: string, level: number): number {
  const ladder = STOREYS[districtOfPlot(parcelId)];
  return ladder[Math.max(0, Math.min(ladder.length - 1, Math.round(level)))];
}

/**
 * A building's level, as the renderer draws its skin.
 *
 * Level nought is bare ground; level one is a site with the frame still going
 * up; from two the building is finished and lit.
 */
export function stateOfLevel(level: number): StateName {
  if (level <= 0) return "dormant";
  if (level === 1) return "rising";
  return "healthy";
}

/** Every plot's level, defaulted, in the shape the renderer wants. */
export function levelsOf(levels: Readonly<Record<string, number>>): Record<string, number> {
  const plan: Record<string, number> = {};
  for (const parcel of PARCELS) plan[parcel.id] = Math.max(0, Math.round(levels[parcel.id] ?? 0));
  return plan;
}

/** The whole board as states, for anything that still speaks that language. */
export function levelPlan(levels: Readonly<Record<string, number>>): Record<string, StateName> {
  const plan: Record<string, StateName> = {};
  for (const parcel of PARCELS) plan[parcel.id] = stateOfLevel(levels[parcel.id] ?? 0);
  return plan;
}
