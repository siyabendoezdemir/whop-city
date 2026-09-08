import type * as THREE from "three";

/**
 * Yours, tried several ways at once.
 *
 * The complaint this exists to answer is "it's hard to tell which plots are my
 * buildings and which are scenery", and it is a fair one: the eleven playable
 * plots and the backdrop massing are drawn from the same six body materials, so
 * there is nothing in the frame that separates them. Which cue fixes that is
 * not a thing to reason about in the abstract — a treatment that looks decisive
 * in a close-up can vanish at the framing the game is played at, and one that
 * separates a grown city can do nothing for an empty one.
 *
 * So this reaches into the running scene and repaints it per candidate, the way
 * the water sweep does. Two levers, because they are the two halves of the
 * question:
 *
 *   **hold the scenery back** — the backdrop keeps its own clones of the body
 *   materials, moved toward grey (`mute`) or toward the sky (`haze`), so the
 *   playable core is the only saturated thing in the frame
 *
 *   **mark the ground** — the eleven parcel pads take a shared tint, so the
 *   plots read as a set even at level nought when there is nothing on them
 *
 * Shot at levels 0 and 3 because those are the hard ones. At five your towers
 * out-top the backdrop and the problem half solves itself.
 *
 *   pnpm own                    # the default sweep
 *   OWN_SET=mute pnpm own       # a named sweep
 *   OWN_LEVELS=0,3,5 pnpm own   # different levels
 */

import { mkdirSync } from "node:fs";

import { chromium } from "@playwright/test";

import { launchOptions, openCity } from "./env.mjs";

/** One candidate. Anything omitted is left as the scene built it. */
type Try = {
  readonly name: string;
  /**
   * Paint the backdrop in the player's own body colours.
   *
   * How the city looked before it had a backdrop palette, reconstructed from
   * the running build rather than from a screenshot taken before the change —
   * the colours are copied off the playable materials by name, so this cannot
   * drift out of date the way a checked-in "before" image does.
   */
  readonly shared?: boolean;
  /** 0..1. How far the backdrop bodies move toward their own grey. */
  readonly mute?: number;
  /**
   * 0..1. How far the backdrop bodies move toward cool, at constant value.
   *
   * The drain alone cannot separate a cream: `renderCream` and `plaster` start
   * near neutral, so taking their saturation away leaves them where they were,
   * and a backdrop block in cream still reads as one of yours. Warm against
   * cool is the separation those two have left. Renormalised to the luminance
   * it started at, so the massing keeps its light and dark faces.
   */
  readonly cool?: number;
  /** 0..1. How far the backdrop bodies move toward the sky. */
  readonly haze?: number;
  /** A shared tint for the eleven parcel pads. */
  readonly pad?: string;
  /**
   * Paint every backdrop body one flat colour.
   *
   * Not a candidate treatment — a diagnostic. Two pale surfaces can differ by
   * more than the render shows and still leave you squinting at a crop trying
   * to decide whether anything changed; flagging answers "which of these blocks
   * is even backdrop" outright, so a treatment can be judged on the geometry it
   * actually applies to.
   */
  readonly flag?: string;
};

/** Which playable material each backdrop one was drained from. */
const FROM: Record<string, string> = {
  backdropBrick: "brick",
  backdropBrickDark: "brickDark",
  backdropCream: "renderCream",
  backdropTeal: "renderTeal",
  backdropClay: "renderClay",
  backdropPlaster: "plaster",
};

