/**
 * What a district looks like, in words.
 *
 * Selecting a place opens one sentence about what is physically visible there.
 * Not a metric, not a chart, not a recommendation, and not generated text — a
 * fixed line per district and state, written against what the renderer actually
 * builds, so the words and the world cannot drift apart.
 *
 * The projection carries no numbers, so there is nothing here to quote even if
 * this were the place to do it.
 */

import type { DistrictId, DistrictState, PublicDistrict } from "./projection";

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

const EXPLANATIONS: Record<DistrictId, Record<DistrictState, string>> = {
  "commerce-core": {
    dormant: "Commerce Core is dormant: the plots are cleared and kerbed, but nothing has been built on them yet.",
    rising: "Commerce Core is rising: scaffolding is up, a crane is working the block, and the streets around it have been freshly laid.",
    healthy: "Commerce Core is healthy: shopfronts are lit and awned, deliveries are running the loading bays, and there is traffic on the boulevard.",
    struggling: "Commerce Core is struggling: frontages are boarded, the signs are dark, and the road surface has been patched rather than repaved.",
  },
  "offer-forge": {
    dormant: "Offer Forge is dormant: the yard is empty and the workshop plots are still bare apron.",
    rising: "Offer Forge is rising: a gantry crane is over the yard, the sawtooth sheds are going up, and there is material stacked on the quay.",
    healthy: "Offer Forge is healthy: the sawtooth roofs are glazed and lit, the service lane is busy, and finished work is out on the display plaza.",
    struggling: "Offer Forge is struggling: the sheds are shuttered, the yard is idle, and the plaza is empty.",
  },
  "creator-quarter": {
    dormant: "Creator Quarter is dormant: the terraces and the park are laid out, but the live/work blocks are unbuilt.",
    rising: "Creator Quarter is rising: new terraces are going up above the street and rigging is being fitted to the rooftops.",
    healthy: "Creator Quarter is healthy: rooftop terraces are in use, the venue is open onto the street, and the park is planted.",
    struggling: "Creator Quarter is struggling: the venue is closed, the terraces are stripped back, and the street level has gone quiet.",
  },
};

export function explain(district: PublicDistrict): string {
  return EXPLANATIONS[district.id][district.state];
}

/** A short, honest line about how current the reading is. */
export const FRESHNESS_NOTE = {
  live: "Reading the business now.",
  recent: "Reading from a few minutes ago.",
  stale: "Reading from over an hour ago.",
  unavailable: "The business could not be read, so the city is shown dark.",
} as const;
