import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createStream, createSimStreams, nextFloat } from '../src/rng/rng';

describe('mulberry32 streams', () => {
  it('is deterministic for a seed', () => {
    const a = createStream(1234);
    const b = createStream(1234);
    for (let i = 0; i < 100; i++) expect(nextFloat(a)).toBe(nextFloat(b));
  });

  it('always returns values in [0, 1)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffffff }), (seed) => {
        const s = createStream(seed);
        for (let i = 0; i < 50; i++) {
          const v = nextFloat(s);
          if (!(v >= 0 && v < 1)) return false;
        }
        return true;
      }),
    );
  });

  it('gives each subsystem an independent stream', () => {
    const s = createSimStreams(42);
    expect(nextFloat(s.ai)).not.toBe(nextFloat(s.spread));
  });
});
