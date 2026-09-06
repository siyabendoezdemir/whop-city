/**
 * What the city is actually entitled to say.
 *
 * The projection carries four state words per district. Those words are derived
 * on the server in `server/project.ts` from a handful of fields, and this module
 * is the record of exactly which observation each word stands for. Every
 * sentence the interface shows about a district's condition comes from here, so
 * there is one place to check a claim against the derivation that produced it.
 *
 * The rule the previous copy broke: City reads the Whop API. It does not browse
 * the storefront, does not attempt a purchase, and has never seen what a
 * logged-out visitor sees. So it may report what the API reports, and it may
 * suggest a check. It may not report an outcome it did not observe.
 *
 * `tests/evidence.test.ts` proves the mapping by building snapshots, running
 * the real server derivation over them, and asserting the state that comes out
 * is the one this module claims that observation produces. If the derivation
 * changes and the copy does not, that test fails.
 */

import type { DistrictId, DistrictState, PublicDistrict } from "./projection";

/**
 * The classes of observation behind the four state words.
 *
 * `mixed` is the honest one. `struggling` is produced by two different
 * conditions — nothing marked visible, or nothing showing activity — and the
 * projection does not carry which. Saying "buyers cannot reach it" would be
 * picking one and asserting it.
 */
export type EvidenceKind = "nothing" | "mixed" | "recent" | "working" | "unread";

export const EVIDENCE_OF: Record<DistrictState, EvidenceKind> = {
  dormant: "nothing",
  struggling: "mixed",
  rising: "recent",
  healthy: "working",
};

/** What City saw, per district, per class of observation. */
type Reading = {
  /** Strictly what the API reported. No inference. */
  readonly observed: string;
  /**
   * Present only where the observation has more than one explanation. Naming
   * both is the difference between a reading and a diagnosis.
   */
  readonly ambiguity?: string;
};

const READINGS: Record<DistrictId, Record<EvidenceKind, Reading>> = {
  "commerce-core": {
    nothing: { observed: "Whop reports no products for this business." },
    mixed: {
      observed: "Whop reports products here, but not the signals a selling district usually shows.",
      ambiguity:
        "That is either because none of them is marked visible, or because none of them has any members. City cannot tell which from what it reads.",
    },
    recent: {
      observed:
        "Whop reports at least one visible product, and something here was created in the last two weeks.",
    },
    working: {
      observed: "Whop reports visible products with members against them.",
    },
    unread: { observed: "City could not read this district." },
  },

  "offer-forge": {
    nothing: { observed: "Whop reports no plans for this business." },
    mixed: {
      observed: "Whop reports plans here, but not the signals a working pricing surface shows.",
      ambiguity:
        "That is either because none of them is marked visible, or because none of them carries a plan type. City cannot tell which from what it reads.",
    },
    recent: {
      observed:
        "Whop reports at least one visible plan, and something here was created in the last two weeks.",
    },
    working: {
      observed: "Whop reports visible plans, in more than one shape.",
    },
    unread: { observed: "City could not read this district." },
  },

  "creator-quarter": {
    nothing: { observed: "Whop reports no products with affiliates enabled." },
    mixed: {
      observed: "Whop reports some affiliate setup here, but not a programme that would pay out.",
      ambiguity:
        "That is either because only buyer referrals are enabled and not the open programme, or because the programme is enabled at a zero rate. City cannot tell which from what it reads.",
    },
    recent: {
      observed:
        "Whop reports affiliates enabled, on a product created in the last two weeks.",
    },
    working: {
      observed: "Whop reports an affiliate programme enabled at a non-zero rate.",
    },
    unread: { observed: "City could not read this district." },
  },
};

export function evidenceKind(district: PublicDistrict): EvidenceKind {
  return district.signal === "unreadable" ? "unread" : EVIDENCE_OF[district.state];
}

export function readingFor(district: PublicDistrict): Reading {
  return READINGS[district.id][evidenceKind(district)];
}

/**
 * The one-line limit on everything City says.
 *
 * Shown wherever a reading is, so the boundary travels with the claim instead
 * of living in a page footer nobody reads.
 */
export const EVIDENCE_LIMIT =
  "City reads the Whop API. It does not open your storefront or try a purchase.";

/** Where a displayed fact came from. Drives both the words and the styling. */
export const PROVENANCE = ["observed", "reported", "local"] as const;
export type Provenance = (typeof PROVENANCE)[number];

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  observed: "From Whop",
  reported: "You told City",
  local: "This browser",
};

export const PROVENANCE_NOTE: Record<Provenance, string> = {
  observed: "Read from the Whop API through this deployment's own credential.",
  reported: "Your own answer. City did not verify it and did not send it anywhere.",
  local: "Game progress, kept in this browser only. Not sent to Whop.",
};
