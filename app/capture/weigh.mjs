/**
 * Where the triangles are.
 *
 * Walks the built scene and totals geometry by the group it hangs under, so a
 * budget overrun can be attributed instead of guessed at.
 *
 *   node capture/weigh.mjs
 */
import { chromium } from "@playwright/test";

const base = process.env.CITY_BASE ?? "http://localhost:3000";

const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${base}/?scenario=thriving&ss=1&capture=1`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => Boolean(window.__city?.ready), null, { timeout: 120_000 });
await page.waitForFunction(() => (window.__city?.info().parcels ?? 0) > 0, null, { timeout: 120_000 });

const rows = await page.evaluate(() => {
  const totals = {};
  window.__city.scene.traverse((child) => {
    const geometry = child.geometry;
    if (!geometry?.attributes?.position) return;
    const index = geometry.index;
    const per = index ? index.count / 3 : geometry.attributes.position.count / 3;
    const count = child.count ?? 1;
    let label = child.name || "?";
    for (let node = child.parent; node; node = node.parent) {
      if (node.name) label = `${node.name}/${label}`;
    }
    const key = label.split("/").slice(0, 3).join("/");
    const bucket = (totals[key] ??= { triangles: 0, meshes: 0, instances: 0 });
    bucket.triangles += per * count;
    bucket.meshes += 1;
    bucket.instances += count;
  });
  return Object.entries(totals)
    .map(([key, value]) => ({ key, ...value, triangles: Math.round(value.triangles) }))
    .sort((a, b) => b.triangles - a.triangles);
});

const total = rows.reduce((sum, row) => sum + row.triangles, 0);
for (const row of rows) {
  console.log(
    `${String(row.triangles).padStart(8)}  ${String(row.meshes).padStart(4)} mesh  ${String(row.instances).padStart(5)} inst  ${row.key}`,
  );
}
console.log(`${String(total).padStart(8)}  total`);
console.log(JSON.stringify(await page.evaluate(() => window.__city.info())));

await browser.close();
