/**
 * What the three places are called.
 *
 * One list, so the rail, the quest card and anything else that names a district
 * cannot drift apart. What each district is *for* is not written here: that is
 * `readingFor` in `game/quests.ts`, next to the advice that follows from it,
 * because two independently-maintained descriptions of the same place drift and
 * the one the player acts on should be the one they read.
 */

import type { DistrictId } from "./projection";

export const DISTRICT_NAMES: Record<DistrictId, string> = {
  "commerce-core": "Commerce Core",
  "offer-forge": "Offer Forge",
  "creator-quarter": "Creator Quarter",
};
