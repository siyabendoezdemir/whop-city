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

/** Water: broad soft ripple bands, kept pale so it stays a bright coastal day. */
export function waterRipples(): THREE.CanvasTexture {
  const size = 256;
  const [element, ctx] = canvas(size);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  const rng = new Rng("water");
  // Strong enough to read as moving water when the map scrolls. The first pass
  // used 6-20% alpha, which scrolled invisibly — a texture you cannot see is a
  // texture you cannot animate.
  for (let i = 0; i < 34; i++) {
    const y = rng.next() * size;
    const h = 2 + rng.next() * 7;
    ctx.fillStyle = `rgba(255,255,255,${0.3 + rng.next() * 0.42})`;
    ctx.fillRect(0, y, size, h);
  }
  for (let i = 0; i < 20; i++) {
    const y = rng.next() * size;
    ctx.fillStyle = "rgba(46,96,140,0.34)";
    ctx.fillRect(0, y, size, 2 + rng.next() * 5);
  }
  // A couple of long glints, which catch the eye as the map moves.
  for (let i = 0; i < 5; i++) {
    const y = rng.next() * size;
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillRect(rng.next() * size * 0.5, y, size * (0.3 + rng.next() * 0.4), 2);
  }
  return finish(element);
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
