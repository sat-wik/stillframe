import type { WorldState } from './types';

/**
 * Stable 32-bit hash of the dynamic world state, for golden-replay tests and
 * drift detection. Numbers are serialized at full precision, so any bit of
 * float drift changes the hash.
 */
export function hashWorld(w: WorldState): string {
  const json = JSON.stringify({ ...w, level: { pending: w.level.pending, firedWaves: w.level.firedWaves } });
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < json.length; i++) {
    const c = json.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}
