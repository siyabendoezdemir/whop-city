/**
 * The city's state, which is smaller than it sounds.
 *
 * All the game keeps is which levels the player has *claimed*. Everything else
 * — what a building could be, what it needs next, how far along it is — is
 * derived from the business's real numbers every time it is asked for. There
 * is nothing to drift, nothing to tick, and nothing that could tell you your
 * city is doing better than your business is.
 *
 * Claiming is capped by what the business earned, so the save file is not a
 * cheat sheet: hand-editing it to level five gets you level five only if the
 * numbers back it, and otherwise gets you nothing.
 */

import type { CityMetrics, DistrictId } from "../city/projection";
import {
  BUILDINGS,
  MAX_LEVEL,
  buildingById,
  earnedLevel,
  have,
  needFor,
  tierFor,
  type Building,
} from "./buildings";

export type CityState = {
  readonly seed: string;
  /** Claimed level per building id. Absent means nothing claimed yet. */
  readonly claimed: Readonly<Record<string, number>>;
  /** Local clock of the last claim, so a return can say what changed. */
  readonly lastSeenAt: number;
  /** What the metrics were the last time the player looked. */
  readonly lastSeen: CityMetrics | null;
};

/**
 * A city, opened for the first time.
 *
 * Seeded to what the business has already earned rather than to nothing. A
 * founder with no sales gets bare ground, which is the honest picture and the
 * whole point of the empty start; somebody who has been running a real
 * business for two years gets the city that business built, rather than eleven
 * empty plots and fifty-five buttons to press before it looks like anything.
 *
 * Everything after the first visit is earned live: the levels only move again
 * when the numbers do.
 */
export function newCity(seed: string, now: number, metrics: CityMetrics | null = null): CityState {
  const claimed: Record<string, number> = {};
  if (metrics) {
    for (const building of BUILDINGS) claimed[building.id] = earnedLevel(building, metrics);
  }
  return { seed, claimed, lastSeenAt: now, lastSeen: metrics };
}

/** One building, as the interface needs it. */
export type BuildingView = {
  readonly building: Building;
  /** What the player has taken. Never more than earned. */
  readonly level: number;
  /** What the business has actually reached. */
  readonly earned: number;
  /** Levels sitting there waiting to be claimed. */
  readonly ready: number;
  readonly maxed: boolean;
  /** The number the next level is gated on, or null when finished. */
  readonly need: number | null;
  /** What the business has of it right now. */
  readonly has: number;
  /** 0..1 toward the next level, from the previous rung. */
  readonly progress: number;
  /** How many more of the thing are wanted. Zero when ready. */
  readonly short: number;
};

export function viewOf(building: Building, state: CityState, metrics: CityMetrics): BuildingView {
  const earned = earnedLevel(building, metrics);
  const level = Math.min(state.claimed[building.id] ?? 0, earned);
  const need = needFor(building, level);
  const has = have(metrics, building.resource);
  const from = level === 0 ? 0 : building.ladder[level - 1];

  return {
    building,
    level,
    earned,
    ready: Math.max(0, earned - level),
    maxed: level >= MAX_LEVEL,
    need,
    has,
    progress: need === null ? 1 : Math.max(0, Math.min(1, (has - from) / Math.max(1, need - from))),
    short: need === null ? 0 : Math.max(0, need - has),
  };
}

export function viewAll(state: CityState, metrics: CityMetrics): BuildingView[] {
  return BUILDINGS.map((building) => viewOf(building, state, metrics));
}

/** Every level the player has taken, across the whole city. */
export function totalLevels(state: CityState, metrics: CityMetrics): number {
  return viewAll(state, metrics).reduce((sum, view) => sum + view.level, 0);
}

/** Levels the business has earned and nobody has pressed the button on yet. */
export function readyCount(state: CityState, metrics: CityMetrics): number {
  return viewAll(state, metrics).reduce((sum, view) => sum + view.ready, 0);
}

/**
 * Take one level on a building.
 *
 * Refuses anything the business has not earned, which is the only rule that
 * matters here: the city can never be further along than the account is.
 */
export function claim(state: CityState, id: string, metrics: CityMetrics): CityState {
  const building = buildingById(id);
  if (!building) return state;
  const view = viewOf(building, state, metrics);
  if (view.ready <= 0) return state;
  return { ...state, claimed: { ...state.claimed, [id]: view.level + 1 } };
}

/** Take every level that is waiting, in one go. */
export function claimAll(state: CityState, metrics: CityMetrics): CityState {
  let next = state;
  for (const view of viewAll(state, metrics)) {
    for (let step = 0; step < view.ready; step++) next = claim(next, view.building.id, metrics);
  }
  return next;
}

export function markSeen(state: CityState, metrics: CityMetrics, now: number): CityState {
  return { ...state, lastSeen: metrics, lastSeenAt: now };
}

/** What moved in the business since the player last looked. */
export type Change = { resource: keyof CityMetrics; from: number; to: number };

export function changesSince(state: CityState, metrics: CityMetrics): Change[] {
  const before = state.lastSeen;
  if (!before) return [];
  const changes: Change[] = [];
  for (const key of ["gold", "citizens", "traffic", "recurring", "joined"] as const) {
    if (metrics[key] !== before[key]) changes.push({ resource: key, from: before[key], to: metrics[key] });
  }
  return changes;
}

export function cityTier(state: CityState, metrics: CityMetrics) {
  return tierFor(totalLevels(state, metrics));
}

/** Levels per plot, which is the only thing the renderer needs. */
export function levelsOf(state: CityState, metrics: CityMetrics): Record<string, number> {
  const levels: Record<string, number> = {};
  for (const view of viewAll(state, metrics)) levels[view.building.id] = view.level;
  return levels;
}

/**
 * Which plots should be wearing a bubble, and which bubble.
 *
 * A plus over empty ground, a chevron over a building that has outgrown its
 * current size. Nothing over a plot that is finished or still saving up: a
 * marker over everything is a marker over nothing.
 */
export function markersOf(
  state: CityState,
  metrics: CityMetrics,
): Record<string, "ready" | "build"> {
  const markers: Record<string, "ready" | "build"> = {};
  for (const view of viewAll(state, metrics)) {
    if (view.ready <= 0) continue;
    markers[view.building.id] = view.level === 0 ? "build" : "ready";
  }
  return markers;
}

/** What one district has standing in it, for the rail. */
export function districtTally(
  state: CityState,
  metrics: CityMetrics,
  district: DistrictId,
): { levels: number; ready: number; built: number; plots: number } {
  const views = viewAll(state, metrics).filter((view) => view.building.district === district);
  return {
    levels: views.reduce((sum, view) => sum + view.level, 0),
    ready: views.reduce((sum, view) => sum + view.ready, 0),
    built: views.filter((view) => view.level > 0).length,
    plots: views.length,
  };
}
