import { describe, expect, it } from "vitest";

import { ZERO_METRICS, type CityMetrics } from "../src/city/projection";
import { RESOURCES } from "../src/game/buildings";
import {
  BOTTLENECKS,
  MISSIONS,
  STAGES,
  bottleneckOf,
  completedMissions,
  currentMission,
  stageOf,
} from "../src/game/missions";

/**
 * The advisor's job is to be right about what is in the way, and to never ask
 * for something the business has already done. Both are testable; the quality
 * of the advice is not, so what is asserted here is the routing and the
 * honesty rather than the wording.
 */

const at = (over: Partial<CityMetrics> = {}): CityMetrics => ({ ...ZERO_METRICS, source: "owner", ...over });

describe("stages", () => {
  it("reads the size of the business off the one number that scales", () => {
    expect(stageOf(at())).toBe("founding");
    expect(stageOf(at({ traffic: 20 }))).toBe("opening");
    expect(stageOf(at({ citizens: 1 }))).toBe("first-sales");
    expect(stageOf(at({ citizens: 10 }))).toBe("traction");
    expect(stageOf(at({ citizens: 100 }))).toBe("growth");
    expect(stageOf(at({ citizens: 5000 }))).toBe("scale");
  });

  it("has somewhere to go from every stage", () => {
    for (const stage of STAGES) expect(STAGES).toContain(stage);
    // A business at every size gets an advisor, including the biggest.
    for (const citizens of [0, 1, 10, 100, 1000, 100_000]) {
      expect(currentMission(at({ citizens, traffic: citizens * 3 })), `at ${citizens}`).not.toBeNull();
    }
  });
});

describe("bottlenecks", () => {
  it("puts a leaking bucket ahead of pouring more in", () => {
    // Low traffic and high churn together: fixing retention comes first,
    // because traffic poured into a leaking business runs straight out.
    expect(bottleneckOf(at({ citizens: 40, traffic: 5, churn: 25 }))).toBe("churn");
  });

  it("puts refunds ahead of everything, because they undo the sale", () => {
    expect(bottleneckOf(at({ citizens: 40, traffic: 5, churn: 25, refunds: 20 }))).toBe("refunds");
  });

  it("calls it a page problem when people arrive and do not buy", () => {
    expect(bottleneckOf(at({ traffic: 400 }))).toBe("conversion");
  });

  it("calls it a reach problem when the page works and nobody sees it", () => {
    expect(bottleneckOf(at({ citizens: 12, traffic: 4 }))).toBe("distribution");
  });

  it("notices when nothing repeats", () => {
    expect(bottleneckOf(at({ citizens: 40, traffic: 200, recurring: 0 }))).toBe("recurring");
  });

  it("says so plainly when nothing is wrong", () => {
    expect(bottleneckOf(at({ citizens: 40, traffic: 200, recurring: 900, churn: 3 }))).toBe("healthy");
  });

  it("has a reading for every bottleneck it can name", () => {
    const reachable = new Set<string>();
    for (const citizens of [0, 1, 12, 40, 900]) {
      for (const traffic of [0, 5, 400]) {
        for (const churn of [0, 25]) {
          for (const refunds of [0, 20]) {
            for (const recurring of [0, 900]) {
              reachable.add(bottleneckOf(at({ citizens, traffic, churn, refunds, recurring })));
            }
          }
        }
      }
    }
    // Every bottleneck the type allows is one a real business can actually be
    // in; a state nothing can reach is advice nobody will ever get.
    for (const bottleneck of BOTTLENECKS) expect([...reachable]).toContain(bottleneck);
  });
});

describe("missions", () => {
  it("never asks for something the business has already done", () => {
    const grown = at({ citizens: 400, traffic: 900, gold: 8000, goldBefore: 6000, recurring: 4000 });
    const mission = currentMission(grown);
    expect(mission).not.toBeNull();
    expect(mission!.done(grown)).toBe(false);
  });

  it("finishes itself when the number moves, with nothing to tick", () => {
    const before = at({ traffic: 10 });
    const hundred = MISSIONS.find((mission) => mission.id === "first-hundred")!;
    expect(hundred.done(before)).toBe(false);
    expect(hundred.progress(before)).toBeCloseTo(0.1, 1);

    const after = at({ traffic: 140 });
    expect(hundred.done(after)).toBe(true);
    expect(hundred.progress(after)).toBe(1);
  });

  it("answers the bottleneck it was picked for", () => {
    const leaking = at({ citizens: 40, traffic: 200, churn: 30 });
    expect(currentMission(leaking)!.for).toBe("churn");

    const unseen = at({ citizens: 12, traffic: 4 });
    expect(currentMission(unseen)!.for).toBe("distribution");
  });

  it("reports what is already true rather than hiding it", () => {
    const done = completedMissions(at({ citizens: 5, gold: 500, traffic: 400 }));
    expect(done.map((mission) => mission.id)).toContain("first-sale");
    expect(done.map((mission) => mission.id)).toContain("first-door");
  });

  it("either finishes on a number or admits it has no finish line", () => {
    // A bar stuck at nought forever is worse than saying so. Anything that
    // cannot be measured has to declare itself a standing practice.
    const impossible = MISSIONS.filter((mission) => {
      const enormous = at({ gold: 9e6, goldBefore: 1, citizens: 9e6, traffic: 9e6, recurring: 9e6 });
      return !mission.done(enormous) && !mission.standing;
    });
    expect(impossible.map((mission) => mission.id)).toEqual([]);
  });

  it("gives concrete ways to do every one of them", () => {
    for (const mission of MISSIONS) {
      expect(mission.how.length, mission.id).toBeGreaterThanOrEqual(3);
      expect(RESOURCES).toContain(mission.resource);
      for (const step of mission.how) {
        // An instruction, not a topic: long enough to act on, short enough to
        // read on a card.
        expect(step.length, `${mission.id}: "${step}"`).toBeGreaterThan(30);
        expect(step.length, `${mission.id}: "${step}"`).toBeLessThan(140);
      }
    }
  });

  it("keeps the advice general enough for any business on the platform", () => {
    // The trap this is guarding: advice that only makes sense for one kind of
    // business, which is noise to everyone else running something different.
    const tooSpecific =
      /cold email|newsletter|discord|youtube|tiktok|instagram|webinar|dropship|course|coaching|saas|trading/i;
    for (const mission of MISSIONS) {
      expect(mission.title, mission.id).not.toMatch(tooSpecific);
      expect(mission.why, mission.id).not.toMatch(tooSpecific);
      for (const step of mission.how) expect(step, mission.id).not.toMatch(tooSpecific);
    }
  });

  it("promises nothing it cannot see", () => {
    // No mission may claim an outcome; each is a thing to do, measured by a
    // number the advisor can actually read afterwards.
    for (const mission of MISSIONS) {
      expect(mission.why, mission.id).not.toMatch(/will (double|triple|guarantee)|guaranteed|\d+% more/i);
    }
  });
});
