import { describe, expect, it } from 'vitest';
import { THROW } from '../src/content/defs';
import { playerEye, step } from '../src/sim/step';
import { hashWorld } from '../src/sim/hash';
import { yawTowards } from '../src/sim/vec';
import { createWorld, spawnEnemy } from '../src/sim/world';
import type { SimEvent, StepInput, WorldState } from '../src/sim/types';
import { input, testLevel } from './helpers';

function run(w: WorldState, steps: number, inp: (i: number) => StepInput = () => input()): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < steps; i++) all.push(...step(w, inp(i)));
  return all;
}

function aimAt(w: WorldState, t: { x: number; y: number; z: number }) {
  const eye = playerEye(w);
  return { yaw: yawTowards(eye, t), pitch: Math.atan2(t.y - eye.y, Math.hypot(t.x - eye.x, t.z - eye.z)) - THROW.loft };
}

/** A world with the player unarmed and a prop at their feet, facing -Z. */
function withProp(kind: 'bottle' | 'chair' | 'gun') {
  const w = createWorld(testLevel({ playerWeapon: null }));
  w.props.push({ id: 500, kind, pos: { x: 15, y: 0, z: 24.2 }, weapon: kind === 'gun' ? 'pistol' : null, ammo: 0 });
  // A room with no enemies is already won and stops stepping; park one, stunned, in a corner.
  spawnEnemy(w, 'grunt', { x: 1, y: 0, z: 1 }, 0, null).stun = 1e9;
  return w;
}

describe('throwing', () => {
  it('grabs a prop in reach with RMB', () => {
    const w = withProp('bottle');
    const ev = run(w, 1, () => input({ alt: true }));
    expect(w.player.item).toBe('bottle');
    expect(w.props).toHaveLength(0);
    expect(ev).toContainEqual({ type: 'pickup', kind: 'bottle', weapon: null });
  });

  it('an empty gun can be grabbed, then thrown with RMB', () => {
    const w = withProp('gun');
    run(w, 1, () => input({ alt: true }));
    expect(w.player.weapon).toBe('pistol');
    expect(w.player.ammo).toBe(0);
    run(w, 60);
    const ev = run(w, 1, () => input({ alt: true }));
    expect(ev.some((e) => e.type === 'throw')).toBe(true);
    expect(w.player.weapon).toBeNull();
    expect(w.thrown).toHaveLength(1);
  });

  it('LMB throws a held bottle or chair', () => {
    const w = withProp('chair');
    run(w, 1, () => input({ alt: true }));
    run(w, 60);
    const ev = run(w, 1, () => input({ fire: true }));
    expect(ev.some((e) => e.type === 'throw' && e.kind === 'chair')).toBe(true);
    expect(w.player.item).toBeNull();
  });

  it('a thrown object stuns and disarms the enemy it hits', () => {
    const w = withProp('chair');
    const g = spawnEnemy(w, 'gunner', { x: 15, y: 0, z: 18 }, 0, 'pistol');
    g.stun = 30; // hold still so the throw's aim stays true
    run(w, 1, () => input({ alt: true }));
    run(w, 60);
    const aim = aimAt(w, { x: g.pos.x, y: 1.2, z: g.pos.z });
    const ev = run(w, 90, (i) => input({ ...aim, fire: i === 0 }));
    expect(ev.some((e) => e.type === 'impact' && e.target === 'enemy')).toBe(true);
    expect(ev.some((e) => e.type === 'disarm')).toBe(true);
    expect(g.weapon).toBeNull();
    expect(g.stun).toBeGreaterThan(0);
    // The gun it dropped is on the floor to be grabbed.
    expect(w.props.some((p) => p.kind === 'gun' && p.weapon === 'pistol')).toBe(true);
  });

  it('a thrown gun stuns but does not kill; a heavy stays alive', () => {
    const w = withProp('gun');
    const h = spawnEnemy(w, 'heavy', { x: 15, y: 0, z: 19 }, 0, null);
    h.stun = 0.9; // still for the throw; a hit must extend it past this
    run(w, 1, () => input({ alt: true }));
    run(w, 60);
    const aim = aimAt(w, { x: h.pos.x, y: 1.2, z: h.pos.z });
    run(w, 60, (i) => input({ ...aim, alt: i === 0 }));
    expect(w.enemies).toContain(h);
    expect(h.hp).toBe(2);
    expect(h.stun).toBeGreaterThan(0.2);
  });

  it('bottles shatter on impact; chairs bounce and settle into props', () => {
    const b = withProp('bottle');
    run(b, 1, () => input({ alt: true }));
    run(b, 60);
    const ev = run(b, 600, (i) => input({ fire: i === 0 }));
    expect(ev.some((e) => e.type === 'impact' && e.broke)).toBe(true);
    expect(b.thrown).toHaveLength(0);
    expect(b.props).toHaveLength(0);

    const c = withProp('chair');
    run(c, 1, () => input({ alt: true }));
    run(c, 60);
    run(c, 600, (i) => input({ fire: i === 0 }));
    expect(c.thrown).toHaveLength(0);
    expect(c.props).toHaveLength(1);
    const p = c.props[0]!;
    expect(p.pos.x).toBeGreaterThanOrEqual(0);
    expect(p.pos.z).toBeGreaterThanOrEqual(0);
    expect(p.pos.z).toBeLessThan(24);
  });

  it('thrown objects never leave the room', () => {
    for (const pitch of [-0.4, 0, 0.3, 0.8]) {
      for (const yaw of [0, 1, 2.5, -2]) {
        const w = withProp('chair');
        run(w, 1, () => input({ alt: true }));
        run(w, 60);
        run(w, 900, (i) => input({ yaw, pitch, fire: i === 0 }));
        const settled = [...w.props, ...w.thrown];
        expect(settled).toHaveLength(1);
        const p = settled[0]!.pos;
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(30);
        expect(p.z).toBeGreaterThanOrEqual(0);
        expect(p.z).toBeLessThanOrEqual(30);
      }
    }
  });

  it('is deterministic', () => {
    const script = (i: number) => input({ yaw: 0.3, pitch: 0.2, alt: i === 0 || i === 70, fire: i === 140 });
    const a = withProp('chair');
    const b = withProp('chair');
    run(a, 400, script);
    run(b, 400, script);
    expect(hashWorld(a)).toBe(hashWorld(b));
  });
});
