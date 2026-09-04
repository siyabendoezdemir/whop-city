/**
 * The operator playbook.
 *
 * A briefing per district per physical state: what the city is showing, what
 * that district is for, and the moves worth making next.
 *
 * Every move is a **check the operator performs in Whop themselves**. That
 * phrasing is the whole discipline of this file. The projection carries four
 * state words and nothing else, so City knows that a district is struggling and
 * does not know why — it has never seen a product title, a price, a member
 * count or a date. A move may therefore say "open your plans and confirm at
 * least one is visible". It may never say "your plans are hidden", because that
 * would be City asserting a specific fact about a business it cannot see.
 *
 * The text is fixed and hand-written. Nothing here is generated, and nothing
 * here interpolates a value from the projection beyond the district's own name.
 */

import type { DistrictId, DistrictState, PublicDistrict } from "./projection";

export type Move = {
  /** Stable across renders and across sessions: the review log keys on it. */
  readonly id: string;
  readonly title: string;
  readonly detail: string;
};

export type Briefing = {
  /** What the city is showing, in one line. */
  readonly reading: string;
  /** Why this district is worth an operator's time at all. */
  readonly stake: string;
  readonly moves: readonly Move[];
};

/** What each district is for. True by construction, not read from a business. */
export const DISTRICT_ROLE: Record<DistrictId, string> = {
  "commerce-core": "Everything a buyer can actually buy lives here.",
  "offer-forge": "Every way to pay for it is shaped here.",
  "creator-quarter": "Other people selling on your behalf show up here.",
};

