import { describe, expect, it } from "vitest";

import {
  DISTRICT_ROLE,
  UNREADABLE_BRIEFING,
  briefingFor,
  briefingForOrUnreadable,
} from "../src/city/playbook";
import {
  DISTRICT_IDS,
  DISTRICT_STATES,
  type DistrictState,
  type PublicDistrict,
} from "../src/city/projection";

const district = (
  id: (typeof DISTRICT_IDS)[number],
  state: DistrictState,
  over: Partial<PublicDistrict> = {},
): PublicDistrict => ({ id, state, direction: "steady", signal: "busy", parcels: 3, variant: 0, ...over });

/** Every briefing in the book, flattened. */
const everyBriefing = DISTRICT_IDS.flatMap((id) =>
  DISTRICT_STATES.map((state) => ({ id, state, briefing: briefingFor(district(id, state)) })),
);

describe("the playbook covers the city", () => {
  it("has a briefing for every district in every state", () => {
    expect(everyBriefing).toHaveLength(DISTRICT_IDS.length * DISTRICT_STATES.length);
    for (const { id, state, briefing } of everyBriefing) {
      expect(briefing.reading, `${id}/${state} reading`).toBeTruthy();
      expect(briefing.stake, `${id}/${state} stake`).toBeTruthy();
      expect(briefing.moves.length, `${id}/${state} moves`).toBeGreaterThan(0);
    }
  });

  it("gives every move a unique, stable id", () => {
    const ids = everyBriefing.flatMap(({ briefing }) => briefing.moves.map((move) => move.id));
    // The review log keys on these and persists across sessions, so a collision
    // would silently tick a move in another district.
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z]+\.[a-z]+\.[a-z-]+$/);
  });

  it("names the role of each district without describing any business", () => {
    for (const id of DISTRICT_IDS) {
      expect(DISTRICT_ROLE[id]).toBeTruthy();
      expect(DISTRICT_ROLE[id]).not.toMatch(/\d/);
    }
  });
});

describe("the playbook does not invent business facts", () => {
  const allCopy = everyBriefing
    .flatMap(({ briefing }) => [
      briefing.reading,
      briefing.stake,
      ...briefing.moves.flatMap((move) => [move.title, move.detail]),
    ])
    .concat(UNREADABLE_BRIEFING.reading, UNREADABLE_BRIEFING.stake);

  it("contains no numbers anywhere", () => {
    // A number in this file could only be one of two things: a metric City
    // cannot see, or a fake precision. Neither belongs here.
    for (const copy of allCopy) {
      expect(copy, `"${copy}" carries a digit`).not.toMatch(/\d/);
    }
  });

  it("quotes no money, no counts and no customer", () => {
    for (const copy of allCopy) {
      expect(copy).not.toMatch(/[$£€%]/);
      expect(copy.toLowerCase()).not.toMatch(
        /\brevenue\b|\bearnings\b|\bmrr\b|\bsubscribers\b|\bcustomers?\b|\bmembers count\b/,
      );
    }
  });

  it("never asserts what the business's data is", () => {
    // The line the whole file walks: a move may tell an operator where to look.
    // It may not tell them what they will find, because City has not seen it.
    const asserting =
      /\byour (products?|plans?|prices?|affiliates?|store) (is|are) (hidden|visible|broken|disabled|enabled|empty)\b/i;
    for (const copy of allCopy) {
      expect(copy, `"${copy}" asserts a fact about the business`).not.toMatch(asserting);
    }
  });

  it("phrases every move as something the operator does", () => {
    // Imperative, and about their own console rather than about City's opinion.
    for (const { briefing } of everyBriefing) {
      for (const move of briefing.moves) {
        expect(move.title).toMatch(/^[A-Z]/);
        expect(move.detail.length).toBeGreaterThan(40);
      }
    }
  });
});

describe("an unreadable district", () => {
  it("gets no moves at all", () => {
    const unreadable = district("commerce-core", "dormant", { signal: "unreadable" });
    const briefing = briefingForOrUnreadable(unreadable);
    expect(briefing).toBe(UNREADABLE_BRIEFING);
    expect(briefing.moves).toHaveLength(0);
  });

  it("gets its normal briefing again once the reading works", () => {
    const readable = district("commerce-core", "struggling", { signal: "quiet" });
    expect(briefingForOrUnreadable(readable).moves.length).toBeGreaterThan(0);
  });
});
