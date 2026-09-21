/**
 * Deterministic seeded RNG. Every simulation roll goes through an Rng instance
 * so that a given seed + action sequence always reproduces the same world —
 * required for the Weekly Challenge and save-scum-resistant design.
 */
export class Rng {
  private s: number;

  constructor(seed: number | string) {
    this.s = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
    if (this.s === 0) this.s = 0x9e3779b9;
  }

  /** Raw 32-bit mulberry32 draw. */
  private next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Float in [0,1). */
  float(): number {
    return this.next();
  }

  /** Float in [min,max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Integer in [min,max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Fisher-Yates on a copy. */
  shuffled<T>(arr: readonly T[]): T[] {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** Weighted pick; weights need not sum to 1. Returns undefined if empty. */
  weighted<T>(items: readonly T[], weight: (item: T) => number): T | undefined {
    let total = 0;
    for (const it of items) total += Math.max(0, weight(it));
    if (total <= 0) return undefined;
    let r = this.next() * total;
    for (const it of items) {
      r -= Math.max(0, weight(it));
      if (r <= 0) return it;
    }
    return items[items.length - 1];
  }

  /** Approximate normal distribution via sum of uniforms. */
  gauss(mean = 0, sd = 1): number {
    const u = this.next() + this.next() + this.next() + this.next();
    return mean + (u - 2) * sd;
  }

  /** Derive an independent child stream keyed by a label (stable per seed). */
  derive(label: string | number): Rng {
    return new Rng((hashString(String(label)) ^ this.s) >>> 0);
  }

  /** Snapshot/restore for speculative rolls. */
  getState(): number {
    return this.s;
  }
  setState(s: number): void {
    this.s = s >>> 0;
  }
}

/** FNV-1a string hash. */
export function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Human-friendly seed words, e.g. "amber-heron-41". */
const SEED_A = ['amber', 'salt', 'silk', 'iron', 'ashen', 'gilded', 'silent', 'windy', 'old', 'brass', 'indigo', 'honeyed'];
const SEED_B = ['heron', 'camel', 'sparrow', 'jackal', 'crane', 'serpent', 'falcon', 'moth', 'ibis', 'wolf', 'carp', 'lion'];

export function randomSeedPhrase(): string {
  const a = SEED_A[Math.floor(Math.random() * SEED_A.length)];
  const b = SEED_B[Math.floor(Math.random() * SEED_B.length)];
  return `${a}-${b}-${Math.floor(Math.random() * 90 + 10)}`;
}
