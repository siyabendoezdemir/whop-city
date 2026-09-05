/**
 * Running an activity, and what falls out of it.
 *
 * All the rules for walking prompts, deciding when a district is finished, and
 * turning answers into a plan live here rather than in the interface. The shell
 * renders what this returns; it does not decide any of it.
 *
 * Three kinds of fact are kept apart all the way through, because collapsing
 * them is how a game starts lying:
 *
 *   observed  what Whop reported, via the sealed projection
 *   reported  what the operator answered — unverified, and never sent anywhere
 *   local     game progress: which activities are done, in this browser
 *
 * A plan item records which of the three it came from, and the interface is
 * required to show it.
 */

import { activityFor, promptById, type Activity, type Prompt } from "./activities";
import { attentionFor, needsAttention, type AttentionLevel } from "./attention";
import type { Provenance } from "./evidence";
import type { DistrictId, DistrictState, PublicCityProjection, PublicDistrict } from "./projection";

/** One answer the operator gave. The state is what City read when they gave it. */
export type Answer = {
  readonly activityId: string;
  readonly promptId: string;
  readonly districtId: DistrictId;
  /** A CheckAnswer, a CommitAnswer, or an option id. */
  readonly value: string;
  readonly observedState: DistrictState;
  /** Local clock. Never leaves the browser. */
  readonly at: number;
};

export type AnswerSet = readonly Answer[];

export function answerFor(answers: AnswerSet, promptId: string): Answer | null {
  return answers.find((answer) => answer.promptId === promptId) ?? null;
}

// ---------------------------------------------------------------------------
// Walking an activity
// ---------------------------------------------------------------------------

export type ActivityRun = {
  /** Prompts already answered, in the order they were reached. */
  readonly answered: readonly Prompt[];
  /** The prompt waiting for an answer, or null when the activity is finished. */
  readonly current: Prompt | null;
  readonly complete: boolean;
  /** How far along, for the interface. Counts prompts on the path taken. */
  readonly reached: number;
};

/**
 * Follows the answers through the activity.
 *
 * Branching means the length is not known up front: a `choice` decides which
 * prompts exist after it. Anything not on the path taken is simply not part of
 * this run, which is why progress is expressed as prompts reached rather than
 * as a fraction of the whole file.
 */
