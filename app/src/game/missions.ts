/**
 * The Advisor.
 *
 * Growing a city is the goal; this is the part that says *how*. It reads the
 * business's own figures, works out which of a handful of universal
 * bottlenecks it is actually up against, and hands over one thing to do about
 * it — with concrete ways to do it that hold whatever the business sells.
 *
 * Two rules kept it honest to write:
 *
 * **General, not specific.** "Send a hundred cold emails" is good advice for
 * exactly one kind of business and noise for the rest. Every tactic here is
 * phrased so a newsletter, a coaching programme, a trading group and a
 * software product can all act on it today.
 *
 * **It finishes itself.** A mission completes when the number it is about
 * actually moves — not when someone ticks a box. Nothing here can be gamed
 * into a sense of progress the business did not earn, and nothing asks the
 * player to report back.
 */

import type { CityMetrics } from "../city/projection";
import type { Resource } from "./buildings";

/**
 * How far along the business is.
 *
 * Read off paying members, because that is the one number that means the same
 * thing at every size. The city grows with it: a solo founder and a company
 * with staff get different advice from the same advisor.
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

/**
 * What is actually in the way.
 *
 * Ordered by how badly it hurts. A business bleeding members does not need
 * more traffic poured into the top of a leaking bucket, so retention outranks
 * distribution even when traffic is low.
 */
export const BOTTLENECKS = [
  "refunds",
  "churn",
  "conversion",
  "distribution",
  "recurring",
  "setup",
  "healthy",
] as const;
export type Bottleneck = (typeof BOTTLENECKS)[number];

export const BOTTLENECK: Record<Bottleneck, { name: string; reads: string }> = {
  refunds: { name: "Refunds", reads: "People are buying and then asking for their money back." },
  churn: { name: "Leaking members", reads: "Members are leaving faster than a healthy business loses them." },
  conversion: { name: "Nobody is buying", reads: "People are arriving and not becoming members." },
  distribution: { name: "Nobody is arriving", reads: "There is something to buy and almost no one is seeing it." },
  recurring: { name: "Nothing repeats", reads: "The money comes in once and has to be won again." },
  setup: { name: "Nothing to sell", reads: "There is no traffic and no revenue yet." },
  healthy: { name: "Running well", reads: "No obvious hole. This is when you push on what already works." },
};

/** Above this share of members lost, retention is the problem. */
const CHURN_ALARM = 10;
/** Above this share refunded, the promise and the product disagree. */
const REFUND_ALARM = 10;
/** Visitors a day that should be producing at least one member. */
const CONVERSION_FLOOR = 30;

export function bottleneckOf(metrics: CityMetrics): Bottleneck {
  const { citizens, traffic, gold, recurring, churn, refunds } = metrics;

  if (citizens > 0 && refunds >= REFUND_ALARM) return "refunds";
  if (citizens >= 10 && churn >= CHURN_ALARM) return "churn";
  if (traffic === 0 && gold === 0 && citizens === 0) return "setup";
  if (traffic >= CONVERSION_FLOOR && citizens === 0) return "conversion";
  if (citizens > 0 && traffic < CONVERSION_FLOOR) return "distribution";
  if (citizens >= 10 && recurring === 0) return "recurring";
  if (traffic < CONVERSION_FLOOR) return "distribution";
  return "healthy";
}

// ---------------------------------------------------------------------------
// Missions
// ---------------------------------------------------------------------------

export type Mission = {
  readonly id: string;
  /** An instruction, not a topic. */
  readonly title: string;
  /** Why this and not something else, in one line. */
  readonly why: string;
  /** Which resource moving proves it worked. */
  readonly resource: Resource;
  /** Concrete things to try. General enough for any business on Whop. */
  readonly how: readonly string[];
  /** The bottleneck this answers. */
  readonly for: Bottleneck;
  /** Stages this makes sense in. Empty means all of them. */
  readonly stages?: readonly Stage[];
  /**
   * A practice rather than a finish line.
   *
   * Handing work over is not a number the advisor can watch, and showing a bar
   * stuck at nought forever would be worse than admitting that.
   */
  readonly standing?: boolean;
  /** Done when this is true of the live figures. Nobody ticks it off. */
  readonly done: (metrics: CityMetrics) => boolean;
  /** How close it is, 0..1, for the bar. */
  readonly progress: (metrics: CityMetrics) => number;
};

const ratio = (has: number, want: number) => Math.max(0, Math.min(1, has / Math.max(1, want)));

