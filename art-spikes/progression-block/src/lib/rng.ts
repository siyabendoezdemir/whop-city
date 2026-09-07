/**
 * Deterministic pseudo-randomness.
 *
 * Every layout decision in the block runs through one of these, seeded from the
 * lot seed. The same seed must always produce the same city — capture frames
 * and screenshots would be worthless otherwise.
 */
export class Rng {
  private state: number;

  constructor(seed: number | string) {
    this.state = typeof seed === "number" ? seed >>> 0 : Rng.hash(seed);
    if (this.state === 0) this.state = 0x9e3779b9;
  }

  static hash(text: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  /** mulberry32 */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.min(items.length - 1, Math.floor(this.next() * items.length))];
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /** A fresh stream, so adding a prop pass never reshuffles an earlier one. */
  fork(label: string): Rng {
    return new Rng((this.state ^ Rng.hash(label)) >>> 0);
  }
}
