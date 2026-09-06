import { chromium } from "@playwright/test";

import { launchOptions, openCity } from "./env.mjs";

/**
 * What is actually in the scene, by group, with sizes.
 *
 * A screenshot says "there is a dark slab there" and nothing else. This says
 * which builder emitted it, how big it is and what material it wears, which is
 * the difference between guessing and knowing.
 *
 *   node capture/audit.mjs [level]
 */

const LEVEL = Number(process.argv[2] ?? 0);
const IDS = [
  "core-landmark",
  "core-north",
  "core-east",
  "core-southeast",
  "forge-hero",
  "forge-north",
  "forge-south",
  "creator-park",
  "creator-terrace",
  "creator-venue",
  "creator-struggling",
];

const browser = await chromium.launch(launchOptions());
const page = await openCity(browser, { scenario: "thriving", ss: 1, view: { width: 900, height: 600 } });
page.on("pageerror", (error) => console.log("PAGE ERROR:", String(error).slice(0, 300)));

await page.evaluate(
  ([ids, level]) => window.__city.setLevels(Object.fromEntries(ids.map((id) => [id, level]))),
  [IDS, LEVEL],
);

const report = await page.evaluate(() => {
  const out = [];

  /** World-space extent of a geometry under a matrix, corner by corner. */
  const extent = (geometry, matrix) => {
    geometry.computeBoundingBox();
    const b = geometry.boundingBox;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    const e = matrix.elements;
    for (let i = 0; i < 8; i++) {
      const x = i & 1 ? b.max.x : b.min.x;
      const y = i & 2 ? b.max.y : b.min.y;
      const z = i & 4 ? b.max.z : b.min.z;
      const p = [
        e[0] * x + e[4] * y + e[8] * z + e[12],
        e[1] * x + e[5] * y + e[9] * z + e[13],
        e[2] * x + e[6] * y + e[10] * z + e[14],
      ];
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], p[a]);
        hi[a] = Math.max(hi[a], p[a]);
      }
    }
    return { lo, hi };
  };

  const walk = (node, trail) => {
    const here = node.name ? `${trail}/${node.name}` : trail;
    if (node.isMesh && node.geometry) {
      node.updateWorldMatrix(true, false);
      const { lo, hi } = extent(node.geometry, node.matrixWorld);
      out.push({
        path: here,
        kind: node.isInstancedMesh ? `instanced x${node.count}` : "mesh",
        material: node.material?.name || `#${node.material?.color?.getHexString?.() ?? "?"}`,
        tris: (node.geometry.index?.count ?? node.geometry.attributes.position?.count ?? 0) / 3,
        size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]].map((n) => +n.toFixed(1)),
        at: [(hi[0] + lo[0]) / 2, (hi[1] + lo[1]) / 2, (hi[2] + lo[2]) / 2].map((n) => +n.toFixed(1)),
      });
    }
    for (const child of node.children) walk(child, here);
  };
  walk(window.__city.scene, "");
  return out;
});

report.sort((a, b) => b.tris - a.tris);
console.log(`${report.length} draw units\n`);
for (const row of report) {
  console.log(
    `${String(Math.round(row.tris)).padStart(7)}  ${row.kind.padEnd(15)} ${row.material.padEnd(12)} ` +
      `size ${JSON.stringify(row.size).padEnd(22)} at ${JSON.stringify(row.at).padEnd(22)} ${row.path}`,
  );
}

await browser.close();
