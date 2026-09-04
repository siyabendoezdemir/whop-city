import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EMPTY_LOG,
  clearDistrict,
  clearReviewed,
  districtProgress,
  entryFor,
  hasChangedSinceReview,
  isReviewed,
  loadLog,
  markReviewed,
  saveLog,
} from "../src/state/operatorLog";

const SEED_A = "a7f3c1e90b6d84fa";
const SEED_B = "0f1e2d3c4b5a6978";

/** A localStorage that behaves, so the semantics are under test and not jsdom. */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  } as Storage;
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the review log", () => {
  it("starts empty and records a mark", () => {
    let log = loadLog(SEED_A);
    expect(log.entries).toHaveLength(0);

    log = markReviewed(log, {
      moveId: "core.struggling.visibility",
      districtId: "commerce-core",
      stateAtReview: "struggling",
    });

    expect(isReviewed(log, "core.struggling.visibility")).toBe(true);
    expect(entryFor(log, "core.struggling.visibility")?.districtId).toBe("commerce-core");
  });

  it("is idempotent: marking twice does not double up", () => {
    const entry = {
      moveId: "core.struggling.visibility",
      districtId: "commerce-core" as const,
      stateAtReview: "struggling" as const,
    };
    const once = markReviewed(EMPTY_LOG, entry);
    const twice = markReviewed(once, entry);
    expect(twice).toBe(once);
    expect(twice.entries).toHaveLength(1);
  });

  it("unmarks, and clears a whole district", () => {
    let log = markReviewed(EMPTY_LOG, {
      moveId: "a.b.one",
      districtId: "offer-forge",
      stateAtReview: "struggling",
    });
    log = markReviewed(log, {
      moveId: "a.b.two",
      districtId: "offer-forge",
      stateAtReview: "struggling",
    });

    expect(clearReviewed(log, "a.b.one").entries).toHaveLength(1);
    expect(clearDistrict(log, "offer-forge").entries).toHaveLength(0);
    expect(clearDistrict(log, "commerce-core").entries).toHaveLength(2);
  });

  it("survives a round trip through storage", () => {
    const log = markReviewed(EMPTY_LOG, {
      moveId: "a.b.one",
      districtId: "offer-forge",
      stateAtReview: "dormant",
    });
    saveLog(SEED_A, log);
    expect(loadLog(SEED_A).entries).toEqual(log.entries);
  });

  it("keeps two businesses apart in the same browser", () => {
    saveLog(
      SEED_A,
      markReviewed(EMPTY_LOG, {
        moveId: "a.b.one",
        districtId: "offer-forge",
        stateAtReview: "dormant",
      }),
    );
    expect(loadLog(SEED_A).entries).toHaveLength(1);
    expect(loadLog(SEED_B).entries).toHaveLength(0);
  });

  it("stores nothing but the move, the district, a public state word and a local clock", () => {
    saveLog(
      SEED_A,
      markReviewed(EMPTY_LOG, {
        moveId: "a.b.one",
        districtId: "offer-forge",
        stateAtReview: "dormant",
      }),
    );
    const raw = localStorage.getItem(`whop-city.review.v1:${SEED_A}`) ?? "";
    const stored = JSON.parse(raw);
    expect(Object.keys(stored).sort()).toEqual(["entries", "schema"]);
    expect(Object.keys(stored.entries[0]).sort()).toEqual([
      "districtId",
      "moveId",
      "reviewedAt",
      "stateAtReview",
    ]);
  });
});

describe("the review log refuses to trust storage", () => {
  it("ignores a corrupt payload", () => {
    localStorage.setItem(`whop-city.review.v1:${SEED_A}`, "{not json");
    expect(loadLog(SEED_A).entries).toHaveLength(0);
  });

  it("ignores a payload from another schema", () => {
    localStorage.setItem(
      `whop-city.review.v1:${SEED_A}`,
      JSON.stringify({ schema: 99, entries: [{ moveId: "x" }] }),
    );
    expect(loadLog(SEED_A).entries).toHaveLength(0);
  });

  it("drops malformed entries but keeps good ones", () => {
    localStorage.setItem(
      `whop-city.review.v1:${SEED_A}`,
      JSON.stringify({
        schema: 1,
        entries: [
          { moveId: "a.b.one", districtId: "offer-forge", stateAtReview: "dormant", reviewedAt: 1 },
          { moveId: 7 },
          null,
        ],
      }),
    );
    expect(loadLog(SEED_A).entries).toHaveLength(1);
  });

  it("works when storage is unavailable entirely", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => saveLog(SEED_A, EMPTY_LOG)).not.toThrow();
    expect(loadLog(SEED_A).entries).toHaveLength(0);
  });

  it("works when storage refuses to write", () => {
    const throwing = memoryStorage();
    throwing.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    vi.stubGlobal("localStorage", throwing);
    expect(() => saveLog(SEED_A, EMPTY_LOG)).not.toThrow();
  });
});

describe("progression", () => {
  const moves = ["a.b.one", "a.b.two", "a.b.three"];

  it("counts clicks toward completion", () => {
    let log = EMPTY_LOG;
    expect(districtProgress(log, moves)).toEqual({ reviewed: 0, total: 3, complete: false });

    for (const moveId of moves) {
      log = markReviewed(log, { moveId, districtId: "commerce-core", stateAtReview: "struggling" });
    }
    expect(districtProgress(log, moves)).toEqual({ reviewed: 3, total: 3, complete: true });
  });

  it("is never complete when there is nothing to do", () => {
    // An unreadable district has no moves, and must not read as resolved.
    expect(districtProgress(EMPTY_LOG, [])).toEqual({ reviewed: 0, total: 0, complete: false });
  });

  it("notices when a district reads differently than when it was reviewed", () => {
    const log = markReviewed(EMPTY_LOG, {
      moveId: "a.b.one",
      districtId: "commerce-core",
      stateAtReview: "struggling",
    });

    expect(hasChangedSinceReview(log, "commerce-core", "struggling")).toBe(false);
    expect(hasChangedSinceReview(log, "commerce-core", "healthy")).toBe(true);
    // A district that was never reviewed has not changed since a review.
    expect(hasChangedSinceReview(log, "offer-forge", "healthy")).toBe(false);
  });
});
