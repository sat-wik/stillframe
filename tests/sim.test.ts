import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createWorld, spawnEnemy } from '../src/sim/world';
import { playerEye, step } from '../src/sim/step';
import { hashWorld } from '../src/sim/hash';
import { yawTowards } from '../src/sim/vec';
import { STEP_DT, type SimEvent, type StepInput, type WorldState } from '../src/sim/types';
import { input, loadLevel, testLevel } from './helpers';

function aimAt(w: WorldState, target: { x: number; y: number; z: number }): { yaw: number; pitch: number } {
  const eye = playerEye(w);
  return {
    yaw: yawTowards(eye, target),
    pitch: Math.atan2(target.y - eye.y, Math.hypot(target.x - eye.x, target.z - eye.z)),
  };
}

function run(w: WorldState, steps: number, inp: (w: WorldState, i: number) => StepInput = () => input()): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < steps; i++) all.push(...step(w, inp(w, i)));
  return all;
}

function hasNaN(v: unknown): boolean {
  if (typeof v === 'number') return Number.isNaN(v);
  if (Array.isArray(v)) return v.some(hasNaN);
  if (v && typeof v === 'object') return Object.entries(v).some(([k, x]) => k !== 'def' && hasNaN(x));
  return false;
}

const arbInput = fc.record({
  moveX: fc.double({ min: -1, max: 1, noNaN: true }),
  moveY: fc.double({ min: -1, max: 1, noNaN: true }),
  yaw: fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
  pitch: fc.double({ min: -1.5, max: 1.5, noNaN: true }),
  fire: fc.boolean(),
  alt: fc.boolean(),
});

