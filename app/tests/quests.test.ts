import { describe, expect, it } from "vitest";

import { DISTRICT_IDS, ZERO_METRICS, type CityMetrics } from "../src/city/projection";
import { RESOURCES } from "../src/game/buildings";
import {
  QUESTS,
  STAGES,
  cityQuest,
  completedQuests,
  questFor,
  questsIn,
  readingFor,
  stageOf,
} from "../src/game/quests";

/**
 * The board's job is to be right about what is in the way, and never to ask
 * for something the business has already done. Both are testable; the quality
 * of the advice is not, so what is asserted here is the routing and the
 * honesty rather than the wording.
 */

const at = (over: Partial<CityMetrics> = {}): CityMetrics => ({ ...ZERO_METRICS, source: "owner", ...over });

/** A business at every plausible size and shape, for the sweeps below. */
function everyShape(): CityMetrics[] {
  const shapes: CityMetrics[] = [];
  for (const citizens of [0, 1, 12, 40, 900, 40_000]) {
    for (const traffic of [0, 5, 400, 9_000]) {
      for (const gold of [0, 900, 250_000]) {
        for (const recurring of [0, 900, 90_000]) {
          for (const churn of [0, 25]) {
            for (const refunds of [0, 20]) {
              shapes.push(at({ citizens, traffic, gold, recurring, churn, refunds, goldBefore: gold }));
            }
          }
        }
      }
    }
  }
  return shapes;
}

describe("stages", () => {
  it("reads the size of the business off the one number that scales", () => {
    expect(stageOf(at())).toBe("founding");
    expect(stageOf(at({ traffic: 20 }))).toBe("opening");
    expect(stageOf(at({ citizens: 1 }))).toBe("first-sales");
    expect(stageOf(at({ citizens: 10 }))).toBe("traction");
    expect(stageOf(at({ citizens: 100 }))).toBe("growth");
    expect(stageOf(at({ citizens: 5000 }))).toBe("scale");
  });

  it("names every stage it can reach", () => {
    for (const stage of STAGES) expect(STAGES).toContain(stage);
  });
});

describe("every district has its own board", () => {
  it("gives each district quests of its own, and only its own", () => {
    for (const district of DISTRICT_IDS) {
      const board = questsIn(district);
      expect(board.length, district).toBeGreaterThanOrEqual(4);
      for (const quest of board) expect(quest.district, quest.id).toBe(district);
    }
  });

  it("always has something to say, whatever the business looks like", () => {
    // A district that runs out of advice is a dead end, and a dead end in a
    // game somebody comes back to weekly is the whole failure.
    for (const metrics of everyShape()) {
      for (const district of DISTRICT_IDS) {
        expect(questFor(district, metrics), `${district} @ ${JSON.stringify(metrics)}`).not.toBeNull();
      }
    }
  });

  it("never asks for something the business has already done", () => {
    for (const metrics of everyShape()) {
      for (const district of DISTRICT_IDS) {
        const quest = questFor(district, metrics)!;
        if (quest.standing) continue;
        expect(quest.done(metrics), `${quest.id} was already done`).toBe(false);
      }
    }
  });

  it("puts a problem ahead of a milestone in the same district", () => {
    // A quarter losing a quarter of its members every month does not need a
    // traffic target; it needs the hole fixed.
    const leaking = at({ citizens: 400, traffic: 900, churn: 30 });
    expect(questFor("creator-quarter", leaking)!.id).toBe("quarter-churn");

    const refunding = at({ gold: 20_000, goldBefore: 19_000, citizens: 400, refunds: 22 });
    expect(questFor("commerce-core", refunding)!.id).toBe("core-refunds");
  });

  it("moves on once the problem is fixed", () => {
    const fixed = at({ citizens: 400, traffic: 900, churn: 2 });
    expect(questFor("creator-quarter", fixed)!.id).not.toBe("quarter-churn");
  });
});

describe("the one thing to do next", () => {
  it("is an urgent quest wherever it is", () => {
    const leaking = at({ gold: 9_000, goldBefore: 8_000, citizens: 400, traffic: 900, churn: 30 });
    expect(cityQuest(leaking)!.urgent).toBe(true);
  });

  it("otherwise picks the district furthest behind", () => {
    // Revenue and audience are healthy, nothing recurs. The forge is the one
    // that has not started, so the forge is what to do next.
    const noRecurring = at({ gold: 30_000, goldBefore: 25_000, citizens: 300, traffic: 900, recurring: 0 });
    expect(cityQuest(noRecurring)!.district).toBe("offer-forge");
  });

  it("has an answer for a business at every size", () => {
    for (const metrics of everyShape()) expect(cityQuest(metrics)).not.toBeNull();
  });
});

