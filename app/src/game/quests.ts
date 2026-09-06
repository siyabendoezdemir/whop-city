/**
 * Quests.
 *
 * Growing the city is the goal; this is the part that says *how*. Every
 * district runs its own board, because the three districts are three different
 * jobs and lumping them into one queue meant a business with a distribution
 * problem never heard a word about its offer.
 *
 *   **Commerce Core** is about money arriving. Sales, price, refunds.
 *   **Offer Forge** is about money arriving *again*. Recurring, tiers, terms.
 *   **Creator Quarter** is about people. Reach, conversion, retention.
 *
 * Four rules kept this honest to write.
 *
 * **General, not specific.** "Send a hundred cold emails" is good advice for
 * exactly one kind of business and noise for the rest. Every step here is
 * phrased so a newsletter, a coaching programme, a trading group and a
 * software product can all act on it today.
 *
 * **It finishes itself.** A quest completes when the number it is about
 * actually moves — not when somebody ticks a box. Nothing here can be gamed
 * into a sense of progress the business did not earn.
 *
 * **Problems outrank milestones.** Within a district, anything actively going
 * wrong is offered before the next rung of the ladder. There is no point
 * chasing ten thousand a month while a quarter of the members leave.
 *
 * **Nothing runs out.** Every district ends in a standing practice, so a
 * business that has done everything measurable still has something to open.
 */

import type { CityMetrics, DistrictId } from "../city/projection";
import { DISTRICT_IDS } from "../city/projection";
import type { Resource } from "./buildings";

/**
 * How far along the business is.
 *
 * Read off paying members, because that is the one number that means the same
 * thing at every size. The advice grows with it: a solo founder and a company
 * with staff get different quests from the same board.
 */