export function runActivity(activity: Activity, answers: AnswerSet): ActivityRun {
  const answered: Prompt[] = [];
  let cursor: string | undefined = activity.entry;
  const seen = new Set<string>();

  while (cursor) {
    if (seen.has(cursor)) break; // authoring loop; stop rather than hang
    seen.add(cursor);

    const prompt: Prompt | null = promptById(activity, cursor);
    if (!prompt) break;

    const answer = answerFor(answers, prompt.id);
    if (!answer) {
      return { answered, current: prompt, complete: false, reached: answered.length };
    }

    answered.push(prompt);
    cursor =
      prompt.kind === "choice"
        ? prompt.options?.find((option) => option.id === answer.value)?.next
        : prompt.next;
  }

  return { answered, current: null, complete: answered.length > 0, reached: answered.length };
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

export type PlanItemKind = "action" | "decision" | "finding" | "clear" | "note";

export type PlanItem = {
  readonly districtId: DistrictId;
  readonly promptId: string;
  readonly kind: PlanItemKind;
  readonly text: string;
  readonly provenance: Provenance;
  /** True when the district has since been read differently by City. */
  readonly staleAgainstObservation: boolean;
};

/**
 * Turns one activity's answers into plan items.
 *
 * Everything here is `reported`: it is what the operator said, not what City
 * saw. A check answered "looks right" produces a `clear` rather than nothing,
 * because "I checked this and it was fine" is worth keeping — it is the thing
 * that stops the same check being redone next week.
 */
export function planForActivity(
  activity: Activity,
  answers: AnswerSet,
  currentState: DistrictState,
): PlanItem[] {
  const run = runActivity(activity, answers);
  const items: PlanItem[] = [];

  for (const prompt of run.answered) {
    const answer = answerFor(answers, prompt.id);
    if (!answer) continue;

    const stale = answer.observedState !== currentState;
    const base = {
      districtId: activity.districtId,
      promptId: prompt.id,
      provenance: "reported" as const,
      staleAgainstObservation: stale,
    };

    if (prompt.kind === "check") {
      if (answer.value === "problem" && prompt.action) {
        items.push({ ...base, kind: "action", text: prompt.action });
      } else if (answer.value === "confirmed") {
        items.push({ ...base, kind: "clear", text: `Checked: ${prompt.title.toLowerCase()}` });
      } else if (answer.value === "not-applicable") {
        items.push({ ...base, kind: "decision", text: `Not applicable: ${prompt.title.toLowerCase()}` });
      }
      continue;
    }

    if (prompt.kind === "commit") {
      if (answer.value === "will-do" && prompt.action) {
        items.push({ ...base, kind: "action", text: prompt.action });
      } else if (answer.value === "wont-do") {
        items.push({ ...base, kind: "decision", text: `Deliberately not: ${prompt.title.toLowerCase()}` });
      }
      continue;
    }

    const option = prompt.options?.find((entry) => entry.id === answer.value);
    if (option?.outcome) {
      items.push({ ...base, kind: "finding", text: option.outcome });
    }
  }

  return items;
}

// ---------------------------------------------------------------------------
// The session
// ---------------------------------------------------------------------------

export type DistrictWork = {
  readonly district: PublicDistrict;
  /** The operator's own line about this district, if they wrote one. */
  readonly note: string;
  readonly level: AttentionLevel;
  readonly activity: Activity | null;
  readonly run: ActivityRun | null;
  /** This district's answers, so a ledger can show what was said. */
  readonly answers: AnswerSet;
  readonly plan: readonly PlanItem[];
  /** The operator declined this district's whole subject, deliberately. */
  readonly declined: boolean;
  /** City has read this district differently since it was worked. */
  readonly changed: boolean;
  readonly complete: boolean;
};

export type Session = {
  readonly title: string;
  readonly purpose: string;
  readonly work: readonly DistrictWork[];
  /** Districts with an activity that is not yet finished. */
  readonly outstanding: readonly DistrictWork[];
  readonly complete: boolean;
  readonly plan: readonly PlanItem[];
  /** True when City could not read the business at all. */
  readonly unreadable: boolean;
};

/**
 * The declining answers.
 *
 * Only the Creator Quarter gate carries one today, but the concept is general:
 * an option that means "I have decided this subject is not for me" ends the
 * district's work without pretending it was completed as a task.
 */
const DECLINING = new Set(["no", "later"]);

function isDeclined(activity: Activity | null, answers: AnswerSet): boolean {
  if (!activity) return false;
  return activity.prompts.some((prompt) => {
    if (prompt.kind !== "choice") return false;
    const answer = answerFor(answers, prompt.id);
    if (!answer) return false;
    const option = prompt.options?.find((entry) => entry.id === answer.value);
    return option !== undefined && option.next === undefined && DECLINING.has(option.id);
  });
}

/**
 * Names the session after what it is actually for.
 *
 * Derived from the mix of what the city is showing, not from a rotation of
 * titles: the point is that an operator can tell from the name whether it is
 * worth doing now.
 */
function nameSession(work: readonly DistrictWork[], unreadable: boolean): { title: string; purpose: string } {
  if (unreadable) {
    return {
      title: "Nothing to work on",
      purpose: "City could not read the business, so there is nothing here it can honestly suggest.",
    };
  }

  const urgent = work.filter((entry) => entry.level === "urgent");
  const unbuilt = work.filter((entry) => entry.level === "opportunity");
  const watching = work.filter((entry) => entry.level === "watch");

  if (urgent.length > 0) {
    return {
      title: urgent.length > 1 ? "Find what is not adding up" : "Look into the quiet district",
      purpose:
        "City is reading signals that a working district does not usually show. This session narrows down why.",
    };
  }
  if (unbuilt.length > 0) {
    return {
      title: unbuilt.length > 1 ? "Build out the city" : "Build the empty district",
      purpose: "Whop reports nothing in part of the city. This session decides what goes there.",
    };
  }
  if (watching.length > 0) {
    return {
      title: "Check the new work",
      purpose: "Something here was created recently. This session checks it landed the way you meant.",
    };
  }
  return {
    title: "A maintenance round",
    purpose:
      "Nothing is asking for help. These are the checks that are cheaper to do now than to discover later.",
  };
}

/** An operator's own line, keyed by district. Never sent anywhere. */
export type Notes = Readonly<Partial<Record<DistrictId, { text: string; observedState: DistrictState }>>>;

export function buildSession(
  projection: PublicCityProjection,
  answers: AnswerSet,
  notes: Notes = {},
): Session {
  const unreadable = projection.freshness === "unavailable";

  const work: DistrictWork[] = projection.districts.map((district) => {
    const level = attentionFor(district);
    const activity = activityFor(district);
    const districtAnswers = answers.filter((answer) => answer.districtId === district.id);
    const relevant = activity
      ? districtAnswers.filter((answer) => answer.activityId === activity.id)
      : [];
    const run = activity ? runActivity(activity, relevant) : null;
    const declined = isDeclined(activity, relevant);
    const note = notes[district.id];

    // A written note is a plan item like any other: reported, not observed,
    // and marked stale the same way if the reading has moved under it.
    const plan = activity ? planForActivity(activity, relevant, district.state) : [];
    if (note && note.text.trim() !== "") {
      plan.push({
        districtId: district.id,
        promptId: "__note",
        kind: "note",
        text: note.text.trim(),
        provenance: "reported",
        staleAgainstObservation: note.observedState !== district.state,
      });
    }

    return {
      district,
      note: note?.text ?? "",
      level,
      activity,
      run,
      answers: relevant,
      plan,
      declined,
      // Answered under one reading, and City now reads it differently. The
      // work is not wrong; it is just no longer known to be current.
      changed:
        districtAnswers.some((answer) => answer.observedState !== district.state) ||
        (note !== undefined && note.observedState !== district.state),
      complete: run?.complete ?? false,
    };
  });

  // Most pressing first, and anything finished sinks.
  const ordered = [...work].sort((a, b) => {
    if (a.complete !== b.complete) return a.complete ? 1 : -1;
    const rank = (level: AttentionLevel) =>
      level === "urgent" ? 0 : level === "opportunity" ? 1 : level === "watch" ? 2 : 3;
    return rank(a.level) - rank(b.level);
  });

  const outstanding = ordered.filter(
    (entry) => entry.activity !== null && !entry.complete && needsAttention(entry.level),
  );

  return {
    ...nameSession(ordered, unreadable),
    work: ordered,
    outstanding,
    complete: !unreadable && ordered.every((entry) => entry.activity === null || entry.complete),
    plan: ordered.flatMap((entry) => entry.plan),
    unreadable,
  };
}

/** Plan items grouped for display, actions first because they are the point. */
export function planByKind(plan: readonly PlanItem[]): Record<PlanItemKind, PlanItem[]> {
  const grouped: Record<PlanItemKind, PlanItem[]> = {
    action: [],
    decision: [],
    finding: [],
    clear: [],
    note: [],
  };
  for (const item of plan) grouped[item.kind].push(item);
  return grouped;
}

/**
 * The plan as text the operator can take away.
 *
 * The whole point of the session is that something leaves with them. Every line
 * is marked with where it came from, so a plan pasted into a document still
 * says which parts City observed and which parts they reported.
 */
export function planAsText(
  session: Session,
  districtName: (id: DistrictId) => string,
  conditionLabel: (district: PublicDistrict) => string = (district) => district.state,
  now: Date = new Date(),
): string {
  const lines: string[] = [
    `# Whop City — ${session.title}`,
    "",
    now.toISOString().slice(0, 16).replace("T", " ") + " UTC",
    "",
  ];

  for (const entry of session.work) {
    if (entry.plan.length === 0) continue;
    lines.push(`## ${districtName(entry.district.id)}`);
    lines.push(`Whop reported: ${conditionLabel(entry.district)}`);
    if (entry.changed) lines.push("This reading changed after the work below was recorded.");
    lines.push("");

    // Actions first: the reason anyone keeps one of these.
    const order: PlanItemKind[] = ["action", "note", "finding", "decision", "clear"];
    for (const kind of order) {
      for (const item of entry.plan.filter((candidate) => candidate.kind === kind)) {
        const mark =
          item.kind === "action" ? "- [ ]" : item.kind === "clear" ? "- [x]" : item.kind === "note" ? ">" : "-";
        lines.push(`${mark} ${item.text}`);
      }
    }
    lines.push("");
  }

  if (session.plan.length === 0) lines.push("Nothing recorded yet.");
  lines.push("---");
  lines.push(
    "Each district's condition is what Whop reported. Everything under it is what you told Whop City.",
  );
  lines.push(
    "Kept in your browser only. Not sent to Whop, and not a record that the work was done.",
  );
  return lines.join("\n");
}
