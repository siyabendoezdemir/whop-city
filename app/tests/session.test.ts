import { describe, expect, it } from "vitest";

import { activityFor, allActivities, promptById } from "../src/city/activities";
import { DISTRICT_IDS, DISTRICT_STATES, ZERO_METRICS, type DistrictState, type PublicCityProjection, type PublicDistrict } from "../src/city/projection";
import {
  buildSession,
  planAsText,
  planForActivity,
  runActivity,
  type Answer,
} from "../src/city/session";

const district = (
  id: (typeof DISTRICT_IDS)[number],
  state: DistrictState,
  over: Partial<PublicDistrict> = {},
): PublicDistrict => ({
  id,
  state,
  direction: state === "rising" ? "rising" : state === "healthy" ? "steady" : "cooling",
  signal: state === "dormant" ? "unbuilt" : "quiet",
  parcels: 3,
  variant: 0,
  ...over,
});

const projection = (
  states: Partial<Record<(typeof DISTRICT_IDS)[number], DistrictState>>,
  over: Partial<PublicCityProjection> = {},
): PublicCityProjection => ({
  metrics: ZERO_METRICS,
  schema: "whop-city.public.v2",
  freshness: "live",
  seed: "a7f3c1e90b6d84fa",
  districts: DISTRICT_IDS.map((id) => district(id, states[id] ?? "healthy")),
  ...over,
});

const answer = (over: Partial<Answer>): Answer => ({
  activityId: "x",
  promptId: "x",
  districtId: "commerce-core",
  value: "confirmed",
  observedState: "struggling",
  at: 1,
  ...over,
});

describe("every district has something worth doing", () => {
  it("offers an activity in every readable state", () => {
    for (const id of DISTRICT_IDS) {
      for (const state of DISTRICT_STATES) {
        const activity = activityFor(district(id, state));
        expect(activity, `${id}/${state} has nothing to do`).not.toBeNull();
        expect(activity!.prompts.length).toBeGreaterThan(0);
        expect(promptById(activity!, activity!.entry), `${id}/${state} entry is missing`).not.toBeNull();
      }
    }
  });

  it("offers nothing at all when City could not read the district", () => {
    // Work suggested off a failed reading would be work invented from nothing.
    expect(activityFor(district("commerce-core", "struggling", { signal: "unreadable" }))).toBeNull();
  });

  it("does not give every district the same mechanic", () => {
    // The failure this replaces: read a paragraph, tick three boxes, everywhere.
    const kindsByDistrict = new Map<string, Set<string>>();
    for (const activity of allActivities()) {
      const kinds = kindsByDistrict.get(activity.districtId) ?? new Set<string>();
      for (const prompt of activity.prompts) kinds.add(prompt.kind);
      kindsByDistrict.set(activity.districtId, kinds);
    }
    for (const id of DISTRICT_IDS) {
      expect(kindsByDistrict.get(id)!.size, `${id} uses only one prompt kind`).toBeGreaterThan(1);
    }
    // And across the city, all three kinds are actually used.
    const all = new Set([...kindsByDistrict.values()].flatMap((set) => [...set]));
    expect([...all].sort()).toEqual(["check", "choice", "commit"]);
  });

  it("wires every branch to a prompt that exists", () => {
    for (const activity of allActivities()) {
      for (const prompt of activity.prompts) {
        const targets = [prompt.next, ...(prompt.options ?? []).map((option) => option.next)];
        for (const target of targets) {
          if (!target) continue;
          expect(promptById(activity, target), `${activity.id}:${prompt.id} -> ${target}`).not.toBeNull();
        }
      }
      // Every prompt is reachable from the entry, or it is dead content.
      const reachable = new Set<string>();
      const walk = (id: string) => {
        if (reachable.has(id)) return;
        reachable.add(id);
        const prompt = promptById(activity, id);
        if (!prompt) return;
        if (prompt.next) walk(prompt.next);
        for (const option of prompt.options ?? []) if (option.next) walk(option.next);
      };
      walk(activity.entry);
      for (const prompt of activity.prompts) {
        expect(reachable.has(prompt.id), `${activity.id}:${prompt.id} is unreachable`).toBe(true);
      }
    }
  });

  it("gives every choice option an outcome or a continuation", () => {
    for (const activity of allActivities()) {
      for (const prompt of activity.prompts) {
        for (const option of prompt.options ?? []) {
          expect(
            option.outcome !== undefined || option.next !== undefined,
            `${activity.id}:${prompt.id}:${option.id} leads nowhere`,
          ).toBe(true);
        }
      }
    }
  });
});

