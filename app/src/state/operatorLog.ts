/**
 * The operator's own log.
 *
 * Local to this browser and nothing else. Recording an answer records that
 * *you said something*; it does not perform the work, does not tell Whop
 * anything, and is not read back from anywhere. The interface says so at the
 * point of the click, and this module is deliberately the only thing that
 * writes it, so there is one place to check that claim against.
 *
 * Three things are kept:
 *
 *   answers  what you said to each prompt, with the public state word the
 *            district showed at the time
 *   notes    an optional line of your own per district
 *   rounds   rounds you finished and then filed, so starting a new one is not
 *            the same act as destroying the last one
 *
 * That is all. No projection, no business data, and nothing derived from
 * either — the recorded state is one of four public words the browser was
 * already holding.
 *
 * Keyed by the projection's opaque seed, so two businesses opened in the same
 * browser keep separate logs and neither can read the other's.
 */

import type { DistrictId } from "../city/projection";
import type { Answer, AnswerSet, PlanItemKind } from "../city/session";

const STORAGE_PREFIX = "whop-city.log.v3";

/** Bumped if the shape below changes; older payloads are dropped, not migrated. */
const SCHEMA = 3;

/** Long enough to be useful, short enough that it cannot become a document. */
export const NOTE_LIMIT = 400;

/** How many finished rounds are kept before the oldest is dropped. */
export const ROUNDS_KEPT = 6;

export type DistrictNote = {
  readonly districtId: DistrictId;
  readonly text: string;
  /** The public state word the district showed when the note was written. */
  readonly observedState: string;
  readonly at: number;
};

/**
 * A round the operator finished and filed.
 *
 * Self-describing on purpose: it carries the condition word each district was
 * showing at the time, so an old round read back later never borrows today's
 * reading and pretends it was the one being worked against.
 */
export type FiledRound = {
  readonly at: number;
  readonly title: string;
  readonly items: ReadonlyArray<{
    readonly districtId: DistrictId;
    readonly districtName: string;
    readonly condition: string;
    readonly kind: PlanItemKind;
    readonly text: string;
  }>;
};

export type OperatorLog = {
  readonly schema: number;
  readonly answers: AnswerSet;
  readonly notes: readonly DistrictNote[];
  readonly rounds: readonly FiledRound[];
};

export const EMPTY_LOG: OperatorLog = { schema: SCHEMA, answers: [], notes: [], rounds: [] };

function storageKey(seed: string): string {
  return `${STORAGE_PREFIX}:${seed}`;
}

/**
 * Storage that cannot throw.
 *
 * Private browsing, disabled storage and quota errors all end the same way: the
 * log is empty and the round still works. A log is a convenience, and losing it
 * must never take the city down with it.
 */
function storage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function isAnswer(value: unknown): value is Answer {
  if (typeof value !== "object" || value === null) return false;
  const answer = value as Record<string, unknown>;
  return (
    typeof answer.activityId === "string" &&
    typeof answer.promptId === "string" &&
    typeof answer.districtId === "string" &&
    typeof answer.value === "string" &&
    typeof answer.observedState === "string" &&
    typeof answer.at === "number"
  );
}

function isNote(value: unknown): value is DistrictNote {
  if (typeof value !== "object" || value === null) return false;
  const note = value as Record<string, unknown>;
  return (
    typeof note.districtId === "string" &&
    typeof note.text === "string" &&
    typeof note.observedState === "string" &&
    typeof note.at === "number"
  );
}

function isRound(value: unknown): value is FiledRound {
  if (typeof value !== "object" || value === null) return false;
  const round = value as Record<string, unknown>;
  return typeof round.at === "number" && typeof round.title === "string" && Array.isArray(round.items);
}

export function loadLog(seed: string): OperatorLog {
  const store = storage();
  if (!store) return EMPTY_LOG;
  try {
    const raw = store.getItem(storageKey(seed));
    if (!raw) return EMPTY_LOG;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return EMPTY_LOG;
    const log = parsed as Record<string, unknown>;
    if (log.schema !== SCHEMA || !Array.isArray(log.answers)) return EMPTY_LOG;
    return {
      schema: SCHEMA,
      answers: log.answers.filter(isAnswer),
      notes: Array.isArray(log.notes) ? log.notes.filter(isNote) : [],
      rounds: Array.isArray(log.rounds) ? log.rounds.filter(isRound) : [],
    };
  } catch {
    return EMPTY_LOG;
  }
}

export function saveLog(seed: string, log: OperatorLog): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(storageKey(seed), JSON.stringify(log));
  } catch {
    // Full, or refused. The round continues without persistence.
  }
}

/**
 * Records an answer, replacing any previous answer to the same prompt.
 *
 * Changing your mind is normal and must not leave two contradictory answers in
 * the log. Answering a branching question differently also invalidates whatever
 * followed the old branch, which the caller clears forward.
 */
export function recordAnswer(log: OperatorLog, answer: Answer): OperatorLog {
  return {
    ...log,
    answers: [...log.answers.filter((entry) => entry.promptId !== answer.promptId), answer],
  };
}

export function clearAnswer(log: OperatorLog, promptId: string): OperatorLog {
  return { ...log, answers: log.answers.filter((entry) => entry.promptId !== promptId) };
}

/** Start this district's activity again. Its note is the operator's, and stays. */
export function clearDistrict(log: OperatorLog, districtId: DistrictId): OperatorLog {
  return { ...log, answers: log.answers.filter((entry) => entry.districtId !== districtId) };
}

export function writeNote(log: OperatorLog, note: DistrictNote): OperatorLog {
  const text = note.text.slice(0, NOTE_LIMIT);
  const rest = log.notes.filter((entry) => entry.districtId !== note.districtId);
  return { ...log, notes: text.trim() === "" ? rest : [...rest, { ...note, text }] };
}

export function noteFor(log: OperatorLog, districtId: DistrictId): DistrictNote | null {
  return log.notes.find((entry) => entry.districtId === districtId) ?? null;
}

/**
 * File the finished round and clear the desk for the next one.
 *
 * The whole point of this existing is that "start another round" and "throw
 * away what I just did" are different intentions, and the interface used to
 * offer only the second one.
 */
export function fileRound(log: OperatorLog, round: FiledRound): OperatorLog {
  return {
    ...log,
    answers: [],
    notes: [],
    rounds: [round, ...log.rounds].slice(0, ROUNDS_KEPT),
  };
}

/** Throw away the round in progress. Filed rounds are not touched. */
export function clearWorking(log: OperatorLog): OperatorLog {
  return { ...log, answers: [], notes: [] };
}

export function answersForDistrict(log: OperatorLog, districtId: DistrictId): AnswerSet {
  return log.answers.filter((entry) => entry.districtId === districtId);
}
