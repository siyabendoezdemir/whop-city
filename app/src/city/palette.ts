/**
 * Visual system.
 *
 * Bright modern-SF: high-key daylight, saturated but clean district hues, and
 * crisp three-tone isometric shading. Each district owns a colour so the world
 * is readable at a glance without a legend.
 */

import type { DistrictId } from "../server/projection";

export type FaceSet = {
  readonly top: string;
  readonly right: string;
  readonly left: string;
};

export type DistrictPalette = {
  readonly hue: string;
  readonly soft: string;
  readonly plot: string;
  readonly plotEdge: string;
  readonly body: FaceSet;
  readonly accent: FaceSet;
  readonly window: string;
  readonly glow: string;
};

export const DISTRICT_PALETTE: Record<DistrictId, DistrictPalette> = {
  "commerce-core": {
    hue: "#5B5BD6",
    soft: "#EEEEFC",
    plot: "#DCDCF8",
    plotEdge: "#B9B9EE",
    body: { top: "#8E8EF0", right: "#6E6EDD", left: "#5252BE" },
    accent: { top: "#B0B0FF", right: "#8A8AF2", left: "#6666D2" },
    window: "#FFF6D8",
    glow: "rgba(91, 91, 214, 0.35)",
  },
  "offer-forge": {
    hue: "#FF6A3D",
    soft: "#FFF0EA",
    plot: "#FFDECF",
    plotEdge: "#FFBB9B",
    body: { top: "#FF9C74", right: "#FA7548", left: "#DA5730" },
    accent: { top: "#FFC09E", right: "#FF8E62", left: "#E56A3C" },
    window: "#FFF3D2",
    glow: "rgba(255, 106, 61, 0.35)",
  },
  "creator-quarter": {
    hue: "#12B886",
    soft: "#E7FAF3",
    plot: "#CFF3E6",
    plotEdge: "#9EE3CB",
    body: { top: "#4FD6A9", right: "#20BE8E", left: "#149A73" },
    accent: { top: "#7FE6C4", right: "#3CCB9D", left: "#1BA87E" },
    window: "#F2FFE9",
    glow: "rgba(18, 184, 134, 0.35)",
  },
};

/** Dormant districts are drawn in neutral stone: present, but unbuilt. */
export const DORMANT: DistrictPalette = {
  hue: "#94A3B8",
  soft: "#F1F5F9",
  plot: "#E2E8F0",
  plotEdge: "#CBD5E1",
  body: { top: "#CBD5E1", right: "#AEBCCC", left: "#94A3B8" },
  accent: { top: "#D6DFE9", right: "#BCC8D6", left: "#A2B0C0" },
  window: "#E8EEF5",
  glow: "rgba(148, 163, 184, 0.25)",
};

export function paletteFor(id: DistrictId, tier: number): DistrictPalette {
  return tier === 0 ? DORMANT : DISTRICT_PALETTE[id];
}

export const SKY = {
  dawn: { from: "#FFF3E6", via: "#EAF1FF", to: "#F7FAFF" },
  day: { from: "#DCEBFF", via: "#EFF5FF", to: "#FBFCFF" },
  dusk: { from: "#EAE6F7", via: "#F2F0FA", to: "#FAFAFD" },
} as const;

export const DIRECTION_LABEL = {
  rising: "Rising",
  steady: "Steady",
  cooling: "Cooling",
  dormant: "Dormant",
} as const;
