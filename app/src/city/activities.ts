/**
 * What there is to do in a district.
 *
 * The first version of this gave every district the same mechanic: read a
 * paragraph, tick three boxes. That is a to-do list wearing a city. An activity
 * here is a short structured piece of work that leaves something behind — a
 * decision, a finding, or a prepared next step — and the shape of it follows
 * the district and what City actually observed there.
 *
 * Three prompt types, mixed differently per district:
 *
 *   check    a guided audit step. Confirmed, a problem, or not applicable.
 *   choice   a branching question. The answer selects what comes next.
 *   commit   a decision to do something, or deliberately not to.
 *
 * Every answer is the operator's own report. City did not verify any of it and
 * does not send it anywhere — see `evidence.ts` for how provenance is carried
 * through to the interface.
 *
 * The content rule, inherited from `evidence.ts`: a prompt may ask the operator
 * to look at something in Whop. It may not tell them what they will find, and
 * it may not assert how the platform behaves beyond what is documented.
 */

import type { EvidenceKind } from "./evidence";
import type { DistrictId, PublicDistrict } from "./projection";
import { evidenceKind } from "./evidence";

export type PromptKind = "check" | "choice" | "commit";

/** Answers a `check` accepts. "Not applicable" is a real, valid outcome. */
export const CHECK_ANSWERS = ["confirmed", "problem", "not-applicable"] as const;
export type CheckAnswer = (typeof CHECK_ANSWERS)[number];

export const CHECK_LABEL: Record<CheckAnswer, string> = {
  confirmed: "Looks right",
  problem: "Found a problem",
  "not-applicable": "Not applicable",
};

/** Answers a `commit` accepts. Declining is a decision, not a skip. */
export const COMMIT_ANSWERS = ["will-do", "wont-do"] as const;
export type CommitAnswer = (typeof COMMIT_ANSWERS)[number];

export const COMMIT_LABEL: Record<CommitAnswer, string> = {
  "will-do": "I'll do this",
  "wont-do": "Deliberately not",
};

export type Option = {
  readonly id: string;
  readonly label: string;
  /** The prompt this answer leads to. Absent means the activity ends here. */
  readonly next?: string;
  /** What this answer means, carried into the plan. */
  readonly outcome?: string;
};

export type Prompt = {
  readonly id: string;
  readonly kind: PromptKind;
  readonly title: string;
  /** Why an operator would bother. Never a claim about their data. */
  readonly why: string;
  /** `choice` only. */
  readonly options?: readonly Option[];
  /** `check`/`commit` only. The next prompt, or the end. */
  readonly next?: string;
  /** What lands in the plan when a check finds a problem, or a commit is taken. */
  readonly action?: string;
};

export type Activity = {
  readonly id: string;
  readonly districtId: DistrictId;
  readonly evidence: EvidenceKind;
  readonly title: string;
  /** One line on what this session of work is for. */
  readonly purpose: string;
  readonly prompts: readonly Prompt[];
  /** Where the activity starts. */
  readonly entry: string;
};

// ---------------------------------------------------------------------------
// Commerce Core — guided audits over the selling surface.
// ---------------------------------------------------------------------------

