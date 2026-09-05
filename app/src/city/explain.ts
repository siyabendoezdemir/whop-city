/**
 * Names for the places, and for how current the reading is.
 *
 * The sentence describing what is physically visible in a district used to live
 * here too. It now lives in `playbook.ts` next to the moves that follow from
 * it, because two independently-maintained descriptions of the same district
 * drift, and the one the operator acts on should be the one they read.
 */

import type { DistrictId } from "./projection";

export const DISTRICT_NAMES: Record<DistrictId, string> = {
  "commerce-core": "Commerce Core",
  "offer-forge": "Offer Forge",
  "creator-quarter": "Creator Quarter",
};

/** What the district is for, in City's own vocabulary. */
export const DISTRICT_SUBTITLES: Record<DistrictId, string> = {
  "commerce-core": "Where the business sells",
  "offer-forge": "Where offers are shaped",
  "creator-quarter": "Where others carry the offer",
};

/** A short, honest line about how current the reading is. */
export const FRESHNESS_NOTE = {
  live: "Read just now",
  recent: "Read minutes ago",
  stale: "Read over an hour ago",
  unavailable: "Could not be read",
} as const;
