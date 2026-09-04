import type { DistrictId } from "../city/projection";

/**
 * Camera framings, as plain numbers.
 *
 * Deliberately free of any three import: the shell needs to list the districts
 * and name the default framing, and it must be able to do that without pulling
 * the renderer into its chunk.
 *
 * The angle is fixed at the approved three-quarter composition. A framing is a
 * focus point and a frustum height — a dolly and a zoom, never an orbit.
 */

export type FramingKey = "city" | DistrictId;
export type Framing = { focus: readonly [number, number, number]; height: number };

/** Vertical world units visible in the default view. Tuned to fill 1440x900. */
export const CITY_FRUSTUM = 95;
/** Aimed at the boulevard junction, with the core behind and the quarter near. */
export const CITY_FOCUS = [-2, 6, -28] as const;

export const FRAMINGS: Record<FramingKey, Framing> = {
  city: { focus: CITY_FOCUS, height: CITY_FRUSTUM },
  "commerce-core": { focus: [6, 10, -50], height: 60 },
  "offer-forge": { focus: [-46, 5, -10], height: 52 },
  "creator-quarter": { focus: [20, 4, 8], height: 62 },
};

export const FRAMING_ORDER: FramingKey[] = [
  "city",
  "commerce-core",
  "offer-forge",
  "creator-quarter",
];

export function framingFor(key: string): Framing {
  return FRAMINGS[(key as FramingKey) in FRAMINGS ? (key as FramingKey) : "city"];
}