const COMMERCE: Record<EvidenceKind, Activity | null> = {
  mixed: {
    id: "commerce.mixed",
    districtId: "commerce-core",
    evidence: "mixed",
    title: "Narrow down the quiet",
    purpose:
      "City can see the district is not showing the signals of a working one, but not which of the two reasons it is. Four checks separate them.",
    entry: "visible",
    prompts: [
      {
        id: "visible",
        kind: "check",
        title: "Open your products and read the visibility column",
        why: "One of the two things City's reading could mean is that nothing here is marked visible.",
        action: "Set the products you intend to sell to visible.",
        next: "archived",
      },
      {
        id: "archived",
        kind: "check",
        title: "Check whether anything you expected is archived",
        why: "An archived product is not a hidden one, and the two are easy to confuse in a list.",
        action: "Restore anything archived that you still intend to sell.",
        next: "members",
      },
      {
        id: "members",
        kind: "check",
        title: "Look at whether any product has members against it",
        why: "The other thing City's reading could mean is that the products are visible and nobody has bought one.",
        action: "Treat this as a demand question rather than a configuration one.",
        next: "path",
      },
      {
        id: "path",
        kind: "check",
        title: "Open one product the way you would send it to someone",
        why: "You are the only one who can see what a buyer sees. City cannot open your storefront.",
        action: "Fix whatever stopped you getting to the payment step.",
      },
    ],
  },

  nothing: {
    id: "commerce.nothing",
    districtId: "commerce-core",
    evidence: "nothing",
    title: "Open the shop",
    purpose: "Whop reports nothing to sell. Two decisions get the district built.",
    entry: "first",
    prompts: [
      {
        id: "first",
        kind: "commit",
        title: "Publish one product, even a rough one",
        why: "Nothing else in the city can work until there is something to buy. It does not have to be the right product yet.",
        action: "Publish one product.",
        next: "describe",
      },
      {
        id: "describe",
        kind: "commit",
        title: "Write a description a stranger could follow",
        why: "You will send this link to someone with no context. The description is the whole pitch.",
        action: "Write the product description.",
      },
    ],
  },

  recent: {
    id: "commerce.recent",
    districtId: "commerce-core",
    evidence: "recent",
    title: "Check the new work landed",
    purpose: "Something here was created in the last two weeks. Three checks before anyone else finds it.",
    entry: "live",
    prompts: [
      {
        id: "live",
        kind: "check",
        title: "Confirm the newest product is the one you meant to publish",
        why: "Created and visible are separate settings, and a draft left visible is as bad as the reverse.",
        action: "Correct the visibility on the newest product.",
        next: "link",
      },
      {
        id: "link",
        kind: "check",
        title: "Open its link yourself, once",
        why: "The first path to a new product is the one most likely to be wrong, and you are the only one who can walk it.",
        action: "Fix the path to the new product.",
        next: "copy",
      },
      {
        id: "copy",
        kind: "check",
        title: "Read the title and description back",
        why: "Placeholder text survives publishing more often than anyone expects.",
        action: "Rewrite the placeholder copy.",
      },
    ],
  },

  working: {
    id: "commerce.working",
    districtId: "commerce-core",
    evidence: "working",
    title: "Keep it working",
    purpose: "Nothing here is asking for help. Two checks that are cheaper than finding out from a buyer.",
    entry: "spot",
    prompts: [
      {
        id: "spot",
        kind: "check",
        title: "Walk one purchase path end to end",
        why: "A working shop stops working quietly, and nothing in City would see it happen.",
        action: "Fix the path you found broken.",
        next: "stale",
      },
      {
        id: "stale",
        kind: "check",
        title: "Look for anything visible you no longer sell",
        why: "Old listings cost nothing to remove and quietly compete with the ones you want bought.",
        action: "Hide or archive the listings you no longer sell.",
      },
    ],
  },

  unread: null,
};

// ---------------------------------------------------------------------------
// Offer Forge — decisions about the shape of the pricing surface.
// ---------------------------------------------------------------------------