describe('simulation', () => {
  it('is deterministic: the same level, seed and inputs give the same state hash', () => {
    const level = loadLevel('01-first-light');
    const script = (_w: WorldState, i: number) =>
      input({ moveX: Math.sin(i / 50), moveY: Math.cos(i / 70), yaw: Math.sin(i / 90) * 0.6, fire: i % 45 === 0 });
    const a = createWorld(level);
    const b = createWorld(level);
    run(a, 1500, script);
    run(b, 1500, script);
    expect(hashWorld(a)).toBe(hashWorld(b));
    expect(a.step).toBeGreaterThan(0);
  });

  it('different seeds diverge', () => {
    const level = loadLevel('01-first-light');
    const a = createWorld(level, 1);
    const b = createWorld(level, 2);
    run(a, 600);
    run(b, 600);
    expect(hashWorld(a)).not.toBe(hashWorld(b));
  });

  it('property: no NaN ever appears in state', () => {
    const level = loadLevel('02-close-quarters');
    fc.assert(
      fc.property(fc.array(arbInput, { minLength: 1, maxLength: 60 }), fc.integer({ min: 0, max: 1000 }), (inputs, seed) => {
        const w = createWorld(level, seed);
        for (let i = 0; i < 600; i++) step(w, inputs[i % inputs.length]!);
        return !hasNaN(w);
      }),
      { numRuns: 30 },
    );
  });

  it('gunners telegraph for 0.4 s of game time before firing', () => {
    const w = createWorld(testLevel({ playerWeapon: null }));
    const g = spawnEnemy(w, 'gunner', { x: 15, y: 0, z: 16 }, 0, 'pistol');
    g.cooldown = 0;
    let aimSteps = 0;
    for (let i = 0; i < 600; i++) {
      const ev = step(w, input());
      if (w.enemies[0]?.ai.state === 'aim') aimSteps++;
      if (ev.some((e) => e.type === 'shot' && e.owner === 'enemy')) break;
    }
    expect(aimSteps * STEP_DT).toBeGreaterThanOrEqual(0.4 - STEP_DT);
    expect(w.bullets.filter((b) => b.owner === 'enemy')).toHaveLength(1);
  });

  it('a pistol shot kills a gunner and clears the room', () => {
    const w = createWorld(testLevel());
    const g = spawnEnemy(w, 'gunner', { x: 15, y: 0, z: 15 }, 0, 'pistol');
    g.cooldown = 99; // never shoots back
    const aim = aimAt(w, { x: g.pos.x, y: 1.2, z: g.pos.z });
    const events = run(w, 120, (_w, i) => input({ ...aim, fire: i === 0 }));
    expect(events.some((e) => e.type === 'enemyDeath')).toBe(true);
    expect(w.outcome).toBe('won');
    expect(w.player.ammo).toBe(5);
    // The gun drops where the enemy stood.
    expect(w.props.some((p) => p.weapon === 'pistol')).toBe(true);
  });

  it('an enemy bullet kills the player in one hit and records where it came from', () => {
    const w = createWorld(testLevel({ playerWeapon: null }));
    spawnEnemy(w, 'gunner', { x: 15, y: 0, z: 17 }, 0, 'pistol').cooldown = 0;
    run(w, 600);
    expect(w.outcome).toBe('lost');
    expect(w.killedBy?.kind).toBe('bullet');
    if (w.killedBy?.kind === 'bullet') expect(w.killedBy.origin.z).toBeLessThan(18);
  });

  it('player bullets destroy enemy bullets on contact', () => {
    const w = createWorld(testLevel());
    const g = spawnEnemy(w, 'gunner', { x: 15, y: 0, z: 5 }, 0, 'pistol');
    g.stun = 99;
    w.bullets.push({ id: 900, owner: 'enemy', shooter: g.id, pos: { x: 15, y: 1.5, z: 10 }, prevPos: { x: 15, y: 1.5, z: 10 }, origin: { x: 15, y: 1.5, z: 10 }, vel: { x: 0, y: 0, z: 40 }, ttl: 2 });
    w.bullets.push({ id: 901, owner: 'player', shooter: 0, pos: { x: 15, y: 1.5, z: 20 }, prevPos: { x: 15, y: 1.5, z: 20 }, origin: { x: 15, y: 1.5, z: 20 }, vel: { x: 0, y: 0, z: -40 }, ttl: 2 });
    const events = run(w, 30);
    expect(events.some((e) => e.type === 'hit' && e.target === 'bullet')).toBe(true);
    expect(w.bullets).toHaveLength(0);
    expect(w.outcome).toBe('playing');
  });

  it('property: bullets never tunnel through an enemy in the real step loop (up to 60 m/s)', () => {
    fc.assert(
      fc.property(fc.double({ min: 5, max: 60, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (speed, phase) => {
        const w = createWorld(testLevel({ playerWeapon: null }));
        const e = spawnEnemy(w, 'grunt', { x: 15, y: 0, z: 10 }, 0, null);
        e.stun = 99;
        const z = 18 + phase * speed * STEP_DT;
        w.bullets.push({ id: 999, owner: 'player', shooter: 0, pos: { x: 15, y: 1, z }, prevPos: { x: 15, y: 1, z }, origin: { x: 15, y: 1, z }, vel: { x: 0, y: 0, z: -speed }, ttl: 2 });
        run(w, 240);
        return w.kills === 1;
      }),
      { numRuns: 200 },
    );
  });

  it('punching an armed enemy disarms them, and the gun can be grabbed', () => {
    const w = createWorld(testLevel({ playerWeapon: null }));
    const g = spawnEnemy(w, 'gunner', { x: 15, y: 0, z: 24 }, 0, 'pistol');
    g.stun = 99;
    const events = run(w, 1, () => input({ alt: true }));
    expect(events.some((e) => e.type === 'disarm')).toBe(true);
    expect(g.weapon).toBeNull();
    expect(w.props).toHaveLength(1);
    run(w, 60); // let the punch cooldown pass
    run(w, 1, () => input({ alt: true }));
    expect(w.player.weapon).toBe('pistol');
    expect(w.props).toHaveLength(0);
  });

  it('punching an unarmed enemy kills it; heavies take two hits', () => {
    const w = createWorld(testLevel({ playerWeapon: null }));
    const h = spawnEnemy(w, 'heavy', { x: 15, y: 0, z: 24 }, 0, null);
    h.stun = 99;
    run(w, 1, () => input({ alt: true }));
    expect(w.enemies).toHaveLength(1);
    run(w, 60);
    run(w, 1, () => input({ alt: true }));
    expect(w.enemies).toHaveLength(0);
    expect(w.outcome).toBe('won');
  });

  it('killed-count waves spawn after enough kills', () => {
    const w = createWorld(loadLevel('02-close-quarters'));
    expect(w.enemies).toHaveLength(2);
    expect(w.level.pending).toHaveLength(2);
    for (const e of w.enemies) e.stun = 99;
    w.kills = 2;
    w.enemies = [];
    const events = run(w, 1);
    expect(events).toContainEqual({ type: 'wave', id: 1 });
    expect(w.enemies).toHaveLength(2);
    expect(w.outcome).toBe('playing');
  });

  it('a finished world stops stepping', () => {
    const w = createWorld(testLevel());
    step(w, input());
    expect(w.outcome).toBe('won'); // no enemies at all
    const s = w.step;
    step(w, input());
    expect(w.step).toBe(s);
  });
});
