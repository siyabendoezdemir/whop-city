import type * as THREE from "three";

/**
 * Water, tried several ways at once.
 *
 * Getting a surface to read as water is not a thing anyone gets right by
 * reasoning about roughness values. It needs looking at, and looking at one
 * setting at a time across a four-minute build each is how an afternoon
 * disappears without a decision.
 *
 * So this reaches into the running scene, finds the water material by name,
 * and renders the same stretch of bay once per candidate — same camera, same
 * clock, same light — then tiles the crops into one sheet. Nine settings side
 * by side, at the framing the game is actually played at, in about the time
 * one rebuild would take.
 *
 *   pnpm water                    # the default sweep
 *   WATER_SET=tone pnpm water     # a named sweep
 */

import { mkdirSync } from "node:fs";

import { chromium } from "@playwright/test";

import { launchOptions, openCity } from "./env.mjs";

/** One candidate. Anything omitted is left as the scene built it. */
type Try = {
  readonly name: string;
  readonly colour?: string;
  readonly roughness?: number;
  readonly metalness?: number;
  readonly env?: number;
  readonly normal?: number;
  /** Metres across one tile of the ripple map. */
  readonly tile?: number;
  /** Push the fog wall out by this many units, to see what is under it. */
  readonly clear?: number;
};

const SETS: Record<string, Try[]> = {
  /** Where the water stands, against the two moves that fixed it. */
  default: [
    { name: "as-is" },
    { name: "old mirror", roughness: 0.24, metalness: 0.1, env: 1 },
    { name: "old tile", tile: 44 },
    { name: "old both", roughness: 0.24, metalness: 0.1, env: 1, tile: 44 },
  ],

  /**
   * How much of the surface is reflection rather than water.
   *
   * The ladder that found the original fault: at the top of it the bay is
   * almost entirely sky, so the water colour barely reaches the screen and no
   * amount of retinting it does anything. Worth re-running after any change to
   * the sky or the light, both of which feed it.
   */
  mirror: [
    { name: "r.24 e1.0 m.1", roughness: 0.24, metalness: 0.1, env: 1 },
    { name: "r.24 e0.5 m.1", roughness: 0.24, metalness: 0.1, env: 0.5 },
    { name: "r.42 e0.5 m0", roughness: 0.42, metalness: 0, env: 0.5 },
    { name: "r.42 e0.2 m0 (now)", roughness: 0.42, metalness: 0, env: 0.2 },
    { name: "r.65 e0.2 m0", roughness: 0.65, metalness: 0, env: 0.2 },
    { name: "r.8 e0 m0", roughness: 0.8, metalness: 0, env: 0 },
  ],

  /** How wide a swell should be. Too wide and there is no ripple in frame. */
  tile: [
    { name: "9m" , tile: 9 },
    { name: "14m (now)", tile: 14 },
    { name: "20m", tile: 20 },
    { name: "30m", tile: 30 },
    { name: "44m (old)", tile: 44 },
  ],

  /** Is it the water or is it the weather? Same water, fog wall walked back. */
  fog: [
    { name: "fog as-is" },
    { name: "fog +400", clear: 400 },
    { name: "no fog", clear: 100_000 },
  ],
};

const set = SETS[process.env.WATER_SET ?? "default"];
if (!set) throw new Error(`no sweep called ${process.env.WATER_SET}`);

mkdirSync(".frames/water", { recursive: true });

const browser = await chromium.launch(launchOptions());
const page = await openCity(browser, {
  scenario: "thriving",
  ss: 1,
  view: { width: 1200, height: 760 },
});
await page.addStyleTag({
  content:
    ".crest,.res,.corner,.rail,.feed,.pops,.camera,.nudge,.toast,.ready,.quest,.card,.away{display:none!important}",
});
for (let i = 0; i < 24; i++) await page.evaluate(() => window.__city!.frame("commerce-core", 0));

for (const attempt of set) {
  await page.evaluate((candidate: Try) => {
    const city = window.__city!;
    // The scene merges by material, so there is exactly one water material and
    // finding it by name is the whole job.
    let water: THREE.MeshStandardMaterial | null = null;
    (city.scene as THREE.Object3D).traverse((object) => {
      const material = (object as THREE.Mesh).material;
      for (const m of Array.isArray(material) ? material : [material]) {
        if (m && (m as THREE.Material).name === "water") {
          water = m as THREE.MeshStandardMaterial;
        }
      }
    });
    if (!water) throw new Error("no material named water in the scene");
    const w = water as THREE.MeshStandardMaterial;
    const scene = city.scene as THREE.Scene & { fog: THREE.Fog | null };
    const weather = (window as unknown as { __fog?: THREE.Fog }).__fog ?? scene.fog!;
    (window as unknown as { __fog?: THREE.Fog }).__fog = weather;
    if (candidate.clear !== undefined) {
      scene.fog = Object.assign(Object.create(Object.getPrototypeOf(weather)), weather, {
        near: weather.near + candidate.clear,
        far: weather.far + candidate.clear,
      }) as THREE.Fog;
    } else scene.fog = weather;
    if (candidate.colour) w.color.set(candidate.colour);
    if (candidate.roughness !== undefined) w.roughness = candidate.roughness;
    if (candidate.metalness !== undefined) w.metalness = candidate.metalness;
    if (candidate.env !== undefined) w.envMapIntensity = candidate.env;
    if (candidate.normal !== undefined) w.normalScale.set(candidate.normal, candidate.normal);
    if (candidate.tile !== undefined) {
      // World UVs are half a unit per metre, so one tile spans 2 / repeat.
      const repeat = 2 / candidate.tile;
      w.map?.repeat.set(repeat, repeat);
      w.normalMap?.repeat.set(repeat * 0.7, repeat * 0.7);
    }
    w.needsUpdate = true;
    city.frame("commerce-core", 26);
  }, attempt);

  const file = `.frames/water/${attempt.name.replace(/[^a-z0-9]+/gi, "-")}.png`;
  await page.screenshot({ path: file, timeout: 300_000 });
  console.log(`${file}  ${attempt.name}`);
}

await browser.close();
console.log(`${set.length} renders in .frames/water — tile them to compare`);