describe("walking an activity", () => {
  const activity = activityFor(district("offer-forge", "dormant"))!;

  it("stops at the first unanswered prompt", () => {
    const run = runActivity(activity, []);
    expect(run.current?.id).toBe(activity.entry);
    expect(run.complete).toBe(false);
  });

  it("follows the branch the answer selected", () => {
    const once = runActivity(activity, [
      answer({ activityId: activity.id, promptId: "shape", value: "once" }),
    ]);
    expect(once.current?.id).toBe("once-price");

    const ongoing = runActivity(activity, [
      answer({ activityId: activity.id, promptId: "shape", value: "ongoing" }),
    ]);
    expect(ongoing.current?.id).toBe("ongoing-term");
  });

  it("finishes when the branch runs out", () => {
    const run = runActivity(activity, [
      answer({ activityId: activity.id, promptId: "shape", value: "ongoing" }),
      answer({ activityId: activity.id, promptId: "ongoing-term", value: "monthly" }),
    ]);
    expect(run.complete).toBe(true);
    expect(run.current).toBeNull();
    // The unwalked branch is not part of this run and does not count against it.
    expect(run.answered.map((prompt) => prompt.id)).toEqual(["shape", "ongoing-term"]);
  });
});

describe("the plan is what leaves with the operator", () => {
  const activity = activityFor(district("commerce-core", "struggling"))!;

  it("turns a found problem into an action and a pass into a record", () => {
    const plan = planForActivity(
      activity,
      [
        answer({ activityId: activity.id, promptId: "visible", value: "problem" }),
        answer({ activityId: activity.id, promptId: "archived", value: "confirmed" }),
        answer({ activityId: activity.id, promptId: "members", value: "not-applicable" }),
      ],
      "struggling",
    );

    expect(plan.map((item) => item.kind)).toEqual(["action", "clear", "decision"]);
    expect(plan[0].text).toContain("visible");
    // Everything the operator said is theirs, and marked as theirs.
    for (const item of plan) expect(item.provenance).toBe("reported");
  });

  it("records a deliberate no as a decision, not a gap", () => {
    const quarter = activityFor(district("creator-quarter", "dormant"))!;
    const plan = planForActivity(
      quarter,
      [answer({ activityId: quarter.id, districtId: "creator-quarter", promptId: "want", value: "no" })],
      "dormant",
    );
    expect(plan).toHaveLength(1);
    expect(plan[0].kind).toBe("finding");
    expect(plan[0].text).toContain("deliberately not");
  });

  it("marks items answered under a reading that has since changed", () => {
    const plan = planForActivity(
      activity,
      [answer({ activityId: activity.id, promptId: "visible", value: "problem", observedState: "struggling" })],
      "healthy",
    );
    expect(plan[0].staleAgainstObservation).toBe(true);
  });
});

