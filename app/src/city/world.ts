/**
 * World generation.
 *
 * The city is a pure function of the public projection: the same business
 * always produces the same skyline, and nothing here invents activity the
 * projection did not report. A tier-0 district generates foundations and no
 * towers, because an empty business should look empty rather than busy.
 */

import type { CityProjection, DistrictId, DistrictProjection } from "../server/projection";

export const TILE_W = 64;
export const TILE_H = 32;
export const TILE_Z = 22;

export type Point = { x: number; y: number };

/** Grid space to screen space. */
export function iso(gx: number, gy: number, gz = 0): Point {
  return {
    x: (gx - gy) * (TILE_W / 2),
    y: (gx + gy) * (TILE_H / 2) - gz * TILE_Z,
  };
}

/** Deterministic PRNG so a given business renders identically every load. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedOf(id: string, variant: number): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash ^ (variant * 0x9e3779b9)) >>> 0;
}

export type Building = {
  readonly key: string;
  readonly gx: number;
  readonly gy: number;
  readonly w: number;
  readonly d: number;
  readonly h: number;
  /** Lit windows only where the projection says there is activity. */
  readonly lit: boolean;
  readonly accent: boolean;
  /** Staggered reveal on first load. */
  readonly delay: number;
};

export type DistrictLayout = {
  readonly id: DistrictId;
  readonly projection: DistrictProjection;
  readonly origin: Point;
  readonly span: number;
  readonly plot: readonly Point[];
  readonly labelAnchor: Point;
  readonly center: Point;
  readonly buildings: readonly Building[];
};

/** Plot origins in grid space, laid out so no district hides another. */
const PLOTS: Record<DistrictId, { gx: number; gy: number; span: number }> = {
  "commerce-core": { gx: 0, gy: 0, span: 6 },
  "offer-forge": { gx: 8, gy: 1, span: 5 },
  "creator-quarter": { gx: 1, gy: 8, span: 5 },
};

function plotOutline(gx: number, gy: number, span: number): Point[] {
  return [iso(gx, gy), iso(gx + span, gy), iso(gx + span, gy + span), iso(gx, gy + span)];
}

function buildDistrict(projection: DistrictProjection): DistrictLayout {
  const plot = PLOTS[projection.id];
  const random = mulberry32(seedOf(projection.id, projection.variant));
  const buildings: Building[] = [];

  // A tier-0 district still gets its plot and a few foundations, so the world
  // reads as "nothing built here yet" rather than as a rendering failure.
  const target = projection.tier === 0 ? 3 : projection.blocks;
  const inner = plot.span - 1;

  const taken = new Set<string>();
  let attempts = 0;
  while (buildings.length < target && attempts < 200) {
    attempts++;
    const w = random() > 0.72 ? 2 : 1;
    const d = random() > 0.72 ? 2 : 1;
    const gx = plot.gx + Math.floor(random() * (inner - w + 1));
    const gy = plot.gy + Math.floor(random() * (inner - d + 1));

    let clash = false;
    for (let ox = 0; ox < w && !clash; ox++) {
      for (let oy = 0; oy < d && !clash; oy++) {
        if (taken.has(`${gx + ox}:${gy + oy}`)) clash = true;
      }
    }
    if (clash) continue;
    for (let ox = 0; ox < w; ox++) for (let oy = 0; oy < d; oy++) taken.add(`${gx + ox}:${gy + oy}`);

    // Height tracks tier; health decides how tall the tallest gets.
    const base = projection.tier === 0 ? 0.25 : 0.6 + projection.tier * 0.55;
    const spread = 0.5 + projection.health * 2.6;
    const h = Math.max(0.3, base + random() * spread);

    buildings.push({
      key: `${projection.id}-${buildings.length}`,
      gx,
      gy,
      w,
      d,
      h: Math.round(h * 100) / 100,
      lit: projection.tier > 0 && random() < 0.35 + projection.health * 0.5,
      accent: projection.tier > 0 && h > base + spread * 0.62,
      delay: buildings.length * 55,
    });
  }

  // Painter's algorithm: far tiles first so near buildings overlap correctly.
  buildings.sort((a, b) => a.gx + a.gy - (b.gx + b.gy));

  const centreGrid = iso(plot.gx + plot.span / 2, plot.gy + plot.span / 2);

  return {
    id: projection.id,
    projection,
    origin: iso(plot.gx, plot.gy),
    span: plot.span,
    plot: plotOutline(plot.gx, plot.gy, plot.span),
    labelAnchor: iso(plot.gx + plot.span / 2, plot.gy),
    center: centreGrid,
    buildings,
  };
}

export type World = {
  readonly districts: readonly DistrictLayout[];
  readonly bounds: { minX: number; minY: number; maxX: number; maxY: number };
};

export function buildWorld(projection: CityProjection): World {
  const districts = projection.districts.map(buildDistrict);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const district of districts) {
    for (const point of district.plot) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
    for (const building of district.buildings) {
      const top = iso(building.gx, building.gy, building.h);
      minY = Math.min(minY, top.y);
    }
  }

  const pad = 80;
  return {
    districts,
    bounds: { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad },
  };
}

/** The three visible faces of an isometric box, as SVG polygon points. */
export function boxFaces(building: Building): { top: string; left: string; right: string } {
  const { gx, gy, w, d, h } = building;
  const p = (x: number, y: number, z: number) => {
    const point = iso(x, y, z);
    return `${point.x},${point.y}`;
  };

  return {
    top: [p(gx, gy, h), p(gx + w, gy, h), p(gx + w, gy + d, h), p(gx, gy + d, h)].join(" "),
    left: [p(gx, gy + d, h), p(gx + w, gy + d, h), p(gx + w, gy + d, 0), p(gx, gy + d, 0)].join(" "),
    right: [p(gx + w, gy, h), p(gx + w, gy + d, h), p(gx + w, gy + d, 0), p(gx + w, gy, 0)].join(" "),
  };
}

export function footprint(building: Building): string {
  const { gx, gy, w, d } = building;
  return [iso(gx, gy), iso(gx + w, gy), iso(gx + w, gy + d), iso(gx, gy + d)]
    .map((point) => `${point.x},${point.y}`)
    .join(" ");
}

export function polygon(points: readonly Point[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}
