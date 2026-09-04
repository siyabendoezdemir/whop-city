/**
 * Which districts are asking for attention, and how loudly.
 *
 * Derived entirely from the sealed projection — `state`, `direction`, `signal`
 * and nothing else. There is no extra field on the wire for this and there does
 * not need to be: the four physical states already say whether a place is in
 * trouble, being built, or getting on with it.
 *
 * The ranking is a judgement about where an operator's next hour is best spent,
 * not a measurement of anything. A shuttered district outranks an empty one
 * because something was built there and has stopped working; an empty one
 * outranks a healthy one because it is the cheapest thing left to build.
 */

import type { DistrictState, Direction, PublicDistrict, Signal } from "./projection";

export const ATTENTION_LEVELS = ["urgent", "opportunity", "watch", "steady", "unknown"] as const;
export type AttentionLevel = (typeof ATTENTION_LEVELS)[number];

/** Lower sorts first. */
const RANK: Record<AttentionLevel, number> = {
  urgent: 0,
  opportunity: 1,
  watch: 2,
  steady: 3,
  unknown: 4,
};

/** One line naming the level, for the queue. Never a claim about the business. */
export const ATTENTION_LABEL: Record<AttentionLevel, string> = {
  urgent: "Needs attention",
  opportunity: "Unbuilt",
  watch: "Worth watching",
  steady: "Running",
  unknown: "Unreadable",
};

export function attentionFor(district: PublicDistrict): AttentionLevel {
  if (district.signal === "unreadable") return "unknown";

  switch (district.state satisfies DistrictState) {
    case "struggling":
      // Something is built here and it is not working.
      return "urgent";
    case "dormant":
      // Nothing is built here. Cheap to change, easy to leave forever.
      return "opportunity";
    case "rising":
      // Under construction. Worth watching, not worth panicking about.
      return "watch";
    case "healthy":
      // Healthy but losing pace is the one healthy case worth a look.
      return district.direction === "cooling" ? "watch" : "steady";
  }
}

export function needsAttention(level: AttentionLevel): boolean {
  return level === "urgent" || level === "opportunity" || level === "watch";
}

export type Attention = {
  district: PublicDistrict;
  level: AttentionLevel;
};

/**
 * The queue, most pressing first.
 *
 * Ties keep projection order, which is stable for a given business, so the
 * queue does not reshuffle itself between loads.
 */
export function attentionQueue(districts: readonly PublicDistrict[]): Attention[] {
  return districts
    .map((district) => ({ district, level: attentionFor(district) }))
    .sort((a, b) => RANK[a.level] - RANK[b.level]);
}

/**
 * A word for the direction, for the briefing header.
 *
 * Kept vague on purpose: the projection's `direction` is itself a coarse bucket
 * with no history behind it, and dressing it up as a trend would be inventing
 * precision that was never measured.
 */
export const DIRECTION_NOTE: Record<Direction, string> = {
  rising: "something new here recently",
  steady: "no recent change",
  cooling: "nothing recent, and quiet",
  dormant: "nothing here yet",
};

/** A word for how much is visibly going on. Also a bucket, also not a number. */
export const SIGNAL_NOTE: Record<Signal, string> = {
  unbuilt: "nothing built",
  quiet: "little visible activity",
  stirring: "some activity",
  busy: "busy",
  thriving: "busy throughout",
  unreadable: "could not be read",
};
