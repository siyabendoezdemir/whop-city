import { describe, expect, it } from "vitest";

import { buildWorld, boxFaces, iso } from "../src/city/world";
import { toPublicProjection } from "../src/server/projection";
import type { BusinessSnapshot } from "../src/server/snapshot";

function snapshot(overrides: Partial<BusinessSnapshot> = {}): BusinessSnapshot {
  return {
    accountId: "biz_world_test",
    capturedAt: 1_700_000_000_000,
    reachable: true,
    products: [
      {
        id: "prod_a",
        title: "a",
        visible: true,
        memberCount: 12,
        affiliateEnabled: true,
        affiliatePercentage: 30,
        memberAffiliateEnabled: true,
        createdAt: 1_699_900_000_000,
        planType: "one_time",
      },
    ],
    plans: [
      { id: "plan_a", planType: "one_time", visible: true, priceMinorUnits: 900, createdAt: 1_699_900_000_000 },
      { id: "plan_b", planType: "renewal", visible: true, priceMinorUnits: 1900, createdAt: 1_699_900_000_000 },
    ],
    ...overrides,
  };
}

describe("world generation", () => {
  it("produces an identical skyline for the same business on every render", () => {
    const projection = toPublicProjection(snapshot());
    const a = buildWorld(projection);
    const b = buildWorld(projection);
    expect(JSON.stringify(a.districts)).toEqual(JSON.stringify(b.districts));
  });

  it("gives every district a plot even when nothing is built there", () => {
    const projection = toPublicProjection(snapshot({ products: [], plans: [] }));
    const world = buildWorld(projection);

    expect(world.districts).toHaveLength(3);
    for (const district of world.districts) {
      expect(district.plot).toHaveLength(4);
      // Foundations, so an empty business reads as unbuilt rather than broken.
      expect(district.buildings.length).toBeGreaterThan(0);
      for (const building of district.buildings) {
        expect(building.lit).toBe(false);
        expect(building.accent).toBe(false);
      }
    }
  });

  it("builds a taller skyline for a busier business", () => {
    const quiet = buildWorld(toPublicProjection(snapshot({ products: [], plans: [] })));
    const busy = buildWorld(toPublicProjection(snapshot()));

    const tallest = (world: ReturnType<typeof buildWorld>) =>
      Math.max(...world.districts.flatMap((d) => d.buildings.map((b) => b.h)));

    expect(tallest(busy)).toBeGreaterThan(tallest(quiet));
  });

  it("never overlaps two buildings on the same tile", () => {
    const world = buildWorld(toPublicProjection(snapshot()));
    for (const district of world.districts) {
      const occupied = new Set<string>();
      for (const building of district.buildings) {
        for (let ox = 0; ox < building.w; ox++) {
          for (let oy = 0; oy < building.d; oy++) {
            const cell = `${building.gx + ox}:${building.gy + oy}`;
            expect(occupied.has(cell)).toBe(false);
            occupied.add(cell);
          }
        }
      }
    }
  });

  it("keeps districts inside their own plots", () => {
    const world = buildWorld(toPublicProjection(snapshot()));
    for (const district of world.districts) {
      for (const building of district.buildings) {
        const corner = iso(building.gx, building.gy);
        expect(corner.x).toBeGreaterThanOrEqual(world.bounds.minX);
        expect(corner.x).toBeLessThanOrEqual(world.bounds.maxX);
      }
    }
  });

  it("emits three drawable faces per building", () => {
    const world = buildWorld(toPublicProjection(snapshot()));
    const building = world.districts[0].buildings[0];
    const faces = boxFaces(building);
    for (const face of [faces.top, faces.left, faces.right]) {
      expect(face.split(" ")).toHaveLength(4);
      expect(face).toMatch(/^-?[\d.]+,-?[\d.]+/);
    }
  });
});
