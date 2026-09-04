import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Answer } from "../src/city/session";
import {
  EMPTY_LOG,
  answersForDistrict,
  clearAll,
  clearAnswer,
  clearDistrict,
  completeSession,
  loadLog,
  recordAnswer,
  saveLog,
} from "../src/state/operatorLog";

const SEED_A = "a7f3c1e90b6d84fa";
const SEED_B = "0f1e2d3c4b5a6978";

const answer = (over: Partial<Answer> = {}): Answer => ({
  activityId: "commerce.mixed",
  promptId: "visible",
  districtId: "commerce-core",
  value: "confirmed",
  observedState: "struggling",
  at: 1_780_000_000_000,
  ...over,
});

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

describe("the operator log", () => {
  it("records an answer", () => {
    const log = recordAnswer(EMPTY_LOG, answer());
    expect(log.answers).toHaveLength(1);
    expect(answersForDistrict(log, "commerce-core")).toHaveLength(1);
    expect(answersForDistrict(log, "offer-forge")).toHaveLength(0);
  });

  it("replaces rather than duplicates when the operator changes their mind", () => {
    let log = recordAnswer(EMPTY_LOG, answer({ value: "confirmed" }));
    log = recordAnswer(log, answer({ value: "problem" }));
    expect(log.answers).toHaveLength(1);
    expect(log.answers[0].value).toBe("problem");
  });

  it("undoes one answer, a district, or everything", () => {
    let log = recordAnswer(EMPTY_LOG, answer({ promptId: "visible" }));
    log = recordAnswer(log, answer({ promptId: "members" }));
    log = recordAnswer(log, answer({ promptId: "typed", districtId: "offer-forge" }));

    expect(clearAnswer(log, "visible").answers).toHaveLength(2);
    expect(clearDistrict(log, "commerce-core").answers).toHaveLength(1);
    expect(clearAll(log).answers).toHaveLength(0);
    // Undoing answers does not undo the fact that sessions were finished.
    expect(clearAll(completeSession(log)).sessionsCompleted).toBe(1);
  });

  it("survives a round trip through storage", () => {
    const log = completeSession(recordAnswer(EMPTY_LOG, answer()));
    saveLog(SEED_A, log);
    const loaded = loadLog(SEED_A);
    expect(loaded.answers).toEqual(log.answers);
    expect(loaded.sessionsCompleted).toBe(1);
  });

  it("keeps two businesses apart in the same browser", () => {
    saveLog(SEED_A, recordAnswer(EMPTY_LOG, answer()));
    expect(loadLog(SEED_A).answers).toHaveLength(1);
    expect(loadLog(SEED_B).answers).toHaveLength(0);
  });

  it("stores nothing but the answer, the prompt, a public state word and a local clock", () => {
    saveLog(SEED_A, recordAnswer(EMPTY_LOG, answer()));
    const stored = JSON.parse(localStorage.getItem(`whop-city.log.v2:${SEED_A}`) ?? "");
    expect(Object.keys(stored).sort()).toEqual(["answers", "schema", "sessionsCompleted"]);
    expect(Object.keys(stored.answers[0]).sort()).toEqual([
      "activityId",
      "at",
      "districtId",
      "observedState",
      "promptId",
      "value",
    ]);
  });
});

describe("the log refuses to trust storage", () => {
  it("ignores a corrupt payload", () => {
    localStorage.setItem(`whop-city.log.v2:${SEED_A}`, "{not json");
    expect(loadLog(SEED_A)).toEqual(EMPTY_LOG);
  });

  it("ignores a payload from another schema, including the one before this", () => {
    localStorage.setItem(
      `whop-city.log.v2:${SEED_A}`,
      JSON.stringify({ schema: 1, entries: [{ moveId: "x" }] }),
    );
    expect(loadLog(SEED_A).answers).toHaveLength(0);
  });

  it("drops malformed answers but keeps good ones", () => {
    localStorage.setItem(
      `whop-city.log.v2:${SEED_A}`,
      JSON.stringify({ schema: 2, answers: [answer(), { promptId: 7 }, null], sessionsCompleted: -3 }),
    );
    const log = loadLog(SEED_A);
    expect(log.answers).toHaveLength(1);
    expect(log.sessionsCompleted).toBe(0);
  });

  it("works when storage is unavailable or refuses to write", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => saveLog(SEED_A, EMPTY_LOG)).not.toThrow();
    expect(loadLog(SEED_A)).toEqual(EMPTY_LOG);

    const throwing = memoryStorage();
    throwing.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    vi.stubGlobal("localStorage", throwing);
    expect(() => saveLog(SEED_A, EMPTY_LOG)).not.toThrow();
  });
});
