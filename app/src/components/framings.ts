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

/**
 * Vertical world units visible in the default view.
 *
 * Widened from the 95 the still composition was tuned to. A fully grown city
 * now puts fifty world units of tower on the headland, and at 95 the crowns
 * of the buildings the player worked hardest for were cropped off the top of
 * the frame — the one thing the wide shot exists to show.
 */
export const CITY_FRUSTUM = 116;
/** Aimed at the boulevard junction, with the core behind and the quarter near. */
export const CITY_FOCUS = [-2, 10, -30] as const;

export const FRAMINGS: Record<FramingKey, Framing> = {
  city: { focus: CITY_FOCUS, height: CITY_FRUSTUM },
  "commerce-core": { focus: [6, 14, -50], height: 74 },
  "offer-forge": { focus: [-46, 8, -10], height: 64 },
  "creator-quarter": { focus: [20, 6, 8], height: 70 },
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
