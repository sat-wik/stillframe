import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DEFAULT_TIME_CONFIG as cfg } from '../src/time/config';
import { decayActionPulse, targetTimeScale, updateTimeScale } from '../src/time/controller';

const still = { moveMag: 0, lookSpeed: 0, actionPulse: 0 };
const walking = { moveMag: 1, lookSpeed: 0, actionPulse: 0 };

describe('time controller', () => {
  it('rests at the floor when standing still, never at zero', () => {
    expect(targetTimeScale(still, cfg)).toBe(cfg.floor);
    let s = 1;
    for (let i = 0; i < 600; i++) s = updateTimeScale(s, still, cfg, 1 / 60);
    expect(s).toBeCloseTo(cfg.floor, 5);
    expect(s).toBeGreaterThan(0);
  });

  it('reaches full speed when walking', () => {
    let s = cfg.floor;
    for (let i = 0; i < 60; i++) s = updateTimeScale(s, walking, cfg, 1 / 60);
    expect(s).toBeCloseTo(1, 3);
  });

  it('never snaps: one frame moves only part of the way', () => {
    const s = updateTimeScale(cfg.floor, walking, cfg, 1 / 60);
    expect(s).toBeGreaterThan(cfg.floor);
    expect(s).toBeLessThan(0.5);
  });

  it('rises faster than it falls', () => {
    const up = updateTimeScale(0.5, walking, cfg, 1 / 60) - 0.5;
    const down = 0.5 - updateTimeScale(0.5, still, cfg, 1 / 60);
    expect(up / (1 - 0.5)).toBeGreaterThan(down / (0.5 - cfg.floor));
  });

  it('looking alone advances time only a little', () => {
    const t = targetTimeScale({ moveMag: 0, lookSpeed: 1, actionPulse: 0 }, cfg);
    expect(t).toBeCloseTo(cfg.base + cfg.kLook, 6);
  });

  it('decays the action pulse over its real-time window', () => {
    expect(decayActionPulse(1, cfg, cfg.actionDecayMs / 2000)).toBeCloseTo(0.5, 6);
    expect(decayActionPulse(1, cfg, 1)).toBe(0);
  });

  it('property: time scale always stays in [floor, 1], even for junk input', () => {
    const num = fc.oneof(fc.double(), fc.constant(NaN), fc.constant(Infinity), fc.constant(-Infinity));
    fc.assert(
      fc.property(num, num, num, num, num, (prev, m, l, a, dt) => {
        const s = updateTimeScale(prev, { moveMag: m, lookSpeed: l, actionPulse: a }, cfg, dt);
        return s >= cfg.floor && s <= 1;
      }),
    );
  });
});

describe('looking without moving', () => {
  it('moves time a little: faster than standing still, far slower than walking', () => {
    // A steady scan at 1.5 rad/s, held for a second of real time.
    const look = { moveMag: 0, lookSpeed: 1.5 / cfg.lookFullSpeed, actionPulse: 0 };
    let s = cfg.floor;
    for (let i = 0; i < 60; i++) s = updateTimeScale(s, look, cfg, 1 / 60);
    expect(s).toBeGreaterThan(0.1);
    expect(s).toBeLessThan(0.35);
  });
});