describe("honesty", () => {
  it("finishes itself when the number moves, with nothing to tick", () => {
    const hundred = QUESTS.find((quest) => quest.id === "quarter-first-hundred")!;
    const before = at({ traffic: 10 });
    expect(hundred.done(before)).toBe(false);
    expect(hundred.progress(before)).toBeCloseTo(0.1, 1);

    const after = at({ traffic: 140 });
    expect(hundred.done(after)).toBe(true);
    expect(hundred.progress(after)).toBe(1);
  });

  it("either finishes on a number or admits it has no finish line", () => {
    // A bar stuck at nought forever is worse than saying so. Anything that
    // cannot be measured has to declare itself a standing practice.
    const enormous = at({
      gold: 9e6,
      goldBefore: 1,
      citizens: 9e6,
      traffic: 9e6,
      recurring: 9e6,
    });
    const impossible = QUESTS.filter((quest) => !quest.done(enormous) && !quest.standing);
    expect(impossible.map((quest) => quest.id)).toEqual([]);
  });

  it("reports what is already true rather than hiding it", () => {
    const done = completedQuests(at({ citizens: 5, gold: 500, traffic: 400 }));
    expect(done.map((quest) => quest.id)).toContain("quarter-first-member");
    expect(done.map((quest) => quest.id)).toContain("core-open");
  });

  it("gives concrete ways to do every one of them", () => {
    for (const quest of QUESTS) {
      expect(quest.how.length, quest.id).toBeGreaterThanOrEqual(3);
      expect(RESOURCES).toContain(quest.resource);
      for (const step of quest.how) {
        // An instruction, not a topic: long enough to act on, short enough to
        // read on a card.
        expect(step.length, `${quest.id}: "${step}"`).toBeGreaterThan(30);
        expect(step.length, `${quest.id}: "${step}"`).toBeLessThan(140);
      }
    }
  });

  it("keeps the advice general enough for any business on the platform", () => {
    // The trap this is guarding: advice that only makes sense for one kind of
    // business, which is noise to everyone else running something different.
    const tooSpecific =
      /cold email|newsletter|discord|youtube|tiktok|instagram|webinar|dropship|course|coaching|saas|trading/i;
    for (const quest of QUESTS) {
      expect(quest.title, quest.id).not.toMatch(tooSpecific);
      expect(quest.why, quest.id).not.toMatch(tooSpecific);
      for (const step of quest.how) expect(step, quest.id).not.toMatch(tooSpecific);
    }
  });

  it("promises nothing it cannot see", () => {
    // No quest may claim an outcome; each is a thing to do, measured by a
    // number the board can actually read afterwards.
    for (const quest of QUESTS) {
      expect(quest.why, quest.id).not.toMatch(/will (double|triple|guarantee)|guaranteed|\d+% more/i);
    }
  });

  it("has a unique id for every quest", () => {
    const ids = QUESTS.map((quest) => quest.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the district reading", () => {
  it("says nothing is selling when nothing is", () => {
    expect(readingFor("commerce-core", at()).line).toMatch(/nothing has sold/i);
    expect(readingFor("commerce-core", at()).tone).toBe("flat");
  });

  it("calls out a fall rather than smoothing it over", () => {
    const fell = readingFor("commerce-core", at({ gold: 1_000, goldBefore: 5_000 }));
    expect(fell.tone).toBe("bad");
  });

  it("calls out refunds ahead of the headline", () => {
    const refunding = readingFor("commerce-core", at({ gold: 5_000, goldBefore: 1_000, refunds: 30 }));
    expect(refunding.tone).toBe("bad");
    expect(refunding.line).toMatch(/refund/i);
  });

  it("has a line for every district in every shape", () => {
    for (const metrics of everyShape()) {
      for (const district of DISTRICT_IDS) {
        const reading = readingFor(district, metrics);
        expect(reading.line.length, district).toBeGreaterThan(4);
        expect(["bad", "flat", "good"]).toContain(reading.tone);
      }
    }
  });
});