const FORGE: Record<EvidenceKind, Activity | null> = {
  nothing: {
    id: "forge.nothing",
    districtId: "offer-forge",
    evidence: "nothing",
    title: "Choose a shape",
    purpose:
      "Whop reports no plans. Pricing is easier to decide than to change, so this is a branching decision rather than a checklist.",
    entry: "shape",
    prompts: [
      {
        id: "shape",
        kind: "choice",
        title: "How is the thing you sell actually delivered?",
        why: "The delivery shape decides the plan shape. Getting these to disagree is the most common pricing mistake, and the most expensive to unwind.",
        options: [
          {
            id: "once",
            label: "Once, and they keep it",
            next: "once-price",
            outcome: "A one-off plan matches how this is delivered.",
          },
          {
            id: "ongoing",
            label: "Continuously, for as long as they pay",
            next: "ongoing-term",
            outcome: "A recurring plan matches how this is delivered.",
          },
          {
            id: "both",
            label: "Some of each",
            next: "both-first",
            outcome: "Both shapes are needed, but not on day one.",
          },
        ],
      },
      {
        id: "once-price",
        kind: "commit",
        title: "Attach a one-off plan and read the amount back once",
        why: "An order-of-magnitude slip in a price field is the single easiest mistake to make here.",
        action: "Attach a one-off plan and re-read the amount.",
      },
      {
        id: "ongoing-term",
        kind: "choice",
        title: "How long is one billing period?",
        why: "Renewal period sets the refund conversations you will have, not just the cash flow.",
        options: [
          { id: "monthly", label: "A month", outcome: "Monthly renewal chosen." },
          { id: "annual", label: "A year", outcome: "Annual renewal chosen." },
        ],
      },
      {
        id: "both-first",
        kind: "commit",
        title: "Ship the recurring one first, alone",
        why: "Two plans at launch means two things to debug and no signal about which people wanted.",
        action: "Publish the recurring plan first and hold the one-off back.",
      },
    ],
  },

  mixed: {
    id: "forge.mixed",
    districtId: "offer-forge",
    evidence: "mixed",
    title: "Find the gap in the pricing surface",
    purpose:
      "Whop reports plans but not the signals of a working surface, and City cannot tell which of the two reasons applies. Three checks separate them.",
    entry: "visible",
    prompts: [
      {
        id: "visible",
        kind: "check",
        title: "Read the visibility on each plan",
        why: "One of the two things City's reading could mean is that no plan is marked visible.",
        action: "Make at least one plan visible on each product you sell.",
        next: "typed",
      },
      {
        id: "typed",
        kind: "check",
        title: "Check each plan has a type set",
        why: "The other thing it could mean is that the plans carry no plan type, which is what City counts as the shape of the surface.",
        action: "Set the plan type on any plan missing one.",
        next: "attached",
      },
      {
        id: "attached",
        kind: "check",
        title: "Confirm each product has a plan attached",
        why: "A plan that exists but is attached to nothing is a price nobody can reach.",
        action: "Attach the orphaned plans, or remove them.",
      },
    ],
  },

  recent: {
    id: "forge.recent",
    districtId: "offer-forge",
    evidence: "recent",
    title: "Check the new plan",
    purpose: "A plan here was created in the last two weeks. Two checks and one decision.",
    entry: "amount",
    prompts: [
      {
        id: "amount",
        kind: "check",
        title: "Read the amount and the currency back",
        why: "Pricing changes are the easiest thing here to get wrong by a factor of ten.",
        action: "Correct the amount or currency on the new plan.",
        next: "reachable",
      },
      {
        id: "reachable",
        kind: "check",
        title: "Confirm it is visible and attached to the right product",
        why: "Created, visible and attached are three separate settings.",
        action: "Fix the visibility or attachment on the new plan.",
        next: "old",
      },
      {
        id: "old",
        kind: "choice",
        title: "What happens to the plan this one replaces, if any?",
        why: "Leaving both visible sells both. Changing an existing plan can affect people already on it, so check Whop's own guidance before you touch it rather than assuming either way.",
        options: [
          { id: "none", label: "It does not replace anything", outcome: "Nothing to retire." },
          {
            id: "retire",
            label: "Retire it for new buyers",
            outcome: "Old plan to be hidden from new buyers, existing holders left alone.",
          },
          {
            id: "keep",
            label: "Keep both on sale",
            outcome: "Both plans stay on sale, deliberately.",
          },
        ],
      },
    ],
  },

  working: {
    id: "forge.working",
    districtId: "offer-forge",
    evidence: "working",
    title: "Read the ladder",
    purpose: "Nothing is wrong here. Seen side by side rather than one at a time, gaps are usually obvious.",
    entry: "spread",
    prompts: [
      {
        id: "spread",
        kind: "choice",
        title: "Put your prices in a row. What do you see?",
        why: "Pricing is decided one plan at a time and experienced all at once.",
        options: [
          { id: "fine", label: "It reads as a sensible ladder", outcome: "Ladder reviewed, no change wanted." },
          {
            id: "gap",
            label: "There is a gap in the middle",
            next: "gap-commit",
            outcome: "A gap in the ladder was identified.",
          },
          {
            id: "crowd",
            label: "Two of them do the same job",
            next: "crowd-commit",
            outcome: "Two overlapping plans were identified.",
          },
        ],
      },
      {
        id: "gap-commit",
        kind: "commit",
        title: "Decide whether the gap is worth a plan",
        why: "A gap is only a problem if someone is standing in it. Adding a plan you cannot explain makes the ladder harder to read.",
        action: "Decide on the middle plan, and write down who it is for.",
      },
      {
        id: "crowd-commit",
        kind: "commit",
        title: "Retire or differentiate one of the overlapping plans",
        why: "Two plans doing one job means every buyer has a decision to make that you could have made for them.",
        action: "Retire or clearly differentiate one of the overlapping plans.",
      },
    ],
  },

  unread: null,
};

// ---------------------------------------------------------------------------
// Creator Quarter — an opt-out gate first. Affiliates are optional.
// ---------------------------------------------------------------------------