export const STAGES = ["founding", "opening", "first-sales", "traction", "growth", "scale"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE: Record<Stage, { name: string; blurb: string }> = {
  founding: { name: "Founding", blurb: "Nothing is selling yet. The first job is to have something to sell." },
  opening: { name: "Opening", blurb: "People are arriving. Now they need a reason to stay." },
  "first-sales": { name: "First sales", blurb: "It works. Now find out whether it works twice." },
  traction: { name: "Traction", blurb: "Enough customers to learn from. Time to find what repeats." },
  growth: { name: "Growth", blurb: "The machine runs. Feed the parts that compound." },
  scale: { name: "Scale", blurb: "Big enough that the constraints are people and process, not sales." },
};

export function stageOf(metrics: CityMetrics): Stage {
  const { citizens, traffic, gold } = metrics;
  if (citizens >= 1000) return "scale";
  if (citizens >= 100) return "growth";
  if (citizens >= 10) return "traction";
  if (citizens >= 1) return "first-sales";
  if (traffic > 0 || gold > 0) return "opening";
  return "founding";
}

/** Above this share of members lost in a month, retention is the problem. */
export const CHURN_ALARM = 10;
/** Above this share refunded, the promise and the product disagree. */
export const REFUND_ALARM = 10;
/** Visitors a day below which nothing you learn about the offer is signal. */
export const AUDIENCE_FLOOR = 100;
/** At least one member per this many visitors is the floor of "it converts". */
const VISITORS_PER_MEMBER = 200;

const converted = (traffic: number) => Math.max(1, Math.floor(traffic / VISITORS_PER_MEMBER));

const ratio = (has: number, want: number) => Math.max(0, Math.min(1, has / Math.max(1, want)));

export type Quest = {
  readonly id: string;
  readonly district: DistrictId;
  /** An instruction, not a topic. */
  readonly title: string;
  /** Why this and not something else, in one line. */
  readonly why: string;
  /** Which resource moving proves it worked. */
  readonly resource: Resource;
  /** Concrete things to try. General enough for any business on Whop. */
  readonly how: readonly string[];
  /** Stages this makes sense in. Absent means all of them. */
  readonly stages?: readonly Stage[];
  /**
   * Something has gone wrong and this is the answer to it. Urgent quests are
   * offered before any milestone in the same district.
   */
  readonly urgent?: boolean;
  /**
   * A practice rather than a finish line.
   *
   * Handing work over is not a number anything here can watch, and showing a
   * bar stuck at nought forever would be worse than admitting that.
   */
  readonly standing?: boolean;
  /** Only worth offering when this is true of the business. */
  readonly when?: (metrics: CityMetrics) => boolean;
  /** Done when this is true of the live figures. Nobody ticks it off. */
  readonly done: (metrics: CityMetrics) => boolean;
  /** How close it is, 0..1, for the bar. */
  readonly progress: (metrics: CityMetrics) => number;
  /**
   * The number that finishes it, where there is one.
   *
   * Carried explicitly rather than recovered from the progress fraction,
   * because at nought progress there is nothing to recover it from — and a bar
   * reading "$0" with no goal beside it is the exact "what am I supposed to do"
   * problem the card exists to solve.
   */
  readonly target?: (metrics: CityMetrics) => number;
  /**
   * For a quest finished by a rate coming *down* rather than a count going up.
   *
   * Refunds and churn are not "reach a number of members"; reporting them
   * against the resource ladder would put "$0 revenue" under a quest about
   * refunds. They say what they actually are instead.
   */
  readonly rate?: (metrics: CityMetrics) => { now: string; goal: string; label: string };
};

/** A milestone: reach this number of this thing. The bulk of every board. */
function rung(
  id: string,
  district: DistrictId,
  resource: Resource,
  target: number,
  title: string,
  why: string,
  how: readonly string[],
  extra: Partial<Quest> = {},
): Quest {
  return {
    id,
    district,
    resource,
    title,
    why,
    how,
    done: (metrics) => metrics[resource] >= target,
    progress: (metrics) => ratio(metrics[resource], target),
    target: () => target,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Commerce Core — money arriving
// ---------------------------------------------------------------------------

const CORE: readonly Quest[] = [
  {
    id: "core-refunds",
    district: "commerce-core",
    title: "Close the gap between the promise and the thing",
    why: "Refunds are not a payment problem. They are the page and the product describing two different products.",
    resource: "gold",
    urgent: true,
    when: (metrics) => metrics.citizens > 0 && metrics.refunds >= REFUND_ALARM,
    how: [
      "Read your own sales page as somebody who just asked for their money back.",
      "Say plainly on the page who this is not for, and mean it.",
      "Put the thing people expected first, on day one, before anything else.",
    ],
    done: (metrics) => metrics.refunds < REFUND_ALARM,
    progress: (metrics) => (metrics.refunds <= 0 ? 1 : ratio(REFUND_ALARM, Math.max(1, metrics.refunds))),
    rate: (metrics) => ({
      now: `${metrics.refunds}%`,
      goal: `under ${REFUND_ALARM}%`,
      label: "refunded",
    }),
  },
  {
    id: "core-recover",
    district: "commerce-core",
    title: "Get back to what last month took",
    why: "Revenue fell. Something changed — the traffic, the offer, or the season — and guessing which is how a bad month becomes a bad quarter.",
    resource: "gold",
    urgent: true,
    when: (metrics) => metrics.goldBefore > 0 && metrics.gold < metrics.goldBefore * 0.8,
    how: [
      "Compare where buyers came from this month against last month, source by source.",
      "Check that every way to buy still works, all the way to the payment step.",
      "Ask three people who bought last month and not this one what changed for them.",
    ],
    done: (metrics) => metrics.goldBefore === 0 || metrics.gold >= metrics.goldBefore,
    progress: (metrics) => ratio(metrics.gold, Math.max(1, metrics.goldBefore)),
    target: (metrics) => metrics.goldBefore,
  },
  rung(
    "core-open",
    "commerce-core",
    "gold",
    1,
    "Take the first payment",
    "Nothing else in the city can move until there is something a stranger can buy without asking you first.",
    [
      "Publish one thing, even a rough one. It does not have to be what you end up selling.",
      "Price it. A number you are slightly embarrassed by is still a number people can pay.",
      "Open your own checkout once and go all the way through to the payment step.",
    ],
  ),
  rung(
    "core-hundred",
    "commerce-core",
    "gold",
    100,
    "Take a hundred in a month",
    "The first hundred is not the money. It is proof that the path from a stranger to a payment exists at all.",
    [
      "Ask the five people most likely to say yes. Directly, not by broadcasting at them.",
      "Cut the page down to who it is for, what they get, and what it costs.",
      "Remove every choice on the page that is not the one you want them to make.",
    ],
  ),
  rung(
    "core-thousand",
    "commerce-core",
    "gold",
    1_000,
    "Take a thousand in a month",
    "At a thousand you can see which of the things you did actually worked, instead of guessing from one sale.",
    [
      "Write down where every buyer this month came from, then do more of the top one.",
      "Raise the price for new buyers and watch whether anything actually changes.",
      "Give people who already bought a second, larger thing to buy.",
    ],
  ),
  rung(
    "core-ten-thousand",
    "commerce-core",
    "gold",
    10_000,
    "Take ten thousand in a month",
    "This is the level where the business pays somebody. Getting here is mostly about repeating one thing rather than finding a new one.",
    [
      "Find the single source that brought the most money and give it twice the effort.",
      "Add a higher tier for the buyers already asking you for more.",
      "Stop doing the two things that brought the least. They are costing you the top one.",
    ],
    { stages: ["traction", "growth", "scale"] },
  ),
  rung(
    "core-hundred-thousand",
    "commerce-core",
    "gold",
    100_000,
    "Take a hundred thousand in a month",
    "Past here, growth comes from the parts of the business that run without you touching them.",
    [
      "Put a number on what one new customer costs you, and on what one is worth.",
      "Spend deliberately on the channel where the second number beats the first.",
      "Make the top tier something a serious buyer would be disappointed not to find.",
    ],
    { stages: ["growth", "scale"] },
  ),
  {
    id: "core-books",
    district: "commerce-core",
    title: "Know your numbers before you need them",
    why: "At this size the risk stops being 'nobody buys' and starts being 'nobody noticed the month it stopped growing'.",
    resource: "gold",
    standing: true,
    how: [
      "Look at revenue and refunds on the same day each month, whatever else is happening.",
      "Write one line about what you changed that month, so next month is not guesswork.",
      "Keep a figure for what the business costs to run, beside what it takes.",
    ],
    done: () => false,
    progress: () => 0,
  },
];

// ---------------------------------------------------------------------------
// Offer Forge — money arriving again
// ---------------------------------------------------------------------------

const FORGE: readonly Quest[] = [
  rung(
    "forge-open",
    "offer-forge",
    "recurring",
    1,
    "Make the money come back on its own",
    "One-off revenue has to be won again every month from scratch. Recurring revenue is the only kind that compounds while you sleep.",
    [
      "Add a monthly option beside the one-off, even at a lower price than feels right.",
      "Find the part people keep coming back for and sell that part on its own.",
      "Ask three of your best customers what would make it worth paying for monthly.",
    ],
    { when: (metrics) => metrics.gold > 0 || metrics.citizens > 0 },
  ),
  rung(
    "forge-two-fifty",
    "offer-forge",
    "recurring",
    250,
    "Get the reserve to two hundred and fifty a month",
    "Small, but it is the first money that arrives without you doing anything, and that changes what the business is.",
    [
      "Move everyone renewing onto the same day of the month so you can see it land.",
      "Say what arrives each month, not just what they get once. People renew for the drip.",
      "Make cancelling ask one question first: what would have kept you?",
    ],
  ),
  rung(
    "forge-thousand",
    "offer-forge",
    "recurring",
    1_000,
    "Get the reserve past a thousand a month",
    "Past this the business pays for something before you do anything. It is the line where it stops being fragile.",
    [
      "Add one tier above the current top for the people already asking for more.",
      "Move the price up for new members only, and leave everybody else alone.",
      "Win back the members who left in the last month — they already know you.",
    ],
    { stages: ["first-sales", "traction", "growth", "scale"] },
  ),
  rung(
    "forge-five-thousand",
    "offer-forge",
    "recurring",
    5_000,
    "Get the reserve past five thousand a month",
    "This is a salary that arrives whether or not you sold anything this week. It is worth protecting more than any single launch.",
    [
      "Offer a year up front at a discount. Cash now, and a year without a churn decision.",
      "Give the top tier something the others cannot get, rather than more of the same.",
      "Fix the two most common reasons people cancel before adding anything new.",
    ],
    { stages: ["traction", "growth", "scale"] },
  ),
  rung(
    "forge-twenty-five-thousand",
    "offer-forge",
    "recurring",
    25_000,
    "Get the reserve past twenty-five thousand a month",
    "At this level the offer is a product line, not an offer. It needs owning deliberately rather than tweaking.",
    [
      "Review the price list as a whole once a quarter, not one tier at a time.",
      "Retire the tier nobody buys. A dead option costs every buyer a decision.",
      "Put someone on renewals whose only job is the month people were going to leave.",
    ],
    { stages: ["growth", "scale"] },
  ),
  {
    id: "forge-write-it-down",
    district: "offer-forge",
    title: "Write the offer down so somebody else could sell it",
    why: "An offer that only works when you explain it in person is a job. One that survives being written down is a product.",
    resource: "recurring",
    standing: true,
    how: [
      "Write who it is for, what changes for them, and what it costs, on one page.",
      "Hand that page to somebody outside the business and watch where they frown.",
      "Keep the page as the source of truth, and change the site to match it.",
    ],
    done: () => false,
    progress: () => 0,
  },
];

// ---------------------------------------------------------------------------
// Creator Quarter — the people
// ---------------------------------------------------------------------------

const QUARTER: readonly Quest[] = [
  {
    id: "quarter-churn",
    district: "creator-quarter",
    title: "Stop the members leaving",
    why: "Above roughly one in ten a month you are refilling a bucket with a hole in it, and every visitor you win runs straight back out.",
    resource: "citizens",
    urgent: true,
    when: (metrics) => metrics.citizens >= 10 && metrics.churn >= CHURN_ALARM,
    how: [
      "Message five people who left and ask the one question: what happened?",
      "Look at what a member does in their first week. Most leaving is decided there.",
      "Give the first week a fixed, obvious path rather than a room full of doors.",
    ],
    done: (metrics) => metrics.churn < CHURN_ALARM,
    progress: (metrics) => (metrics.churn <= 0 ? 1 : ratio(CHURN_ALARM, Math.max(1, metrics.churn))),
    rate: (metrics) => ({
      now: `${metrics.churn}%`,
      goal: `under ${CHURN_ALARM}%`,
      label: "leaving each month",
    }),
  },
  {
    id: "quarter-convert",
    district: "creator-quarter",
    title: "Turn the crowd into members",
    why: "People are arriving and leaving again. That is a page problem, not a traffic problem, and more traffic makes it worse.",
    resource: "citizens",
    urgent: true,
    when: (metrics) =>
      metrics.traffic >= AUDIENCE_FLOOR && metrics.citizens < converted(metrics.traffic),
    how: [
      "Watch one person go through it start to finish and say nothing while they do.",
      "Cut the page to three things: who it is for, what they get, what it costs.",
      "Offer a smaller first step — a cheaper tier, a trial, a single session.",
    ],
    done: (metrics) => metrics.citizens >= converted(metrics.traffic),
    progress: (metrics) => ratio(metrics.citizens, converted(metrics.traffic)),
    target: (metrics) => converted(metrics.traffic),
  },
  rung(
    "quarter-first-hundred",
    "creator-quarter",
    "traffic",
    AUDIENCE_FLOOR,
    "Get a hundred people through the gates",
    "Below about a hundred visitors, nothing you learn about your offer is signal. You are reading noise.",
    [
      "Post where your buyers already gather rather than where you already post.",
      "Message ten people who obviously fit and ask what they would need to see.",
      "Put the link in the one place people already find you — bio, signature, pinned post.",
    ],
  ),
  rung(
    "quarter-first-member",
    "creator-quarter",
    "citizens",
    1,
    "Win the first member",
    "One paying member changes what everything else is worth doing. Until then all of it is theory.",
    [
      "Ask the five people most likely to say yes, one at a time, by name.",
      "Say who it is for in the first line, on the page itself, in their words.",
      "Take away every choice that is not 'join' — one plan, one button.",
    ],
    { when: (metrics) => metrics.traffic > 0 || metrics.gold > 0 },
  ),
  rung(
    "quarter-daily",
    "creator-quarter",
    "traffic",
    250,
    "Bring people in every day, not in bursts",
    "Spikes teach you nothing and do not compound. A boring daily trickle is worth more than one good week.",
    [
      "Pick one channel and show up on it on a schedule you can keep when busy.",
      "Ask three members where they would have looked for something like this.",
      "Turn your best-performing thing into three more of the same shape.",
    ],
  ),
  rung(
    "quarter-fifty",
    "creator-quarter",
    "citizens",
    50,
    "Get to fifty members",
    "Fifty is the first number you can learn from. Below it every pattern you think you see is three people.",
    [
      "Ask the last ten who joined what nearly stopped them, and fix the top answer.",
      "Give members one reason to come back weekly that does not depend on you being there.",
      "Make it obvious and easy for a happy member to bring somebody with them.",
    ],
    { stages: ["first-sales", "traction", "growth", "scale"] },
  ),
  rung(
    "quarter-reach",
    "creator-quarter",
    "traffic",
    1_000,
    "Let other people bring the crowd",
    "Your own reach has a ceiling. Other people's does not, and it costs nothing until it works.",
    [
      "Turn on affiliates and set a rate you would still be happy to pay in a year.",
      "Hand the link to the five members who already recommend you unprompted.",
      "Write the one paragraph you would want somebody else to copy and paste.",
    ],
    { stages: ["traction", "growth", "scale"] },
  ),
  rung(
    "quarter-thousand",
    "creator-quarter",
    "citizens",
    1_000,
    "Get to a thousand members",
    "A thousand people is a place, not an audience. It needs running, and it starts being worth more than the product.",
    [
      "Name the handful of members who answer everyone else, and give them a role.",
      "Publish what the place is for, so newcomers know what good behaviour looks like.",
      "Measure how many are still here after ninety days, and treat that as the real number.",
    ],
    { stages: ["growth", "scale"] },
  ),
  {
    id: "quarter-hand-over",
    district: "creator-quarter",
    title: "Hand one thing over",
    why: "At this size the constraint stops being sales and starts being you. The city grows past what one person can run.",
    resource: "citizens",
    standing: true,
    how: [
      "Pick the task you do most often and write down exactly how you do it.",
      "Give that one away completely rather than half of three different things.",
      "Add them to the account properly, so you are not the only key to the building.",
    ],
    done: () => false,
    progress: () => 0,
  },
];

export const QUESTS: readonly Quest[] = [...CORE, ...FORGE, ...QUARTER];

const BOARD: Record<DistrictId, readonly Quest[]> = {
  "commerce-core": CORE,
  "offer-forge": FORGE,
  "creator-quarter": QUARTER,
};

export function questsIn(district: DistrictId): readonly Quest[] {
  return BOARD[district];
}

function offered(quest: Quest, metrics: CityMetrics, stage: Stage): boolean {
  if (quest.done(metrics)) return false;
  if (quest.stages && !quest.stages.includes(stage)) return false;
  if (quest.when && !quest.when(metrics)) return false;
  return true;
}

/**
 * What this district is asking for right now.
 *
 * Problems first, then the next rung, then the standing practice. Never null:
 * a district with nothing to say would be a dead end, and the board ends in a
 * practice precisely so it cannot happen.
 */
export function questFor(district: DistrictId, metrics: CityMetrics): Quest | null {
  const stage = stageOf(metrics);
  const board = BOARD[district];
  return (
    board.find((quest) => quest.urgent && offered(quest, metrics, stage)) ??
    board.find((quest) => !quest.urgent && !quest.standing && offered(quest, metrics, stage)) ??
    board.find((quest) => quest.standing) ??
    null
  );
}

/**
 * The one thing to do next, across the whole city.
 *
 * An urgent quest anywhere outranks every milestone; otherwise the district
 * furthest behind goes first, so the advice pulls the city level rather than
 * pushing the strongest district further ahead.
 */
export function cityQuest(metrics: CityMetrics): Quest | null {
  const open = DISTRICT_IDS.map((id) => questFor(id, metrics)).filter(
    (quest): quest is Quest => quest !== null,
  );
  if (open.length === 0) return null;
  const urgent = open.find((quest) => quest.urgent);
  if (urgent) return urgent;
  const measurable = open.filter((quest) => !quest.standing);
  if (measurable.length === 0) return open[0];
  return measurable.reduce((worst, quest) =>
    quest.progress(metrics) < worst.progress(metrics) ? quest : worst,
  );
}

/** Everything the business has already satisfied. Worth showing; worth nothing else. */
export function completedQuests(metrics: CityMetrics): Quest[] {
  return QUESTS.filter((quest) => !quest.standing && quest.done(metrics));
}

// ---------------------------------------------------------------------------
// How each district is doing, in one line
// ---------------------------------------------------------------------------

export type Reading = { tone: "bad" | "flat" | "good"; line: string };

/**
 * A district's condition, said plainly.
 *
 * Only claims what the figures support. There is no history store beyond last
 * month's revenue and yesterday's footfall, so nothing here says "trending" or
 * puts a rate on anything.
 */
export function readingFor(district: DistrictId, metrics: CityMetrics): Reading {
  if (district === "commerce-core") {
    if (metrics.refunds >= REFUND_ALARM) return { tone: "bad", line: "Refunds are undoing the sales" };
    if (metrics.gold === 0) return { tone: "flat", line: "Nothing has sold this month" };
    if (metrics.goldBefore > 0 && metrics.gold < metrics.goldBefore * 0.8) {
      return { tone: "bad", line: "Down on last month" };
    }
    if (metrics.gold > metrics.goldBefore) return { tone: "good", line: "Up on last month" };
    return { tone: "flat", line: "Money is arriving" };
  }

  if (district === "offer-forge") {
    if (metrics.recurring === 0) {
      return { tone: metrics.gold > 0 ? "bad" : "flat", line: "Nothing renews on its own yet" };
    }
    if (metrics.gold > 0 && metrics.recurring >= metrics.gold * 0.4) {
      return { tone: "good", line: "Most of the book renews itself" };
    }
    return { tone: "flat", line: "Some of it comes back each month" };
  }

  if (metrics.citizens >= 10 && metrics.churn >= CHURN_ALARM) {
    return { tone: "bad", line: "Members are leaving faster than they arrive" };
  }
  if (metrics.traffic === 0 && metrics.citizens === 0) return { tone: "flat", line: "Nobody has arrived yet" };
  if (metrics.traffic >= AUDIENCE_FLOOR && metrics.citizens < converted(metrics.traffic)) {
    return { tone: "bad", line: "People arrive and do not stay" };
  }
  if (metrics.traffic > metrics.trafficBefore) return { tone: "good", line: "Busier than yesterday" };
  if (metrics.trafficBefore > 0 && metrics.traffic < metrics.trafficBefore * 0.7) {
    return { tone: "bad", line: "Quieter than yesterday" };
  }
  return { tone: "flat", line: "Steady footfall" };
}
