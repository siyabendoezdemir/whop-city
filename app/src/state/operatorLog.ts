/**
 * The operator's own review log.
 *
 * Local to this browser and nothing else. Marking a move reviewed records that
 * *you said you looked at it*; it does not perform the move, does not tell Whop
 * anything, and is not read back from anywhere. The interface says so wherever
 * it shows this state, and this module is deliberately the only thing that
 * writes it, so there is one place to check that claim against.
 *
 * What is stored: a district id, a move id, the state the district was in when
 * you reviewed it, and the time you clicked. That is all. No projection, no
 * business data, and nothing derived from either — the recorded state is one of
 * four public words, which the browser was already holding.
 *
 * The log is keyed by the projection's opaque seed, so two businesses opened in
 * the same browser keep separate logs and neither can read the other's.
 */

import type { DistrictId, DistrictState } from "../city/projection";

const STORAGE_PREFIX = "whop-city.review.v1";

/** Bumped if the shape below changes; older payloads are dropped, not migrated. */
const SCHEMA = 1;

export type ReviewEntry = {
  readonly moveId: string;
  readonly districtId: DistrictId;
  /** The public state word the district showed when this was marked. */
  readonly stateAtReview: DistrictState;
  /** Local clock, from this browser. Never sent anywhere. */
  readonly reviewedAt: number;
};

export type ReviewLog = {
  readonly schema: number;
  readonly entries: readonly ReviewEntry[];
};

export const EMPTY_LOG: ReviewLog = { schema: SCHEMA, entries: [] };

function storageKey(seed: string): string {
  return `${STORAGE_PREFIX}:${seed}`;
}

/**
 * Storage that cannot throw.
 *
 * Private browsing, disabled storage and quota errors all end the same way: the
 * log is empty and the session still works. A review log is a convenience, and
 * losing it must never take the city down with it.
 */
function storage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function isEntry(value: unknown): value is ReviewEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.moveId === "string" &&
    typeof entry.districtId === "string" &&
    typeof entry.stateAtReview === "string" &&
    typeof entry.reviewedAt === "number"
  );
}

export function loadLog(seed: string): ReviewLog {
  const store = storage();
  if (!store) return EMPTY_LOG;
  try {
    const raw = store.getItem(storageKey(seed));
    if (!raw) return EMPTY_LOG;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return EMPTY_LOG;
    const log = parsed as Record<string, unknown>;
    if (log.schema !== SCHEMA || !Array.isArray(log.entries)) return EMPTY_LOG;
    return { schema: SCHEMA, entries: log.entries.filter(isEntry) };
  } catch {
    return EMPTY_LOG;
  }
}

export function saveLog(seed: string, log: ReviewLog): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(storageKey(seed), JSON.stringify(log));
  } catch {
    // Full, or refused. The session continues without persistence.
  }
}

export function isReviewed(log: ReviewLog, moveId: string): boolean {
  return log.entries.some((entry) => entry.moveId === moveId);
}

export function entryFor(log: ReviewLog, moveId: string): ReviewEntry | null {
  return log.entries.find((entry) => entry.moveId === moveId) ?? null;
}

export function markReviewed(
  log: ReviewLog,
  entry: Omit<ReviewEntry, "reviewedAt">,
  now: number = Date.now(),
): ReviewLog {
  if (isReviewed(log, entry.moveId)) return log;
  return { schema: SCHEMA, entries: [...log.entries, { ...entry, reviewedAt: now }] };
}

export function clearReviewed(log: ReviewLog, moveId: string): ReviewLog {
  if (!isReviewed(log, moveId)) return log;
  return { schema: SCHEMA, entries: log.entries.filter((entry) => entry.moveId !== moveId) };
}

export function clearDistrict(log: ReviewLog, districtId: DistrictId): ReviewLog {
  return { schema: SCHEMA, entries: log.entries.filter((entry) => entry.districtId !== districtId) };
}

/**
 * Whether the district has moved on since it was reviewed.
 *
 * The honest half of the loop. City can see that a district it was reviewed in
 * one state is now in another; it cannot see why, and it does not claim the
 * review caused it. All this reports is that the ground has shifted and the
 * briefing is worth reading again.
 */
export function hasChangedSinceReview(
  log: ReviewLog,
  districtId: DistrictId,
  currentState: DistrictState,
): boolean {
  const reviewed = log.entries.filter((entry) => entry.districtId === districtId);
  if (reviewed.length === 0) return false;
  return reviewed.some((entry) => entry.stateAtReview !== currentState);
}

/** Progress through one district's moves. Counts clicks, not business facts. */
export function districtProgress(
  log: ReviewLog,
  moveIds: readonly string[],
): { reviewed: number; total: number; complete: boolean } {
  const reviewed = moveIds.filter((moveId) => isReviewed(log, moveId)).length;
  return { reviewed, total: moveIds.length, complete: moveIds.length > 0 && reviewed === moveIds.length };
}