const QUARTER: Record<EvidenceKind, Activity | null> = {
  nothing: {
    id: "quarter.nothing",
    districtId: "creator-quarter",
    evidence: "nothing",
    title: "Decide about affiliates",
    purpose:
      "Whop reports no affiliate setup. That is a legitimate choice, so this starts by asking whether you want one at all.",
    entry: "want",
    prompts: [
      {
        id: "want",
        kind: "choice",
        title: "Do you want other people selling on your behalf?",
        why: "Paying for reach suits some offers and not others. This is a real decision, not a gap to close.",
        options: [
          {
            id: "no",
            label: "No, deliberately",
            outcome: "Affiliates are deliberately not part of this business.",
          },
          {
            id: "later",
            label: "Not yet, but keep it in mind",
            outcome: "Affiliates deferred, not ruled out.",
          },
          { id: "yes", label: "Yes", next: "rate" },
        ],
      },
      {
        id: "rate",
        kind: "commit",
        title: "Pick a rate you can pay indefinitely",
        why: "A rate you withdraw in a month costs more goodwill than a smaller one you keep.",
        action: "Set the affiliate rate.",
        next: "terms",
      },
      {
        id: "terms",
        kind: "commit",
        title: "Write down what counts as a sale, and when it pays",
        why: "Affiliates ask, and the answer should not change between askings.",
        action: "Write the affiliate terms down somewhere you can send them.",
      },
    ],
  },

  mixed: {
    id: "quarter.mixed",
    districtId: "creator-quarter",
    evidence: "mixed",
    title: "Find what is half-set",
    purpose:
      "Whop reports some affiliate setup but not a programme that would pay out, and City cannot tell which half is missing.",
    entry: "programme",
    prompts: [
      {
        id: "programme",
        kind: "check",
        title: "Check whether the open programme is on, not just buyer referrals",
        why: "These are two separate settings, and having meant to turn on the first is easy.",
        action: "Enable the open affiliate programme where you intended to.",
        next: "rate",
      },
      {
        id: "rate",
        kind: "check",
        title: "Read the commission rate",
        why: "The other thing City's reading could mean is that the programme is on at a rate of zero.",
        action: "Set a commission rate above zero, or turn the programme off deliberately.",
        next: "intent",
      },
      {
        id: "intent",
        kind: "commit",
        title: "Decide whether you actually want this running",
        why: "Half-configured is the worst of both: it costs attention and returns nothing.",
        action: "Finish the affiliate setup, or switch it off.",
      },
    ],
  },

  recent: {
    id: "quarter.recent",
    districtId: "creator-quarter",
    evidence: "recent",
    title: "Test the referral path",
    purpose: "Affiliates are enabled on something created recently. Two checks before anyone works for a broken link.",
    entry: "link",
    prompts: [
      {
        id: "link",
        kind: "check",
        title: "Follow an affiliate link yourself, in a private window",
        why: "A referral that does not attribute is worse than no programme, because someone worked for it.",
        action: "Fix the referral link before sharing it.",
        next: "terms",
      },
      {
        id: "terms",
        kind: "check",
        title: "Check the terms you are about to publish match the rate you set",
        why: "The rate and the promise are edited in different places and drift apart quietly.",
        action: "Align the published terms with the configured rate.",
      },
    ],
  },

  working: {
    id: "quarter.working",
    districtId: "creator-quarter",
    evidence: "working",
    title: "Review the programme",
    purpose: "The programme is running. One decision worth revisiting occasionally.",
    entry: "rate",
    prompts: [
      {
        id: "rate",
        kind: "choice",
        title: "Is the rate still one you want to pay?",
        why: "Rates set early tend to outlive the arithmetic that justified them.",
        options: [
          { id: "keep", label: "Yes, leave it", outcome: "Rate reviewed and kept." },
          {
            id: "change",
            label: "No, it needs changing",
            next: "change-commit",
            outcome: "The rate needs changing.",
          },
        ],
      },
      {
        id: "change-commit",
        kind: "commit",
        title: "Decide the new rate before you open the settings",
        why: "Changing a live rate mid-session, with affiliates already promoting, is how two different promises end up in circulation.",
        action: "Decide the new rate, then change it once.",
      },
    ],
  },

  unread: null,
};

const BY_DISTRICT: Record<DistrictId, Record<EvidenceKind, Activity | null>> = {
  "commerce-core": COMMERCE,
  "offer-forge": FORGE,
  "creator-quarter": QUARTER,
};

/** The activity for a district as the city currently reads it, if any. */
export function activityFor(district: PublicDistrict): Activity | null {
  return BY_DISTRICT[district.id][evidenceKind(district)];
}

export function promptById(activity: Activity, id: string): Prompt | null {
  return activity.prompts.find((prompt) => prompt.id === id) ?? null;
}

/** Every activity, for tests and for the plan writer. */
export function allActivities(): Activity[] {
  return Object.values(BY_DISTRICT).flatMap((byEvidence) =>
    Object.values(byEvidence).filter((activity): activity is Activity => activity !== null),
  );
}
