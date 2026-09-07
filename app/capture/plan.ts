/**
 * The city, drawn flat.
 *
 * Every other tool in here photographs the world through the game's own
 * camera, which is the right way to judge how it looks and a poor way to find
 * out where anything is. A thirty-five degree view hides what is behind a
 * building, foreshortens every distance, takes the better part of a minute a
 * frame under software WebGL, and cannot show a boundary at all — a plot edge
 * is not a thing that gets rendered.
 *
 * This draws the plan instead, from the same tables the world is built from:
 * carriageways, footways, plot boundaries, and anywhere they overlap. No
 * browser and no renderer beyond turning the finished drawing into a PNG, so
 * it answers in about a second and can be re-run after every edit.
 *
 * That was not hypothetical. Six plots were standing in a running carriageway,
 * which is why grass was painted over the asphalt and why traffic drove
 * through buildings — and the 3D captures could show the symptom for weeks
 * without ever locating the cause.
 *
 *   pnpm plan
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { PARCELS, ROADS } from "../src/render/city/cityPlan";
import {
  behindTheKerb,
  carriageway,
  corridor,
  footprint,
  trespasses,
  type Rect,
} from "../src/render/city/plan";

const PAD = 24;
const SCALE = 5;

/**
 * Points where `pnpm probe` found something lying on a carriageway.
 *
 * Optional, because the plan is useful on its own and the probe needs a
 * running preview server. When it is there, it fills in everything the
 * authored tables cannot see: the promenade, the quaysides and the backdrop
 * blocks are all built procedurally, and the only way to catch one of those
 * sitting on a road is to go and look at the built scene.
 */
function coverage(): { x: number; z: number; was: string }[] {
  if (!existsSync("artifacts/road-cover.json")) return [];
  return JSON.parse(readFileSync("artifacts/road-cover.json", "utf8")).covered;
}

function draw(): string {
  // Framed on the plots and on anything the probe flagged, not on the network.
  // Two roads run off to the edge of the world, and letting them set the
  // extent shrinks the part worth reading into a corner.
  const marks = coverage();
  const plots = PARCELS.map(footprint);
  const margin = 40;
  const xs = [...plots.flatMap((r) => [r.x0, r.x1]), ...marks.map((m) => m.x)];
  const zs = [...plots.flatMap((r) => [r.z0, r.z1]), ...marks.map((m) => m.z)];
  const minX = Math.min(...xs) - margin;
  const maxX = Math.max(...xs) + margin;
  const minZ = Math.min(...zs) - margin;
  const maxZ = Math.max(...zs) + margin;

  const w = (maxX - minX) * SCALE + PAD * 2;
  const h = (maxZ - minZ) * SCALE + PAD * 2;
  const px = (x: number) => (x - minX) * SCALE + PAD;
  const pz = (z: number) => (z - minZ) * SCALE + PAD;
  const box = (r: Rect, fill: string, stroke = "none", extra = "") =>
    `<rect x="${px(r.x0).toFixed(1)}" y="${pz(r.z0).toFixed(1)}" ` +
    `width="${((r.x1 - r.x0) * SCALE).toFixed(1)}" height="${((r.z1 - r.z0) * SCALE).toFixed(1)}" ` +
    `fill="${fill}" stroke="${stroke}" ${extra}/>`;

  const clashes = trespasses(PARCELS, ROADS);
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w.toFixed(0)}" height="${h.toFixed(0)}" viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}">`,
    `<rect width="100%" height="100%" fill="#101820"/>`,
    `<defs><pattern id="clash" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
      `<rect width="8" height="8" fill="#ff2d55" fill-opacity="0.35"/>` +
      `<line x1="0" y1="0" x2="0" y2="8" stroke="#ff2d55" stroke-width="3"/></pattern></defs>`,
  ];

  for (const road of ROADS) parts.push(box(corridor(road), "#2a3340"));
  for (const road of ROADS) parts.push(box(carriageway(road), "#39424f"));

  for (const parcel of PARCELS) {
    const r = footprint(parcel);
    parts.push(box(r, "#3f7d54", "#8fe0ab", 'stroke-width="1.5" fill-opacity="0.75"'));
    parts.push(
      `<text x="${(px(r.x0) + 4).toFixed(1)}" y="${(pz(r.z0) + 13).toFixed(1)}" ` +
        `fill="#dff6e6" font-family="monospace" font-size="10">${parcel.id}</text>`,
    );
  }

  for (const clash of clashes) parts.push(box(clash.area, "url(#clash)", "#ff2d55", 'stroke-width="1.5"'));

  for (const mark of marks) {
    parts.push(
      `<circle cx="${px(mark.x).toFixed(1)}" cy="${pz(mark.z).toFixed(1)}" r="3.2" ` +
        `fill="#ff2d55" fill-opacity="0.9"><title>${mark.was}</title></circle>`,
    );
  }

  const said = [
    clashes.length
      ? `${clashes.length} plot/carriageway overlaps — worst ${clashes[0].depth.toFixed(1)}m (${clashes[0].parcel} on ${clashes[0].road})`
      : `no plot stands on a carriageway`,
    marks.length
      ? `${marks.length} points of road covered by ${[...new Set(marks.map((m) => m.was))].join(", ")}`
      : `nothing is lying on a carriageway`,
  ];
  parts.push(
    `<text x="${PAD}" y="${(h - 28).toFixed(0)}" fill="${clashes.length ? "#ff8fa5" : "#8fe0ab"}" font-family="monospace" font-size="13">${said[0]}</text>`,
    `<text x="${PAD}" y="${(h - 10).toFixed(0)}" fill="${marks.length ? "#ff8fa5" : "#8fe0ab"}" font-family="monospace" font-size="13">${said[1]}</text>`,
    "</svg>",
  );
  return parts.join("\n");
}

