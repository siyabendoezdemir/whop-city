/**
 * What is actually lying on the roads.
 *
 * The plan drawing next door reads the authored tables, which is the right way
 * to check the tables and no way at all to check the world. Most of the ground
 * in this city is not in a table: promenades, quaysides, headland paving and
 * the backdrop blocks are all built procedurally, and a procedural slab laid
 * across a carriageway is invisible to any amount of staring at parcel data.
 *
 * So this asks the built scene instead. It samples every driven carriageway on
 * a two-metre grid, fires a ray straight down at each point, and reports what
 * a wheel would be resting on. Anything that is not a road surface gets
 * written out for the plan drawing to mark in red.
 *
 * It found the fault two rounds of screenshots had missed: the headland
 * promenade — lawn, paving, benches, planters and the ferry terminal deck —
 * was laid straight across the quay road, and a run of backdrop buildings was
 * standing in the ring road. That is the grass on the road, and it is why a
 * car appeared to be driving across a lawn.
 *
 *   pnpm probe        # needs the preview server up
 */

import { mkdirSync, writeFileSync } from "node:fs";

import { chromium } from "@playwright/test";

import { launchOptions, openCity } from "./env.mjs";
import { DRIVEN_ROADS } from "../src/render/city/cityPlan";
import {
  MEDIAN_SURFACES,
  ROAD_SURFACES,
  WHEEL_HEIGHT,
  carriagewaySamples,
  type Spot,
} from "../src/render/city/plan";

type Sample = Spot;

const grades = new Map(DRIVEN_ROADS.map((road) => [road.id, road.grade]));
const points = carriagewaySamples(DRIVEN_ROADS);
console.log(`${points.length} samples across ${DRIVEN_ROADS.length} driven roads`);

const browser = await chromium.launch(launchOptions());
const page = await openCity(browser, {
  scenario: "thriving",
  ss: 1,
  view: { width: 900, height: 600 },
});

type Reading = Sample & { hit: { name: string; y: number } | null };

const read: Reading[] = await page.evaluate(
  ({ pts, ceiling }: { pts: Sample[]; ceiling: number }) =>
    pts.map((p) => ({ ...p, hit: window.__city?.surfaceAt(p.x, p.z, ceiling) ?? null })),
  { pts: points, ceiling: WHEEL_HEIGHT },
);
await browser.close();

const covered = read.filter((s) => {
  const name = s.hit?.name;
  if (!name) return true;
  if (ROAD_SURFACES.has(name)) return false;
  // A boulevard is allowed its planted reservation.
  return !(grades.get(s.road) === "boulevard" && MEDIAN_SURFACES.has(name));
});

const tally = new Map<string, { count: number; roads: Set<string>; first: string }>();
for (const s of covered) {
  const name = s.hit?.name ?? "nothing";
  const seen = tally.get(name) ?? { count: 0, roads: new Set<string>(), first: "" };
  seen.count++;
  seen.roads.add(s.road);
  seen.first ||= `(${s.x.toFixed(0)}, ${s.z.toFixed(0)}) y=${s.hit?.y.toFixed(2) ?? "-"}`;
  tally.set(name, seen);
}

for (const [name, seen] of [...tally].sort((a, b) => b[1].count - a[1].count)) {
  console.log(
    `${name.padEnd(16)} ${String(seen.count).padStart(4)} on ${[...seen.roads].join(", ")}  first at ${seen.first}`,
  );
}
console.log(
  covered.length === 0
    ? `clear: all ${points.length} carriageway samples are road surface`
    : `${covered.length} of ${points.length} carriageway samples are covered`,
);

mkdirSync("artifacts", { recursive: true });
writeFileSync(
  "artifacts/road-cover.json",
  JSON.stringify(
    { total: points.length, covered: covered.map((s) => ({ x: s.x, z: s.z, was: s.hit?.name ?? "nothing" })) },
    null,
    2,
  ),
);
console.log("wrote artifacts/road-cover.json — run `pnpm plan` to see it drawn");