const PLAYBOOK: Record<DistrictId, Record<DistrictState, Briefing>> = {
  "commerce-core": {
    struggling: {
      reading: "Something was built here and buyers cannot reach it.",
      stake: DISTRICT_ROLE["commerce-core"],
      moves: [
        {
          id: "core.struggling.visibility",
          title: "Check each product's visibility",
          detail:
            "Open your products in Whop and confirm the ones you expect to sell are set to visible rather than hidden or archived.",
        },
        {
          id: "core.struggling.logged-out",
          title: "Open your store as a stranger",
          detail:
            "Load your own storefront in a private window. What a logged-out visitor can see is what the city is reading.",
        },
        {
          id: "core.struggling.checkout",
          title: "Walk one product to checkout",
          detail:
            "Pick a product you expect to be buyable and go as far as the payment step. A break anywhere before it reads the same as being closed.",
        },
      ],
    },
    dormant: {
      reading: "The plots are cleared and kerbed, and nothing is built on them.",
      stake: DISTRICT_ROLE["commerce-core"],
      moves: [
        {
          id: "core.dormant.first-product",
          title: "Publish one product",
          detail:
            "One visible product is the difference between a city with a centre and a city without one. It does not have to be the right one yet.",
        },
        {
          id: "core.dormant.describe",
          title: "Say what it is",
          detail:
            "Give it a title and a description a stranger could read without context. Nothing else in the city works until this does.",
        },
      ],
    },
    rising: {
      reading: "Scaffolding is up. Something here was built or changed recently.",
      stake: DISTRICT_ROLE["commerce-core"],
      moves: [
        {
          id: "core.rising.confirm-live",
          title: "Confirm the new work is actually live",
          detail:
            "Recently created is not the same as reachable. Check the newest product is visible and appears where you expect it to.",
        },
        {
          id: "core.rising.checkout",
          title: "Buy it yourself, or get as close as you can",
          detail:
            "The first purchase path is the one most likely to be broken. Walk it once before anyone else does.",
        },
      ],
    },
    healthy: {
      reading: "Shopfronts are lit, deliveries are running, there is traffic.",
      stake: DISTRICT_ROLE["commerce-core"],
      moves: [
        {
          id: "core.healthy.spot-check",
          title: "Spot-check one purchase path",
          detail:
            "A working store stops working quietly. Walking one path occasionally is cheaper than finding out from a buyer.",
        },
        {
          id: "core.healthy.stale-listings",
          title: "Look for anything visible that should not be",
          detail:
            "Old products left on show cost nothing to remove and quietly compete with the ones you want bought.",
        },
      ],
    },
  },

  "offer-forge": {
    struggling: {
      reading: "The sheds are shuttered and the yard is idle.",
      stake: DISTRICT_ROLE["offer-forge"],
      moves: [
        {
          id: "forge.struggling.plan-visibility",
          title: "Check each plan's visibility",
          detail:
            "Open your plans in Whop and confirm at least one is visible. A product with no reachable plan cannot be bought, however good it looks.",
        },
        {
          id: "forge.struggling.attached",
          title: "Confirm every product has a plan attached",
          detail:
            "A plan that exists but is not attached to anything is a price nobody can pay.",
        },
        {
          id: "forge.struggling.expiry",
          title: "Look for plans that have run out",
          detail:
            "Expiring plans go quiet rather than announcing themselves. Check whether anything you rely on has passed its date.",
        },
      ],
    },
    dormant: {
      reading: "The yard is empty and the workshop plots are bare apron.",
      stake: DISTRICT_ROLE["offer-forge"],
      moves: [
        {
          id: "forge.dormant.first-plan",
          title: "Attach one plan to one product",
          detail:
            "Until there is a way to pay, nothing in Commerce Core can convert. This is the smallest unblocking move available.",
        },
        {
          id: "forge.dormant.shape",
          title: "Decide one-off or recurring",
          detail:
            "Pick the one that matches how the thing is actually delivered. You can add the other later; you cannot un-charge someone.",
        },
      ],
    },
    rising: {
      reading: "A gantry is over the yard and the sheds are going up.",
      stake: DISTRICT_ROLE["offer-forge"],
      moves: [
        {
          id: "forge.rising.purchasable",
          title: "Confirm the new plan is purchasable",
          detail:
            "Created, visible and attached are three separate things. Check all three on whatever changed most recently.",
        },
        {
          id: "forge.rising.currency",
          title: "Check the currency and the amount",
          detail:
            "A pricing change is the single easiest thing to get wrong by an order of magnitude. Read it once more.",
        },
        {
          id: "forge.rising.old-plans",
          title: "Decide what happens to the plan it replaces",
          detail:
            "Leaving the old one visible means selling both. Removing it without checking means breaking anyone mid-renewal.",
        },
      ],
    },
    healthy: {
      reading: "Roofs are glazed and lit, the service lane is busy.",
      stake: DISTRICT_ROLE["offer-forge"],
      moves: [
        {
          id: "forge.healthy.orphans",
          title: "Look for plans attached to nothing",
          detail:
            "They accumulate quietly and make the pricing surface harder to reason about than it needs to be.",
        },
        {
          id: "forge.healthy.spread",
          title: "Read your prices side by side",
          detail:
            "Seen together rather than one at a time, gaps and overlaps in the ladder are usually obvious.",
        },
      ],
    },
  },

  "creator-quarter": {
    struggling: {
      reading: "The venue is closed and the street level has gone quiet.",
      stake: DISTRICT_ROLE["creator-quarter"],
      moves: [
        {
          id: "quarter.struggling.enabled",
          title: "Check whether affiliates are switched on",
          detail:
            "Open the affiliate settings on your products and confirm the ones you meant to open up are actually enabled.",
        },
        {
          id: "quarter.struggling.commission",
          title: "Check the commission is worth someone's time",
          detail:
            "A rate set at or near zero is indistinguishable from having no programme at all.",
        },
      ],
    },
    dormant: {
      reading: "The terraces and park are laid out; the blocks are unbuilt.",
      stake: DISTRICT_ROLE["creator-quarter"],
      moves: [
        {
          id: "quarter.dormant.decide",
          title: "Decide whether you want affiliates at all",
          detail:
            "This is a real choice, not an oversight to correct. Paying for reach suits some offers and not others.",
        },
        {
          id: "quarter.dormant.rate",
          title: "If yes, set one rate and leave it",
          detail:
            "A rate you can afford indefinitely beats a generous one you withdraw in a month.",
        },
      ],
    },
    rising: {
      reading: "New terraces are going up and rigging is being fitted.",
      stake: DISTRICT_ROLE["creator-quarter"],
      moves: [
        {
          id: "quarter.rising.link",
          title: "Follow an affiliate link yourself",
          detail:
            "End to end, in a private window. A referral that does not attribute is worse than no programme, because someone worked for it.",
        },
        {
          id: "quarter.rising.terms",
          title: "Write down what you are promising",
          detail:
            "Rate, what counts as a sale, and when it pays. Affiliates ask, and the answer should not change between askings.",
        },
      ],
    },
    healthy: {
      reading: "Rooftop terraces are in use and the venue is open.",
      stake: DISTRICT_ROLE["creator-quarter"],
      moves: [
        {
          id: "quarter.healthy.rate-review",
          title: "Check the rate is still one you want to pay",
          detail:
            "Rates set early tend to outlive the maths that justified them.",
        },
        {
          id: "quarter.healthy.member-affiliates",
          title: "Decide whether buyers should be able to refer too",
          detail:
            "It is a separate setting from the open programme, and it is easy to have meant to turn on and not have.",
        },
      ],
    },
  },
};

/** The briefing for a district as the city currently reads it. */
export function briefingFor(district: PublicDistrict): Briefing {
  return PLAYBOOK[district.id][district.state];
}

/**
 * What to show when the business could not be read.
 *
 * No moves. Recommending work off a reading that failed would be inventing the
 * reading, and an operator acting on it would be acting on nothing.
 */
export const UNREADABLE_BRIEFING: Briefing = {
  reading: "This district could not be read.",
  stake: "Until the city can read the business, there is nothing here to act on.",
  moves: [],
};

export function briefingForOrUnreadable(district: PublicDistrict): Briefing {
  return district.signal === "unreadable" ? UNREADABLE_BRIEFING : briefingFor(district);
}