const clashes = trespasses(PARCELS, ROADS);
for (const clash of clashes) {
  console.log(
    `${clash.parcel.padEnd(18)} on ${clash.road.padEnd(14)} ${clash.depth.toFixed(1)}m ` +
      `[x ${clash.area.x0.toFixed(1)}..${clash.area.x1.toFixed(1)}, z ${clash.area.z0.toFixed(1)}..${clash.area.z1.toFixed(1)}]`,
  );
}
console.log(clashes.length === 0 ? "clear: no plot stands on a carriageway" : `${clashes.length} overlaps`);

if (clashes.length > 0) {
  console.log("to stand behind the kerb:");
  for (const parcel of PARCELS) {
    const plot = footprint(parcel);
    const fixed = behindTheKerb(parcel, ROADS);
    const moved =
      Math.abs(fixed.x0 - plot.x0) +
      Math.abs(fixed.x1 - plot.x1) +
      Math.abs(fixed.z0 - plot.z0) +
      Math.abs(fixed.z1 - plot.z1);
    if (moved < 0.01) continue;
    const swapped = Math.abs(Math.round(parcel.yaw / (Math.PI / 2)) % 2) === 1;
    const spanX = fixed.x1 - fixed.x0;
    const spanZ = fixed.z1 - fixed.z0;
    console.log(
      `  ${parcel.id.padEnd(18)} centre (${parcel.centre.x}, ${parcel.centre.z}) -> ` +
        `(${((fixed.x0 + fixed.x1) / 2).toFixed(1)}, ${((fixed.z0 + fixed.z1) / 2).toFixed(1)})  ` +
        `width ${parcel.width} -> ${(swapped ? spanZ : spanX).toFixed(1)}  ` +
        `depth ${parcel.depth} -> ${(swapped ? spanX : spanZ).toFixed(1)}`,
    );
  }
}

mkdirSync("artifacts", { recursive: true });
const markup = draw();
writeFileSync("artifacts/city-plan.svg", markup);

// A PNG as well, because the point of this is to be looked at. A static page
// costs a second, unlike the WebGL captures next door.
const { chromium } = await import("@playwright/test");
const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage();
await page.setContent(`<body style="margin:0">${markup}</body>`);
await page.locator("svg").screenshot({ path: resolve("artifacts/city-plan.png") });
await browser.close();
console.log("wrote artifacts/city-plan.svg and artifacts/city-plan.png");
