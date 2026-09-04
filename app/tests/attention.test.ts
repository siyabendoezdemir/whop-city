import { describe, expect, it } from "vitest";

import {
  ATTENTION_LABEL,
  ATTENTION_LEVELS,
  attentionFor,
  attentionQueue,
  needsAttention,
} from "../src/city/attention";
import { DISTRICT_IDS, type PublicDistrict } from "../src/city/projection";

const district = (over: Partial<PublicDistrict> = {}): PublicDistrict => ({
  id: "commerce-core",
  state: "healthy",
  direction: "steady",
  signal: "busy",
  parcels: 3,
  variant: 0,
  ...over,
});

describe("what the city asks for", () => {
  it("treats a shuttered district as the most pressing thing", () => {
    expect(attentionFor(district({ state: "struggling" }))).toBe("urgent");
  });

  it("treats an unbuilt district as an opportunity, not an emergency", () => {
    // Nothing is broken. Something is simply not there.
    expect(attentionFor(district({ state: "dormant" }))).toBe("opportunity");
  });

  it("treats construction as worth watching", () => {
    expect(attentionFor(district({ state: "rising" }))).toBe("watch");
  });

  it("leaves a healthy district alone unless it is losing pace", () => {
    expect(attentionFor(district({ state: "healthy", direction: "steady" }))).toBe("steady");
    expect(attentionFor(district({ state: "healthy", direction: "rising" }))).toBe("steady");
    expect(attentionFor(district({ state: "healthy", direction: "cooling" }))).toBe("watch");
  });

  it("says unknown rather than guessing when the reading failed", () => {
    // An unreadable district must never be ranked as if it were fine.
    for (const state of ["healthy", "struggling", "dormant", "rising"] as const) {
      expect(attentionFor(district({ state, signal: "unreadable" }))).toBe("unknown");
    }
  });

  it("orders the queue by how much it matters", () => {
    const queue = attentionQueue([
      district({ id: "commerce-core", state: "healthy" }),
      district({ id: "offer-forge", state: "struggling" }),
      district({ id: "creator-quarter", state: "dormant" }),
    ]);
    expect(queue.map((entry) => entry.district.id)).toEqual([
      "offer-forge",
      "creator-quarter",
      "commerce-core",
    ]);
  });

  it("keeps a stable order for equal levels, so the queue does not shuffle", () => {
    const districts = DISTRICT_IDS.map((id) => district({ id, state: "healthy" }));
    const once = attentionQueue(districts).map((entry) => entry.district.id);
    const twice = attentionQueue(districts).map((entry) => entry.district.id);
    expect(once).toEqual(twice);
    expect(once).toEqual([...DISTRICT_IDS]);
  });

  it("counts only the levels that want an operator's time", () => {
    expect(needsAttention("urgent")).toBe(true);
    expect(needsAttention("opportunity")).toBe(true);
    expect(needsAttention("watch")).toBe(true);
    expect(needsAttention("steady")).toBe(false);
    expect(needsAttention("unknown")).toBe(false);
  });

  it("has a label for every level and never a number in one", () => {
    for (const level of ATTENTION_LEVELS) {
      expect(ATTENTION_LABEL[level]).toBeTruthy();
      expect(ATTENTION_LABEL[level]).not.toMatch(/\d/);
    }
  });
});
