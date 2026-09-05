import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Answer } from "../src/city/session";
import {
  EMPTY_LOG,
  NOTE_LIMIT,
  ROUNDS_KEPT,
  answersForDistrict,
  clearAnswer,
  clearDistrict,
  clearWorking,
  fileRound,
  loadLog,
  noteFor,
  recordAnswer,
  saveLog,
  writeNote,
  type FiledRound,
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

  it("undoes one answer, or one district", () => {
    let log = recordAnswer(EMPTY_LOG, answer({ promptId: "visible" }));
    log = recordAnswer(log, answer({ promptId: "members" }));
    log = recordAnswer(log, answer({ promptId: "typed", districtId: "offer-forge" }));

    expect(clearAnswer(log, "visible").answers).toHaveLength(2);
    expect(clearDistrict(log, "commerce-core").answers).toHaveLength(1);
  });

  it("survives a round trip through storage", () => {
    let log = recordAnswer(EMPTY_LOG, answer());
    log = writeNote(log, {
      districtId: "commerce-core",
      text: "check the pricing page",
      observedState: "struggling",
      at: 1,
    });
    saveLog(SEED_A, log);
    const loaded = loadLog(SEED_A);
    expect(loaded.answers).toEqual(log.answers);
    expect(loaded.notes).toEqual(log.notes);
  });

  it("keeps two businesses apart in the same browser", () => {
    saveLog(SEED_A, recordAnswer(EMPTY_LOG, answer()));
    expect(loadLog(SEED_A).answers).toHaveLength(1);
    expect(loadLog(SEED_B).answers).toHaveLength(0);
  });

  it("stores nothing but the answer, the prompt, a public state word and a local clock", () => {
    saveLog(SEED_A, recordAnswer(EMPTY_LOG, answer()));
    const stored = JSON.parse(localStorage.getItem(`whop-city.log.v3:${SEED_A}`) ?? "");
    expect(Object.keys(stored).sort()).toEqual(["answers", "notes", "rounds", "schema"]);
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
    localStorage.setItem(`whop-city.log.v3:${SEED_A}`, "{not json");
    expect(loadLog(SEED_A)).toEqual(EMPTY_LOG);
  });

  it("ignores a payload from another schema, including the one before this", () => {
    localStorage.setItem(
      `whop-city.log.v3:${SEED_A}`,
      JSON.stringify({ schema: 2, answers: [answer()] }),
    );
    expect(loadLog(SEED_A).answers).toHaveLength(0);
  });

  it("drops malformed answers but keeps good ones", () => {
    localStorage.setItem(
      `whop-city.log.v3:${SEED_A}`,
      JSON.stringify({ schema: 3, answers: [answer(), { promptId: 7 }, null], notes: [7], rounds: "x" }),
    );
    const log = loadLog(SEED_A);
    expect(log.answers).toHaveLength(1);
    expect(log.notes).toHaveLength(0);
    expect(log.rounds).toHaveLength(0);
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

describe("the operator's own line", () => {
  it("keeps one note per district, and removes it when emptied", () => {
    let log = writeNote(EMPTY_LOG, {
      districtId: "commerce-core",
      text: "ask about the hidden plan",
      observedState: "struggling",
      at: 1,
    });
    expect(noteFor(log, "commerce-core")?.text).toBe("ask about the hidden plan");

    log = writeNote(log, { districtId: "commerce-core", text: "replaced", observedState: "struggling", at: 2 });
    expect(log.notes).toHaveLength(1);
    expect(noteFor(log, "commerce-core")?.text).toBe("replaced");

    log = writeNote(log, { districtId: "commerce-core", text: "   ", observedState: "struggling", at: 3 });
    expect(log.notes).toHaveLength(0);
  });

  it("is bounded, so it cannot become a document", () => {
    const log = writeNote(EMPTY_LOG, {
      districtId: "offer-forge",
      text: "x".repeat(NOTE_LIMIT + 500),
      observedState: "healthy",
      at: 1,
    });
    expect(noteFor(log, "offer-forge")!.text).toHaveLength(NOTE_LIMIT);
  });
});

describe("finishing a round is not the same as throwing it away", () => {
  const round = (at: number): FiledRound => ({
    at,
    title: "A maintenance round",
    items: [
      {
        districtId: "commerce-core",
        districtName: "Commerce Core",
        condition: "Steady",
        kind: "action",
        text: "Fix the path",
      },
    ],
  });

  it("files the round, clears the desk, and keeps what was filed", () => {
    let log = recordAnswer(EMPTY_LOG, answer());
    log = writeNote(log, { districtId: "commerce-core", text: "note", observedState: "struggling", at: 1 });

    const filed = fileRound(log, round(1_000));
    expect(filed.answers).toHaveLength(0);
    expect(filed.notes).toHaveLength(0);
    expect(filed.rounds).toHaveLength(1);
    expect(filed.rounds[0].items[0].condition).toBe("Steady");
  });

  it("discarding the round in progress leaves filed rounds alone", () => {
    let log = fileRound(EMPTY_LOG, round(1_000));
    log = recordAnswer(log, answer());
    const cleared = clearWorking(log);
    expect(cleared.answers).toHaveLength(0);
    expect(cleared.rounds).toHaveLength(1);
  });

  it("keeps the newest rounds and drops the oldest", () => {
    let log = EMPTY_LOG;
    for (let i = 0; i < ROUNDS_KEPT + 3; i++) log = fileRound(log, round(i));
    expect(log.rounds).toHaveLength(ROUNDS_KEPT);
    // Newest first, and the earliest ones are gone rather than growing forever.
    expect(log.rounds[0].at).toBe(ROUNDS_KEPT + 2);
  });

  it("survives storage", () => {
    saveLog(SEED_A, fileRound(EMPTY_LOG, round(1_000)));
    expect(loadLog(SEED_A).rounds).toHaveLength(1);
  });
});
