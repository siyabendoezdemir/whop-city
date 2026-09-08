import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { buildSurroundings } from "../src/render/city/cityPlan";
import { M } from "../src/render/scene/materials";

/**
 * Whose building is that?
 *
 * The backdrop massing and the eleven playable plots used to be built from one
 * set of six body materials, so a block across the ring road was the same
 * brick, at the same size, finished the same way, as a block the player owned.
 * There was nothing in the frame to tell them apart and the only way to find
 * out was to click and see whether anything happened.
 *
 * The separation is a palette rather than a marker or an outline, which makes
 * it invisible to every other test in the suite: nothing throws if a backdrop
 * body quietly goes back to `M.brick`, the city just becomes unreadable again.
 * So it is pinned here, on the two things that have to hold — the backdrop does
 * not wear the player's colours, and the colours it wears instead are far
 * enough away to see.
 */

/** What a building the player owns can be painted. */
const PLAYER_BODIES = [
  "brick",
  "brickDark",
  "renderCream",
  "renderTeal",
  "renderClay",
  "plaster",
] as const;

/** Which player body each backdrop one stands in for. */
const STANDS_IN_FOR: Record<string, (typeof PLAYER_BODIES)[number]> = {
  backdropBrick: "brick",
  backdropBrickDark: "brickDark",
  backdropCream: "renderCream",
  backdropTeal: "renderTeal",
  backdropClay: "renderClay",
  backdropPlaster: "plaster",
};

/** Every material name standing in the backdrop, once. */
function backdropMaterials(): Set<string> {
  const names = new Set<string>();
  buildSurroundings(12345).traverse((object) => {
    const held = (object as THREE.Mesh).material;
    if (!held) return;
    for (const material of Array.isArray(held) ? held : [held]) {
      if (material.name) names.add(material.name);
    }
  });
  return names;
}

/**
 * How far apart two colours look, roughly.
 *
 * Measured after gamma, not in the linear space the renderer lights in, and
 * the difference is not academic. Linear space is stretched at the bright end,
 * so two pale colours that are plainly the same paint on screen come out far
 * apart in it: the drained cream this palette started with scored 0.111 linear
 * against the player's — comfortably past any threshold worth setting — while
 * being, in the render, indistinguishable. After gamma it scores 0.059 and the
 * cool concrete that replaced it scores 0.109, which is the gap the eye sees.
 *
 * Still not a perceptual metric. It only has to catch a backdrop colour that
 * has drifted back to the player's, which is a cruder failure than anything
 * Lab would be needed to measure.
 */
function distance(a: THREE.Color, b: THREE.Color): number {
  const x = a.clone().convertLinearToSRGB();
  const y = b.clone().convertLinearToSRGB();
  return Math.hypot(x.r - y.r, x.g - y.g, x.b - y.b);
}

describe("backdrop palette", () => {
  it("never paints the backdrop in a colour the player's buildings wear", () => {
    const used = backdropMaterials();
    // Not empty, or the assertion below passes by looking at nothing.
    expect(used.size).toBeGreaterThan(5);
    expect([...used].filter((name) => PLAYER_BODIES.includes(name as never))).toEqual([]);
  });

  it("gives every backdrop body its own material", () => {
    const used = backdropMaterials();
    // At least one drained body is standing, so the sweep above has something
    // to be true about.
    expect([...used].filter((name) => name in STANDS_IN_FOR).length).toBeGreaterThan(0);
  });

  it("keeps each backdrop body clear of the colour it stands in for", () => {
    for (const [backdrop, player] of Object.entries(STANDS_IN_FOR)) {
      const mine = M[player as keyof typeof M] as THREE.MeshStandardMaterial;
      const theirs = M[backdrop as keyof typeof M] as THREE.MeshStandardMaterial;
      // Sits in the gap between the two known cases: the purely-drained cream
      // and plaster that failed by eye scored 0.059 and 0.049, and the closest
      // body standing today scores 0.109. Anything landing between those is
      // worth a look rather than a silent pass.
      expect(distance(mine.color, theirs.color), `${backdrop} vs ${player}`).toBeGreaterThan(0.09);
    }
  });

  it("keeps the backdrop's own bodies distinguishable from each other", () => {
    // A backdrop drained to one flat grey loses its massing: at this camera a
    // city reads as depth because light faces stand against dark ones.
    const values = Object.keys(STANDS_IN_FOR).map((name) => {
      const { color } = M[name as keyof typeof M] as THREE.MeshStandardMaterial;
      return color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
    });
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.3);
  });
});