describe("the session", () => {
  it("names itself after what the city is actually showing", () => {
    expect(buildSession(projection({ "commerce-core": "struggling" }), []).title).toMatch(/quiet/i);
    expect(buildSession(projection({ "commerce-core": "dormant", "offer-forge": "dormant" }), []).title).toMatch(
      /build/i,
    );
    expect(buildSession(projection({ "commerce-core": "rising" }), []).title).toMatch(/new work/i);
    expect(buildSession(projection({}), []).title).toMatch(/maintenance/i);
  });

  it("puts the most pressing district first and sinks finished ones", () => {
    const city = projection({ "commerce-core": "healthy", "offer-forge": "struggling" });
    const session = buildSession(city, []);
    expect(session.work[0].district.id).toBe("offer-forge");
    expect(session.outstanding.map((entry) => entry.district.id)).toEqual(["offer-forge"]);
  });

  it("is complete only when every district's activity is finished", () => {
    const city = projection({ "commerce-core": "dormant" });
    expect(buildSession(city, []).complete).toBe(false);

    const answers: Answer[] = [];
    for (const entry of buildSession(city, []).work) {
      const activity = entry.activity!;
      // Walk each activity to its end down the first branch.
      let run = runActivity(activity, answers);
      while (run.current) {
        const prompt = run.current;
        const value =
          prompt.kind === "choice"
            ? prompt.options![0].id
            : prompt.kind === "commit"
              ? "will-do"
              : "confirmed";
        answers.push(
          answer({
            activityId: activity.id,
            districtId: entry.district.id,
            promptId: prompt.id,
            value,
            observedState: entry.district.state,
          }),
        );
        run = runActivity(activity, answers.filter((a) => a.activityId === activity.id));
      }
    }
    expect(buildSession(city, answers).complete).toBe(true);
  });

  it("offers nothing and says so when the business could not be read", () => {
    const dark = projection(
      { "commerce-core": "dormant", "offer-forge": "dormant", "creator-quarter": "dormant" },
      { freshness: "unavailable" },
    );
    const unreadable: PublicCityProjection = {
      ...dark,
      districts: dark.districts.map((entry) => ({ ...entry, signal: "unreadable" as const })),
    };
    const session = buildSession(unreadable, []);
    expect(session.unreadable).toBe(true);
    expect(session.complete).toBe(false);
    expect(session.outstanding).toHaveLength(0);
    expect(session.work.every((entry) => entry.activity === null)).toBe(true);
  });

  it("treats a deliberate no as decided rather than outstanding", () => {
    const city = projection({ "creator-quarter": "dormant" });
    const quarter = activityFor(district("creator-quarter", "dormant"))!;
    const session = buildSession(city, [
      answer({
        activityId: quarter.id,
        districtId: "creator-quarter",
        promptId: "want",
        value: "no",
        observedState: "dormant",
      }),
    ]);
    const work = session.work.find((entry) => entry.district.id === "creator-quarter")!;
    expect(work.declined).toBe(true);
    expect(work.complete).toBe(true);
    expect(session.outstanding.map((entry) => entry.district.id)).not.toContain("creator-quarter");
  });

  it("notices when City has read a district differently since it was worked", () => {
    const city = projection({ "commerce-core": "healthy" });
    const session = buildSession(city, [
      answer({ promptId: "visible", value: "problem", observedState: "struggling" }),
    ]);
    expect(session.work.find((entry) => entry.district.id === "commerce-core")!.changed).toBe(true);
  });
});

describe("the plan as text", () => {
  const city = projection({ "commerce-core": "struggling" });
  const activity = activityFor(district("commerce-core", "struggling"))!;
  const built = () =>
    buildSession(
      city,
      [
        answer({ activityId: activity.id, promptId: "visible", value: "problem" }),
        answer({ activityId: activity.id, promptId: "archived", value: "confirmed" }),
      ],
      { "commerce-core": { text: "ask about the hidden plan", observedState: "struggling" } },
    );

  it("says who observed what, and where it is kept", () => {
    const text = planAsText(built(), (id) => id, () => "Not adding up");

    expect(text).toContain("Whop reported: Not adding up");
    expect(text).toContain("what you told Whop City");
    expect(text).toContain("Not sent to Whop");
    expect(text).not.toMatch(/grew|increased|improved your/i);
  });

  it("is a checklist someone can act on, actions first", () => {
    const text = planAsText(built(), (id) => id, () => "Not adding up");
    const lines = text.split("\n");

    // The thing to do leads; the note follows; what was already fine sinks.
    expect(lines.findIndex((line) => line.startsWith("- [ ]"))).toBeLessThan(
      lines.findIndex((line) => line.startsWith("- [x]")),
    );
    expect(text).toContain("> ask about the hidden plan");
  });

  it("carries the operator's own line into the plan", () => {
    const session = built();
    const note = session.plan.find((item) => item.kind === "note");
    expect(note?.text).toBe("ask about the hidden plan");
    expect(note?.provenance).toBe("reported");
  });
});
