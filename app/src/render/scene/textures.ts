import * as THREE from "three";

import { Rng } from "../lib/rng";

/**
 * Procedural surface detail.
 *
 * Every texture here is drawn into a canvas at boot — nothing is downloaded and
 * no image file ships with the spike. They are deliberately low-contrast: the
 * job is to stop large surfaces reading as flat vector fills, not to make the
 * city grimy. Everything stays bright and sunlit.
 *
 * These are sampled in world space (see `bakeWorldUv` in lib/geom), so texel
 * density is constant whether a surface is a kerb or a warehouse wall.
 */

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const element = document.createElement("canvas");
  element.width = size;
  element.height = size;
  return [element, element.getContext("2d")!];
}

function finish(element: HTMLCanvasElement, repeat = 1): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(element);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Value-noise speckle. `strength` is how far from white it is allowed to drift. */
function speckle(size: number, strength: number, seed: string, warm = 0): THREE.CanvasTexture {
  const [element, ctx] = canvas(size);
  const rng = new Rng(seed);
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    // Two octaves: fine grain plus a slow blotch so it does not look like TV static.
    const fine = rng.next();
    const x = i % size;
    const y = Math.floor(i / size);
    const blotch =
      0.5 +
      0.5 *
        Math.sin((x / size) * Math.PI * 2 * 3 + seedPhase(seed)) *
        Math.cos((y / size) * Math.PI * 2 * 2 + seedPhase(seed) * 1.7);
    const v = 1 - strength * (fine * 0.65 + blotch * 0.35);
    const o = i * 4;
    image.data[o] = Math.round(255 * Math.min(1, v + warm * 0.03));
    image.data[o + 1] = Math.round(255 * v);
    image.data[o + 2] = Math.round(255 * Math.max(0, v - warm * 0.02));
    image.data[o + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return finish(element);
}

function seedPhase(seed: string): number {
  return (Rng.hash(seed) % 1000) / 1000 * Math.PI * 2;
}

/** Concrete and render: fine grain with a faint blotch. */
export function concreteGrain(): THREE.CanvasTexture {
  return speckle(256, 0.1, "concrete");
}

/**
 * Open ground: mown and drilled rows over a slow, broad mottle.
 *
 * The plain around the city is hundreds of metres of one material, and at that
 * size a flat fill is unmistakable — it reads as a snooker table. The mottle
 * breaks up the area and the rows give the fields a grain, so a hedge line
 * crossing them looks like it is crossing something. Kept very low contrast:
 * from the default framing this should register as "land", never as pattern.
 */
export function turfGrain(): THREE.CanvasTexture {
  const size = 256;
  const [element, ctx] = canvas(size);
  const rng = new Rng("turf");
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const x = i % size;
    const y = Math.floor(i / size);
    const broad =
      0.5 +
      0.5 *
        Math.sin((x / size) * Math.PI * 2 + 0.7) *
        Math.cos((y / size) * Math.PI * 2 * 1.5 - 0.3);
    const rows = 0.5 + 0.5 * Math.sin((y / size) * Math.PI * 2 * 16);
    const v = 1 - 0.13 * (rng.next() * 0.3 + broad * 0.52 + rows * 0.18);
    const o = i * 4;
    image.data[o] = Math.round(255 * (v - 0.012));
    image.data[o + 1] = Math.round(255 * v);
    image.data[o + 2] = Math.round(255 * (v - 0.02));
    image.data[o + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return finish(element);
}

/** Warmer, slightly coarser grain for painted render and plaster. */
export function renderGrain(): THREE.CanvasTexture {
  return speckle(256, 0.075, "render", 1);
}

/**
 * Paving: grain plus a slab grid.
 *
 * Sampled in world space at one tile per two metres, so the joints land at a
 * believable slab size regardless of which surface it is applied to.
 */
export function pavingSeams(): THREE.CanvasTexture {
  const size = 256;
  const [element, ctx] = canvas(size);
  const rng = new Rng("paving");

  // Base grain.
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = 1 - 0.085 * rng.next();
    const o = i * 4;
    image.data[o] = image.data[o + 1] = image.data[o + 2] = Math.round(255 * v);
    image.data[o + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);

  // Slab joints, drawn soft so they read as a shadow line not a pen stroke.
  ctx.strokeStyle = "rgba(120,120,118,0.34)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const p of [0, size / 2]) {
    ctx.moveTo(p + 0.5, 0);
    ctx.lineTo(p + 0.5, size);
    ctx.moveTo(0, p + 0.5);
    ctx.lineTo(size, p + 0.5);
  }
  ctx.stroke();

  // A few darker slabs, so the grid is not perfectly uniform.
  ctx.fillStyle = "rgba(120,118,112,0.09)";
  for (let i = 0; i < 3; i++) {
    const gx = Math.floor(rng.next() * 2) * (size / 2);
    const gy = Math.floor(rng.next() * 2) * (size / 2);
    ctx.fillRect(gx + 2, gy + 2, size / 2 - 4, size / 2 - 4);
  }

  return finish(element);
}

/** Asphalt: coarser grain, plus faint tyre polish tracks. */
export function asphaltGrain(): THREE.CanvasTexture {
  const size = 256;
  const [element, ctx] = canvas(size);
  const rng = new Rng("asphalt");
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = 1 - 0.15 * rng.next();
    const o = i * 4;
    image.data[o] = image.data[o + 1] = image.data[o + 2] = Math.round(255 * v);
    image.data[o + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  // Lighter polished bands where wheels run.
  ctx.fillStyle = "rgba(255,255,255,0.07)";
  ctx.fillRect(0, size * 0.18, size, size * 0.1);
  ctx.fillRect(0, size * 0.62, size, size * 0.1);
  return finish(element);
}

/** Corrugated metal roofing: soft rib shading, no hard lines. */
export function roofRibs(): THREE.CanvasTexture {
  const size = 128;
  const [element, ctx] = canvas(size);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  for (let x = 0; x < size; x += 8) {
    const gradient = ctx.createLinearGradient(x, 0, x + 8, 0);
    gradient.addColorStop(0, "rgba(140,146,154,0.30)");
    gradient.addColorStop(0.45, "rgba(255,255,255,0.10)");
    gradient.addColorStop(1, "rgba(140,146,154,0.30)");
    ctx.fillStyle = gradient;
    ctx.fillRect(x, 0, 8, size);
  }
  // Faint streaking along the fall.
  const rng = new Rng("roof");
  ctx.fillStyle = "rgba(120,126,134,0.07)";
  for (let i = 0; i < 26; i++) {
    const x = rng.next() * size;
    ctx.fillRect(x, 0, 1.5, size);
  }
  return finish(element);
}

/** Brick: soft courses rather than drawn-on individual bricks. */
export function brickCourses(): THREE.CanvasTexture {
  const size = 256;
  const [element, ctx] = canvas(size);
  const rng = new Rng("brick");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  const courseH = size / 12;
  for (let row = 0; row < 12; row++) {
    const y = row * courseH;
    // Mortar line.
    ctx.fillStyle = "rgba(255,248,238,0.30)";
    ctx.fillRect(0, y, size, 2);
    // Per-brick value drift.
    const offset = row % 2 ? courseH : 0;
    for (let b = 0; b < 8; b++) {
      const x = (b * size) / 8 + offset;
      const v = 0.06 * (rng.next() - 0.5);
      ctx.fillStyle = `rgba(${v > 0 ? "255,255,255" : "80,60,50"},${Math.abs(v) * 3})`;
      ctx.fillRect(x, y + 2, size / 8 - 2, courseH - 3);
    }
  }
  return finish(element);
}

/**
 * Glazing: per-pane value and tint variation.
 *
 * Real glass never reads as one flat sheet — each pane picks up a slightly
 * different slice of sky. This is what stops the sawtooth north lights and the
 * neighbours' window bands looking like painted rectangles.
 */
export function glassPanes(): THREE.CanvasTexture {
  const size = 256;
  const [element, ctx] = canvas(size);
  const rng = new Rng("glass");
  const cells = 4;
  const cell = size / cells;
  for (let gy = 0; gy < cells; gy++) {
    for (let gx = 0; gx < cells; gx++) {
      // Sky gradient per pane, brighter at the top.
      const lift = 0.72 + rng.next() * 0.42;
      const gradient = ctx.createLinearGradient(0, gy * cell, 0, gy * cell + cell);
      gradient.addColorStop(0, `rgba(255,255,255,${0.55 * lift})`);
      gradient.addColorStop(0.55, `rgba(214,232,246,${0.5 * lift})`);
      gradient.addColorStop(1, `rgba(150,178,200,${0.62 * lift})`);
      ctx.fillStyle = gradient;
      ctx.fillRect(gx * cell, gy * cell, cell, cell);
      // Occasional brighter reflection streak.
      if (rng.chance(0.3)) {
        ctx.fillStyle = "rgba(255,255,255,0.28)";
        ctx.save();
        ctx.translate(gx * cell, gy * cell);
        ctx.rotate(-0.5);
        ctx.fillRect(-cell * 0.2, cell * 0.35, cell * 1.6, cell * 0.14);
        ctx.restore();
      }
    }
  }
  // Frame shadow at the cell edges.
  ctx.strokeStyle = "rgba(70,88,104,0.35)";
  ctx.lineWidth = 2;
  for (let i = 0; i <= cells; i++) {
    ctx.beginPath();
    ctx.moveTo(i * cell, 0);
    ctx.lineTo(i * cell, size);
    ctx.moveTo(0, i * cell);
    ctx.lineTo(size, i * cell);
    ctx.stroke();
  }
  return finish(element);
}

/**
 * Water: broad soft swell, kept pale so it stays a bright coastal day.
 *
 * This map scrolls (see `driftWater`), which makes it the one texture here
 * whose job is to be seen moving, and that changes what it has to be made of.
 *
 * It is stretched over about forty-four metres, and the bay sits at two or
 * three pixels a metre, so a 256px tile lands on roughly 150 screen pixels.
 * Anything drawn a few texels tall is therefore sub-pixel by the time it is
 * on screen, and mipmapping and anisotropy quietly average it into flat
 * colour. The version this replaces was built almost entirely of 2-7px bands
 * and duly scrolled a full tile with two separate reviewers reporting the
 * surface as "completely static" — accurately. The features have to be big
 * before they can be seen to move.
 *
 * So the shapes here are broad and soft: a few very wide faint bands that
 * carry the movement at a distance, and narrower ones over the top for
 * texture up close. Everything is drawn three times, a tile above and below
 * as well as in place, because a band clipped at the edge is a seam, and a
 * seam on a still texture is invisible right up until it marches across the
 * bay.
 */
export function waterRipples(): THREE.CanvasTexture {
  const size = 256;
  const [element, ctx] = canvas(size);
  const rng = new Rng("water");

  // This is multiplied against the water colour, so it is a brightness map and
  // not a picture of water: mid-grey is the open surface, white is a crest with
  // the sun on it, dark is the trough behind it.
  //
  // Which means the body has to sit below white. The first version filled this
  // with white and could therefore only ever subtract, so every mark on the bay
  // was a stain on a pale sheet — the one thing water never looks like, because
  // water is a dark body with light on top of it. Sitting the surface at
  // seven-tenths costs a little saturation, paid back by making the water
  // colour brighter, and buys somewhere for a crest to go.
  ctx.fillStyle = "#b3c2cf";
  ctx.fillRect(0, 0, size, size);

  /**
   * One line of swell, drawn column by column so it can wander.
   *
   * A band drawn as a single rectangle is a ruled line, and a bay full of ruled
   * lines scrolling together is a barcode. Two or three cycles of sine across
   * the tile is enough to break that up; whole cycles only, or the tile stops
   * wrapping and the seam runs visibly down the water.
   */
  const swell = (y: number, h: number, colour: string, alpha: number, waves: number, amp: number) => {
    const phase = rng.next() * Math.PI * 2;
    for (let x = 0; x < size; x++) {
      const wander = Math.sin((x / size) * waves * Math.PI * 2 + phase) * amp;
      for (const wrap of [-size, 0, size]) {
        const top = y + wrap + wander;
        const gradient = ctx.createLinearGradient(0, top, 0, top + h);
        gradient.addColorStop(0, `rgba(${colour},0)`);
        gradient.addColorStop(0.5, `rgba(${colour},${alpha})`);
        gradient.addColorStop(1, `rgba(${colour},0)`);
        ctx.fillStyle = gradient;
        ctx.fillRect(x, top, 1, h);
      }
    }
  };

  const CREST = "255,255,255";
  const TROUGH = "38,74,104";

  // The swell: a handful of long crests with their troughs, at four to eight
  // metres once it is on the water. This is the structure that still reads when
  // the whole bay is thirty pixels tall.
  for (let i = 0; i < 5; i++) {
    const at = rng.next() * size;
    swell(at, 26 + rng.next() * 22, CREST, 0.5, 2, 5 + rng.next() * 4);
    swell(at + 22, 30 + rng.next() * 26, TROUGH, 0.3, 2, 5 + rng.next() * 4);
  }
  // Ripples over the top, for when the camera is down among the quays.
  for (let i = 0; i < 16; i++) {
    swell(rng.next() * size, 5 + rng.next() * 9, CREST, 0.24 + rng.next() * 0.2, 3, 3 + rng.next() * 4);
  }
  for (let i = 0; i < 10; i++) {
    swell(rng.next() * size, 6 + rng.next() * 10, TROUGH, 0.16 + rng.next() * 0.12, 3, 3 + rng.next() * 4);
  }
  return finish(element);
}

/**
 * Water: the shimmer, as a normal map.
 *
 * The colour map above can only ever slide. One texture translating across a
 * flat plane moves as a rigid sheet however well it is drawn, and the tell is
 * where it passes under the pier and the quay walls: nothing about the pattern
 * acknowledges them, so the eye stops reading water and starts reading a
 * picture being dragged along behind the city.
 *
 * The fix is a second layer travelling at its own speed and angle, and a
 * normal map is the cheap way to have one. It costs no mesh, no draw call and
 * no triangle — it is a second sampler on a material that was already being
 * drawn — and it perturbs the sun and the sky reflection rather than the
 * colour, which is what actually distinguishes water from painted floor. Where
 * the two layers cross they beat against each other, and the surface stops
 * moving all of a piece.
 *
 * The height field is a sum of sines on integer frequencies, which is what
 * makes it tile: any whole number of periods across the tile meets itself
 * exactly at the seam, and a seam here would be a crease crawling across the
 * bay rather than a static line nobody notices.
 */
export function waterNormals(): THREE.CanvasTexture {
  const size = 128;
  const [element, ctx] = canvas(size);
  const image = ctx.createImageData(size, size);

  // Direction, frequency and amplitude per wave. Crossed at shallow angles so
  // the interference is long and lazy rather than a chequerboard.
  const waves = [
    { fx: 1, fy: 2, amp: 1 },
    { fx: 2, fy: -1, amp: 0.7 },
    { fx: -1, fy: 4, amp: 0.45 },
    { fx: 3, fy: 2, amp: 0.3 },
  ];
  const phase = new Rng("water-normals");
  const phases = waves.map(() => phase.next() * Math.PI * 2);

  const height = (x: number, y: number) => {
    let h = 0;
    for (let i = 0; i < waves.length; i++) {
      const w = waves[i];
      h += w.amp * Math.sin(((w.fx * x + w.fy * y) / size) * Math.PI * 2 + phases[i]);
    }
    return h;
  };

  // Gentle: the brief is a calm bay on a bright day, not a swell at sea.
  const steepness = 0.55;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Central differences, wrapped, so the gradient tiles with the height.
      const dx = (height(x + 1, y) - height(x - 1, y)) * steepness;
      const dy = (height(x, y + 1) - height(x, y - 1)) * steepness;
      const length = Math.hypot(dx, dy, 1);
      const at = (y * size + x) * 4;
      image.data[at] = Math.round(((-dx / length) * 0.5 + 0.5) * 255);
      image.data[at + 1] = Math.round(((-dy / length) * 0.5 + 0.5) * 255);
      image.data[at + 2] = Math.round((1 / length) * 255);
      image.data[at + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = finish(element);
  // A normal map is geometry, not colour, and must not be decoded as sRGB.
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

/** Soft radial darkening, used as a contact-shadow decal under objects. */
export function contactShadow(): THREE.CanvasTexture {
  const size = 128;
  const [element, ctx] = canvas(size);
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(26,32,44,0.60)");
  gradient.addColorStop(0.45, "rgba(26,32,44,0.30)");
  gradient.addColorStop(0.78, "rgba(26,32,44,0.09)");
  gradient.addColorStop(1, "rgba(26,32,44,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(element);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
