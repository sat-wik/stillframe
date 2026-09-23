import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { closestSegmentSegment, movingPointsClosest, resolveCapsule, segmentBox, segmentCapsule, segmentCylinder } from '../src/sim/collision';
import { STEP_DT } from '../src/sim/types';

const box = { min: { x: 4, y: 0, z: 4 }, max: { x: 6, y: 3, z: 6 } };
const bounds = { w: 20, d: 20 };

describe('capsule vs AABB sliding', () => {
  it('pushes a capsule out of a box', () => {
    const p = { x: 3.8, y: 0, z: 5 };
    resolveCapsule(p, 0.35, 1.8, [box], [], bounds);
    expect(p.x).toBeCloseTo(4 - 0.35, 6);
    expect(p.z).toBeCloseTo(5, 6);
  });

  it('slides along a wall instead of stopping', () => {
    const p = { x: 3.8, y: 0, z: 5 };
    p.z -= 0.1; // moving diagonally into the wall
    resolveCapsule(p, 0.35, 1.8, [box], [], bounds);
    expect(p.z).toBeCloseTo(4.9, 6);
  });

  it('keeps a capsule inside the level bounds', () => {
    const p = { x: -3, y: 0, z: 25 };
    resolveCapsule(p, 0.35, 1.8, [], [], bounds);
    expect(p).toEqual({ x: 0.35, y: 0, z: 20 - 0.35 });
  });

  it('ignores boxes the capsule passes over or under', () => {
    const low = { min: { x: 4, y: 2, z: 4 }, max: { x: 6, y: 3, z: 6 } };
    const p = { x: 5, y: 0, z: 5 };
    resolveCapsule(p, 0.35, 1.8, [low], [], bounds);
    expect(p).toEqual({ x: 5, y: 0, z: 5 });
  });
});

describe('swept tests', () => {
  it('segment vs box returns the entry parameter', () => {
    expect(segmentBox({ x: 0, y: 1, z: 5 }, { x: 10, y: 1, z: 5 }, box)).toBeCloseTo(0.4, 6);
    expect(segmentBox({ x: 0, y: 5, z: 5 }, { x: 10, y: 5, z: 5 }, box)).toBeNull();
  });

  it('segment vs cylinder hits side and top', () => {
    const c = { center: { x: 5, y: 0, z: 5 }, r: 1, h: 2 };
    expect(segmentCylinder({ x: 0, y: 1, z: 5 }, { x: 10, y: 1, z: 5 }, c)).toBeCloseTo(0.4, 6);
    expect(segmentCylinder({ x: 5, y: 4, z: 5 }, { x: 5, y: 0, z: 5 }, c)).toBeCloseTo(0.5, 6);
    expect(segmentCylinder({ x: 0, y: 3, z: 5 }, { x: 10, y: 3, z: 5 }, c)).toBeNull();
  });

  it('closest points between parallel and crossing segments', () => {
    const r = closestSegmentSegment({ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 1, y: 1, z: -1 }, { x: 1, y: 1, z: 1 });
    expect(r.dist2).toBeCloseTo(1, 6);
    expect(r.s).toBeCloseTo(0.5, 6);
  });

  it('moving points meet when paths cross at the same time', () => {
    const r = movingPointsClosest({ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 });
    expect(r.dist).toBeCloseTo(0, 6);
    expect(r.t).toBeCloseTo(0.5, 6);
  });

  it('property: bullets never tunnel through a capsule at any speed up to 60 m/s', () => {
    // A thin enemy (radius 0.25) straight ahead; the bullet's single step
    // starts anywhere before it and ends anywhere past it.
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 60, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: -0.2, max: 0.2, noNaN: true }),
        fc.double({ min: 0.3, max: 1.7, noNaN: true }),
        (speed, phase, lateral, height) => {
          const stepLen = speed * STEP_DT;
          const feet = { x: 0, y: 0, z: 0 };
          // Start so the capsule center lies somewhere inside this step's sweep.
          const z0 = 0.25 + phase * stepLen;
          const p0 = { x: lateral, y: height, z: z0 };
          const p1 = { x: lateral, y: height, z: z0 - stepLen - 0.5 };
          return segmentCapsule(p0, p1, feet, 0.25, 1.8) !== null;
        },
      ),
    );
  });
});
