/**
 * The operator's own log.
 *
 * Local to this browser and nothing else. Recording an answer records that
 * *you said something*; it does not perform the work, does not tell Whop
 * anything, and is not read back from anywhere. The interface says so at the
 * point of the click, and this module is deliberately the only thing that
 * writes it, so there is one place to check that claim against.
 *
 * What is stored, per answer: an activity id, a prompt id, a district id, the
 * answer value, the public state word the district showed at the time, and a
 * local clock reading. That is all. No projection, no business data, and
 * nothing derived from either — the recorded state is one of four public words
 * the browser was already holding, and it is kept so the city can tell later
 * that an answer was given under a reading that no longer applies.
 *
 * Keyed by the projection's opaque seed, so two businesses opened in the same
 * browser keep separate logs and neither can read the other's.
 */

import type { DistrictId } from "../city/projection";
import type { Answer, AnswerSet } from "../city/session";

const STORAGE_PREFIX = "whop-city.log.v2";

/** Bumped if the shape below changes; older payloads are dropped, not migrated. */
const SCHEMA = 2;

export type OperatorLog = {
  readonly schema: number;
  readonly answers: AnswerSet;
  /** Sessions the operator has finished. Local count, for the return loop. */
  readonly sessionsCompleted: number;
};

export const EMPTY_LOG: OperatorLog = { schema: SCHEMA, answers: [], sessionsCompleted: 0 };

function storageKey(seed: string): string {
  return `${STORAGE_PREFIX}:${seed}`;
}

/**
 * Storage that cannot throw.
 *
 * Private browsing, disabled storage and quota errors all end the same way: the
 * log is empty and the session still works. A log is a convenience, and losing
 * it must never take the city down with it.
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
      sessionsCompleted:
        typeof log.sessionsCompleted === "number" && log.sessionsCompleted >= 0
          ? Math.floor(log.sessionsCompleted)
          : 0,
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
    // Full, or refused. The session continues without persistence.
  }
}

/**
 * Records an answer, replacing any previous answer to the same prompt.
 *
 * Changing your mind is normal and must not leave two contradictory answers in
 * the log. Answering a `choice` differently also invalidates everything that
 * followed the old branch, which is handled by the caller clearing forward.
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

/** Start this district's activity again. Undo, at the granularity that matters. */
export function clearDistrict(log: OperatorLog, districtId: DistrictId): OperatorLog {
  return { ...log, answers: log.answers.filter((entry) => entry.districtId !== districtId) };
}

export function clearAll(log: OperatorLog): OperatorLog {
  return { ...log, answers: [] };
}

export function completeSession(log: OperatorLog): OperatorLog {
  return { ...log, sessionsCompleted: log.sessionsCompleted + 1 };
}

export function answersForDistrict(log: OperatorLog, districtId: DistrictId): AnswerSet {
  return log.answers.filter((entry) => entry.districtId === districtId);
}
