// Seeded mulberry32. State is a plain uint32 so it can live inside WorldState
// and be snapshotted, hashed and restored with everything else.

export interface RngStream {
  state: number;
}

export function createStream(seed: number): RngStream {
  return { state: seed >>> 0 };
}

/** Returns a float in [0, 1) and advances the stream. */
export function nextFloat(s: RngStream): number {
  s.state = (s.state + 0x6d2b79f5) >>> 0;
  let t = s.state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function nextRange(s: RngStream, min: number, max: number): number {
  return min + (max - min) * nextFloat(s);
}

/** Approximately normal, mean 0, std-dev 1 (sum of 4 uniforms). */
export function nextGaussian(s: RngStream): number {
  return (nextFloat(s) + nextFloat(s) + nextFloat(s) + nextFloat(s) - 2) * 1.7320508;
}

/** Derive independent child seeds from one run seed (splitmix-style). */
export function deriveSeed(seed: number, salt: number): number {
  let z = (seed ^ Math.imul(salt + 1, 0x9e3779b9)) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
  return (z ^ (z >>> 16)) >>> 0;
}

/** Gameplay streams. Cosmetic debris lives in the renderer on its own stream. */
export interface SimStreams {
  ai: RngStream;
  spread: RngStream;
}

export function createSimStreams(seed: number): SimStreams {
  return { ai: createStream(deriveSeed(seed, 1)), spread: createStream(deriveSeed(seed, 2)) };
}

/** Stable 32-bit hash of a string (FNV-1a), used to seed runs from level ids. */
export function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
