/**
 * Where the game meets the world.
 *
 * The authored parcel layout is the board. Each parcel is a plot the player
 * develops, and a plot's level is drawn using the states the city renderer
 * already knows how to build — so the game shows up in the approved
 * architecture rather than in a new set of models bolted on beside it.
 *
 * The ladder, and why each rung looks the way it does:
 *
 *   0          bare ground, exactly as an undeveloped parcel looks today
 *   derelict   standing, desaturated, shutters down and signs dead
 *   1          scaffolding: something going up
 *   2          finished and lit
 *   3          finished, lit, and crowned — the works layer adds the landmark
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

/**
 * A building's level, as the renderer draws it.
 *
 * Level nought is bare ground, level one is scaffolding going up, and from two
 * the building is finished and lit. Above that the works layer keeps growing
 * the tower, which is where the skyline comes from — the architecture below it
 * is the approved city and is not touched.
 */
export function stateOfLevel(level: number): StateName {
  if (level <= 0) return "dormant";
  if (level === 1) return "rising";
  return "healthy";
}

/** The whole board as the renderer wants it. */
export function levelPlan(levels: Readonly<Record<string, number>>): Record<string, StateName> {
  const plan: Record<string, StateName> = {};
  for (const parcel of PARCELS) plan[parcel.id] = stateOfLevel(levels[parcel.id] ?? 0);
  return plan;
}
