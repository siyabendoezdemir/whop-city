/**
 * The words the city uses for itself.
 *
 * One vocabulary, in one file, so a condition is named the same way in the
 * command bar, in the dossier, in the plan and in the fallback. The words are
 * terse on purpose: a status that takes a sentence to read is a status nobody
 * reads at a glance.
 *
 * They are also chosen to hold the line `evidence.ts` draws. "Not adding up" is
 * the label for the ambiguous state precisely because it does not say what is
 * wrong — City cannot see which of two things it is, and a confident-sounding
 * label would give that away for free.
 */

import type { EvidenceKind } from "./evidence";

export type ConditionTone = "alert" | "open" | "active" | "steady" | "dark";

export type Condition = {
  /** One or two words. Shown everywhere the condition is shown. */
  readonly label: string;
  /** A sentence, for the dossier. Still no diagnosis. */
  readonly line: string;
  readonly tone: ConditionTone;
  /** Drawn, not typed: a glyph so the state reads without colour. */
  readonly glyph: "alert" | "plot" | "scaffold" | "steady" | "unknown";
};

export const CONDITION: Record<EvidenceKind, Condition> = {
  mixed: {
    label: "Not adding up",
    line: "Whop's reading here is not what a working district looks like.",
    tone: "alert",
    glyph: "alert",
  },
  nothing: {
    label: "Unbuilt",
    line: "Nothing has been built here yet.",
    tone: "open",
    glyph: "plot",
  },
  recent: {
    label: "New work",
    line: "Something here was made in the last two weeks.",
    tone: "active",
    glyph: "scaffold",
  },
  working: {
    label: "Steady",
    line: "Nothing here is asking for attention.",
    tone: "steady",
    glyph: "steady",
  },
  unread: {
    label: "No reading",
    line: "City could not read this district.",
    tone: "dark",
    glyph: "unknown",
  },
};

/**
 * What the player has done here.
 *
 * Deliberately quieter than the condition. A district that has been worked is
 * still whatever Whop says it is, and the interface must not let the second
 * fact shout as loudly as the first.
 */
export type ProgressWord = "worked" | "declined" | "changed" | "started" | null;

export const PROGRESS_LABEL: Record<NonNullable<ProgressWord>, string> = {
  worked: "Worked",
  declined: "Set aside",
  changed: "Re-read",
  started: "In progress",
};

/** The verb on the one dominant control, given where the player is. */
export function primaryVerb(started: boolean, complete: boolean): string {
  if (complete) return "Open plan";
  return started ? "Resume round" : "Begin round";
}