/** At least one member per two hundred visitors is the floor of "it converts". */
const convertedFloor = (traffic: number) => Math.max(1, Math.floor(traffic / 200));

export const MISSIONS: readonly Mission[] = [
  // ------------------------------------------------------------- setup
  {
    id: "first-door",
    title: "Put something on sale",
    why: "Nothing else in the city can move until there is a thing a stranger can buy without asking you first.",
    resource: "gold",
    for: "setup",
    how: [
      "Publish one thing, even a rough one. It does not have to be the thing you end up selling.",
      "Price it. A number you are slightly embarrassed by is still a number people can pay.",
      "Open the checkout yourself once and go all the way to the payment step.",
    ],
    done: (metrics) => metrics.gold > 0 || metrics.citizens > 0,
    progress: (metrics) => (metrics.gold > 0 || metrics.citizens > 0 ? 1 : 0),
  },
  {
    id: "first-hundred",
    title: "Get a hundred people through the gates",
    why: "Below roughly a hundred visitors, nothing you learn about your offer is signal. You are reading noise.",
    resource: "traffic",
    for: "distribution",
    stages: ["founding", "opening", "first-sales"],
    how: [
      "Post where your buyers already gather rather than where you already post.",
      "Message ten people who obviously fit and ask what they would need to see.",
      "Put the link in the one place people already find you — bio, signature, pinned post.",
    ],
    done: (metrics) => metrics.traffic >= 100,
    progress: (metrics) => ratio(metrics.traffic, 100),
  },

  // -------------------------------------------------------- conversion
  {
    id: "first-sale",
    title: "Make the first sale",
    why: "One paying member changes what everything else is worth doing. Until then it is all theory.",
    resource: "citizens",
    for: "conversion",
    stages: ["opening", "founding"],
    how: [
      "Ask the five people most likely to say yes. Directly, not by broadcasting.",
      "Say who it is for in the first line, on the page itself.",
      "Take away every choice that is not 'buy' — one plan, one button.",
    ],
    done: (metrics) => metrics.citizens >= 1,
    progress: (metrics) => ratio(metrics.citizens, 1),
  },
  {
    id: "convert-the-crowd",
    title: "Turn the crowd into members",
    why: "People are arriving and leaving. That is a page problem, not a traffic problem, and more traffic makes it worse.",
    resource: "citizens",
    for: "conversion",
    how: [
      "Watch one person go through it and say nothing while they do.",
      "Cut the page to who it is for, what they get, what it costs.",
      "Offer a smaller first step: a cheaper tier, a trial, a single session.",
    ],
    // A rate, not a count. The first version was done only while traffic
    // stayed low, so a business that grew its way out of the problem could
    // never finish the mission about it.
    done: (metrics) => metrics.citizens >= convertedFloor(metrics.traffic),
    progress: (metrics) => ratio(metrics.citizens, convertedFloor(metrics.traffic)),
  },

  // ------------------------------------------------------ distribution
  {
    id: "steady-traffic",
    title: "Bring people in every day, not in bursts",
    why: "Spikes teach you nothing and do not compound. A boring daily trickle is worth more than one good week.",
    resource: "traffic",
    for: "distribution",
    how: [
      "Pick one channel and show up on it on a schedule you can keep when busy.",
      "Ask three members where they would have looked for something like this.",
      "Turn your best-performing thing into three more of the same shape.",
    ],
    done: (metrics) => metrics.traffic >= 250,
    progress: (metrics) => ratio(metrics.traffic, 250),
  },
  {
    id: "let-others-sell",
    title: "Let other people sell for you",
    why: "Your own reach has a ceiling. Other people's does not, and it costs nothing until it works.",
    resource: "traffic",
    for: "distribution",
    stages: ["traction", "growth", "scale"],
    how: [
      "Turn on affiliates and set a rate you could still pay in a year.",
      "Hand the link to the five members who already recommend you unprompted.",
      "Write the one paragraph you would want someone else to copy and paste.",
    ],
    done: (metrics) => metrics.traffic >= 1000,
    progress: (metrics) => ratio(metrics.traffic, 1000),
  },

  // --------------------------------------------------------- recurring
  {
    id: "make-it-repeat",
    title: "Make the money come back on its own",
    why: "One-off revenue has to be won again every month. Recurring revenue is the only kind that compounds while you sleep.",
    resource: "recurring",
    for: "recurring",
    how: [
      "Add a monthly option beside the one-off, even at a lower price.",
      "Find the part people keep coming back for and sell that part on its own.",
      "Ask three of your best customers what would make it worth paying for monthly.",
    ],
    done: (metrics) => metrics.recurring > 0,
    progress: (metrics) => (metrics.recurring > 0 ? 1 : 0),
  },
  {
    id: "grow-the-reserve",
    title: "Get the reserve above a thousand a month",
    why: "Past this, the business pays for itself before you do anything. It is the line where it stops being fragile.",
    resource: "recurring",
    for: "healthy",
    stages: ["traction", "growth", "scale"],
    how: [
      "Move the price up for new members only and leave everyone else alone.",
      "Add one tier above the current top for the people already asking for more.",
      "Win back the members who left in the last month — they already know you.",
    ],
    done: (metrics) => metrics.recurring >= 1000,
    progress: (metrics) => ratio(metrics.recurring, 1000),
  },

  // ------------------------------------------------------------- churn
  {
    id: "stop-the-leak",
    title: "Stop the members leaving",
    why: "Above roughly one in ten a month you are refilling a bucket with a hole in it, and every pound of traffic runs straight out.",
    resource: "citizens",
    for: "churn",
    how: [
      "Message five people who left and ask the single question: what happened?",
      "Look at what a member does in their first week. Most leaving is decided there.",
      "Give the first week a fixed, obvious path rather than a room full of doors.",
    ],
    done: (metrics) => metrics.churn < CHURN_ALARM,
    progress: (metrics) => (metrics.churn <= 0 ? 1 : ratio(CHURN_ALARM, Math.max(1, metrics.churn))),
  },

  // ----------------------------------------------------------- refunds
  {
    id: "close-the-gap",
    title: "Close the gap between the promise and the thing",
    why: "Refunds are not a payment problem. They are the page and the product describing two different products.",
    resource: "gold",
    for: "refunds",
    how: [
      "Read your own sales page as someone who just asked for their money back.",
      "Say plainly on the page who this is not for.",
      "Put the thing people expected first, on day one, before anything else.",
    ],
    done: (metrics) => metrics.refunds < REFUND_ALARM,
    progress: (metrics) => (metrics.refunds <= 0 ? 1 : ratio(REFUND_ALARM, Math.max(1, metrics.refunds))),
  },

  // ----------------------------------------------------------- healthy
  {
    id: "double-down",
    title: "Do more of the thing that is already working",
    why: "Nothing is broken. The highest-return move now is the boring one: more of what already earns.",
    resource: "gold",
    for: "healthy",
    how: [
      "Find the single source that brought the most members and give it twice the effort.",
      "Raise the price for new members and watch whether anything actually changes.",
      "Write down what you did this month that worked, so next month is not guesswork.",
    ],
    done: (metrics) => metrics.gold > metrics.goldBefore && metrics.goldBefore > 0,
    progress: (metrics) => (metrics.goldBefore === 0 ? 0 : ratio(metrics.gold, metrics.goldBefore)),
  },
  {
    id: "build-the-team",
    title: "Hand one thing over",
    why: "At this size the constraint stops being sales and starts being you. The city grows past what one person can run.",
    resource: "gold",
    for: "healthy",
    stages: ["scale"],
    standing: true,
    how: [
      "Pick the task you do most often and write down how you do it.",
      "Give that one away completely rather than half of three things.",
      "Add them to the account properly so you are not the only key.",
    ],
    done: () => false,
    progress: () => 0,
  },
];

/**
 * What the advisor is pointing at right now.
 *
 * One mission, not a list: a board of twelve things is a backlog, and a
 * backlog is the opposite of guidance. Anything already true of the business
 * is skipped, so the advisor never asks for something that is already done.
 */
export function currentMission(metrics: CityMetrics): Mission | null {
  const stage = stageOf(metrics);
  const bottleneck = bottleneckOf(metrics);

  const fits = (mission: Mission) =>
    !mission.done(metrics) && (mission.stages === undefined || mission.stages.includes(stage));

  return (
    MISSIONS.find((mission) => mission.for === bottleneck && fits(mission)) ??
    MISSIONS.find((mission) => fits(mission)) ??
    null
  );
}

/** Everything the advisor could be pointing at, for the log. */
export function missionsFor(metrics: CityMetrics): Mission[] {
  const stage = stageOf(metrics);
  return MISSIONS.filter(
    (mission) => mission.stages === undefined || mission.stages.includes(stage),
  );
}

/** Missions the business has already satisfied. Worth showing; worth nothing else. */
export function completedMissions(metrics: CityMetrics): Mission[] {
  return MISSIONS.filter((mission) => mission.done(metrics));
}
