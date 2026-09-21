/** Small shared utilities. No game logic lives here. */

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const sum = (arr: number[]): number => arr.reduce((a, b) => a + b, 0);

/** Format money: 1234 -> "1,234". */
export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function pct(n: number, digits = 0): string {
  return (n * 100).toFixed(digits) + '%';
}

let uidCounter = 0;
/** Deterministic unique id (same call order ⇒ same ids, preserving seed determinism). */
export function uid(prefix = 'id'): string {
  return `${prefix}_${(++uidCounter).toString(36)}`;
}