const SETS: Record<string, Try[]> = {
  /** Where the backdrop stands, against the palette it used to share. */
  default: [
    { name: "one palette (before)", shared: true },
    { name: "drained (now)" },
  ],

  /** Each lever alone and together, on top of what is built. */
  levers: [
    { name: "as-is" },
    { name: "mute .5", mute: 0.5 },
    { name: "haze .35", haze: 0.35 },
    { name: "pad", pad: "#c9b79a" },
    { name: "mute .5 + haze .25", mute: 0.5, haze: 0.25 },
    { name: "mute .5 + haze .25 + pad", mute: 0.5, haze: 0.25, pad: "#c9b79a" },
  ],

  /** What is backdrop and what is yours, with nothing left to interpret. */
  flag: [{ name: "flagged" }, { name: "flagged", flag: "#ff2d6f" }],

  /** Warm against cool, once the drain has done what it can. */
  cool: [
    { name: "0", cool: 0 },
    { name: ".35", cool: 0.35 },
    { name: ".6", cool: 0.6 },
    { name: "1", cool: 1 },
    { name: "1 + mute .3", cool: 1, mute: 0.3 },
  ],

  /** How far the backdrop can be drained before the city looks dead. */
  mute: [
    { name: "0", mute: 0 },
    { name: ".25", mute: 0.25 },
    { name: ".4", mute: 0.4 },
    { name: ".55", mute: 0.55 },
    { name: ".7", mute: 0.7 },
    { name: ".85", mute: 0.85 },
  ],

  /** Aerial perspective: backdrop lifted toward the sky rather than drained. */
  haze: [
    { name: "0", haze: 0 },
    { name: ".2", haze: 0.2 },
    { name: ".35", haze: 0.35 },
    { name: ".5", haze: 0.5 },
    { name: ".65", haze: 0.65 },
  ],

  /** What colour reads as "this ground is yours" without reading as paint. */
  pad: [
    { name: "as-is", mute: 0.5, haze: 0.25 },
    { name: "stone", mute: 0.5, haze: 0.25, pad: "#c9b79a" },
    { name: "sand", mute: 0.5, haze: 0.25, pad: "#d8c49b" },
    { name: "warm grey", mute: 0.5, haze: 0.25, pad: "#bdb3a6" },
    { name: "clay", mute: 0.5, haze: 0.25, pad: "#c6a184" },
  ],
};

const set = SETS[process.env.OWN_SET ?? "default"];
if (!set) throw new Error(`no sweep called ${process.env.OWN_SET}`);
const levels = (process.env.OWN_LEVELS ?? "0,3").split(",").map(Number);

mkdirSync(".frames/own", { recursive: true });

const browser = await chromium.launch(launchOptions());
// Reduced motion, which is the product's own way of skipping the founding
// sweep. Markers are held back for the whole of that sweep, so without it every
// frame here is a city with no markers on it whatever the business has done.
const context = await browser.newContext({
  viewport: { width: 1200, height: 760 },
  deviceScaleFactor: 1,
  reducedMotion: "reduce",
});
const page = await openCity(browser, { scenario: "thriving", ss: 1, context });
// The HUD is not the subject and it covers three corners of the city.
await page.addStyleTag({
  content:
    ".crest,.res,.corner,.rail,.feed,.pops,.camera,.nudge,.toast,.ready,.quest,.card,.away{display:none!important}",
});

for (const level of levels) {
  await page.evaluate((value: number) => {
    const city = window.__city!;
    city.setLevels(Object.fromEntries(city.plotIds.map((id) => [id, value])));
  }, level);

  for (const attempt of set) {
    await page.evaluate(({ candidate, from }: { candidate: Try; from: Record<string, string> }) => {
      const city = window.__city!;
      const scene = city.scene as THREE.Scene;

      type Painted = THREE.MeshStandardMaterial & { __base?: THREE.Color };
      const each = (root: THREE.Object3D | undefined, fn: (m: Painted) => void) => {
        root?.traverse((object) => {
          const held = (object as THREE.Mesh).material;
          if (!held) return;
          for (const m of Array.isArray(held) ? held : [held]) fn(m as Painted);
        });
      };

      /**
       * The backdrop shares its material instances with the playable buildings,
       * so repainting in place would repaint both and prove nothing. Each
       * backdrop mesh gets its own clone the first time through, kept on the
       * mesh so a later candidate repaints the clone rather than stacking a
       * second one.
       */
      const backdrop = scene.getObjectByName("surroundings");
      backdrop?.traverse((object) => {
        const mesh = object as THREE.Mesh & { __mine?: boolean };
        if (!mesh.material || mesh.__mine) return;
        const held = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mesh.material = Array.isArray(mesh.material)
          ? held.map((m) => m.clone())
          : held[0].clone();
        mesh.__mine = true;
      });

      // Remember every original colour once, so each candidate starts clean.
      each(backdrop, (m) => {
        if (!m.color) return;
        m.__base ??= m.color.clone();
      });
      each(scene.getObjectByName("parcel-ground"), (m) => {
        if (!m.color) return;
        m.__base ??= m.color.clone();
      });

      // The playable half still holds the undrained colours, so "before" is a
      // lookup rather than a remembered number. It only finds a colour that is
      // standing somewhere in the scene, so `shared` wants a level where the
      // plots are built — on an empty city there are no brick walls to read.
      const playable = new Map<string, THREE.Color>();
      each(scene, (m) => {
        if (m.color && m.name && !playable.has(m.name)) playable.set(m.name, m.color.clone());
      });

      const sky = (scene.fog?.color ?? null) as THREE.Color | null;
      each(backdrop, (m) => {
        const base = m.__base;
        if (!base) return;
        m.color.copy(base);
        if (candidate.shared) {
          const was = playable.get(from[m.name] ?? "");
          if (was) m.color.copy(was);
        }
        if (candidate.mute) {
          // Toward its own luminance: drains the colour, keeps the value, so
          // the massing does not flatten into one grey block.
          const grey = base.r * 0.2126 + base.g * 0.7152 + base.b * 0.0722;
          m.color.lerp(m.color.clone().setRGB(grey, grey, grey), candidate.mute);
        }
        if (candidate.cool) {
          const lum = (c: THREE.Color) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
          const before = lum(m.color);
          const tint = m.color.clone().multiply({ r: 0.9, g: 0.98, b: 1.12 } as THREE.Color);
          const after = lum(tint);
          if (after > 0) tint.multiplyScalar(before / after);
          m.color.lerp(tint, candidate.cool);
        }
        if (candidate.haze && sky) m.color.lerp(sky, candidate.haze);
        if (candidate.flag) m.color.set(candidate.flag);
        m.needsUpdate = true;
      });

      each(scene.getObjectByName("parcel-ground"), (m) => {
        const base = m.__base;
        if (!base) return;
        m.color.copy(base);
        // Only the plot surfaces, not the kerbs and party walls that sit on
        // them — a pad reads as ground, a repainted wall reads as a bug.
        const pad = m.name === "concrete" || m.name === "sidewalk" || m.name === "yardApron";
        if (candidate.pad && pad) m.color.set(candidate.pad);
        m.needsUpdate = true;
      });

      city.frame("city", 26);
    }, { candidate: attempt, from: FROM });

    // Which eleven are actually the player's, marked from the renderer's own
    // answer rather than from reading the picture. Without it the sweep can
    // only show that *something* separated, not that the thing which separated
    // is the thing you own.
    if (process.env.OWN_MARK) {
      await page.evaluate(() => {
        document.querySelectorAll(".own-mark").forEach((node) => node.remove());
        for (const id of window.__city!.plotIds) {
          const at = window.__city!.plotGround(id);
          if (!at) continue;
          const dot = document.createElement("div");
          dot.className = "own-mark";
          dot.textContent = id;
          dot.style.cssText = `position:fixed;left:${at.x}px;top:${at.y}px;transform:translate(-50%,-50%);z-index:9999;background:#ff2d6f;color:#fff;font:600 10px/1.5 monospace;padding:1px 5px;border-radius:9px;white-space:nowrap;pointer-events:none`;
          document.body.append(dot);
        }
      });
    }

    const slug = attempt.name.replace(/[^a-z0-9]+/gi, "-");
    const file = `.frames/own/l${level}-${slug}.png`;
    await page.screenshot({ path: file, timeout: 300_000 });
    console.log(`${file}  ${attempt.name}`);
  }
}

await browser.close();
console.log(`${set.length * levels.length} renders in .frames/own — tile them to compare`);
