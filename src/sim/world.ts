import { ENEMIES, WEAPONS, type EnemyKind, type WeaponId } from '../content/defs';
import type { LevelDef } from '../content/level';
import { createSimStreams, hashString, nextFloat } from '../rng/rng';
import { clone } from './vec';
import type { Box, Cylinder, Enemy, PendingEnemy, SimEvent, WorldState } from './types';

/** The default run seed for a level, so an instant restart replays the same spawn state. */
export function levelSeed(level: LevelDef): number {
  return hashString(`${level.id}@${level.version}`);
}

export function createWorld(level: LevelDef, seed = levelSeed(level)): WorldState {
  const boxes: Box[] = [];
  const cylinders: Cylinder[] = [];
  for (const g of level.geometry) {
    if (g.kind === 'box') {
      if (g.solid) boxes.push({ min: clone(g.min), max: clone(g.max) });
    } else {
      cylinders.push({ center: clone(g.center), r: g.r, h: g.h });
    }
  }
  const pending: PendingEnemy[] = level.enemies.map((e) => ({ kind: e.kind, pos: clone(e.pos), yaw: e.yaw, weapon: e.weapon, wave: e.wave }));
  const spawn = clone(level.playerSpawn.pos);

  const w: WorldState = {
    step: 0,
    gameTime: 0,
    seed,
    player: {
      pos: spawn,
      prevPos: clone(spawn),
      yaw: level.playerSpawn.yaw,
      pitch: 0,
      alive: true,
      weapon: level.playerWeapon,
      ammo: level.playerWeapon ? WEAPONS[level.playerWeapon].ammo : 0,
      item: null,
      cooldown: 0,
      punchCooldown: 0,
    },
    enemies: [],
    bullets: [],
    props: [],
    thrown: [],
    level: { def: level, boxes, cylinders, pending, firedWaves: [] },
    kills: 0,
    nextId: 1,
    rng: createSimStreams(seed),
    outcome: 'playing',
    killedBy: null,
  };
  for (const p of level.props) {
    w.props.push({ id: w.nextId++, kind: p.kind, pos: clone(p.pos), weapon: p.weapon ?? null, ammo: p.weapon ? WEAPONS[p.weapon].ammo : 0 });
  }
  updateWaves(w, []);
  return w;
}

export function spawnEnemy(w: WorldState, kind: EnemyKind, pos: { x: number; y: number; z: number }, yaw: number, weapon: WeaponId | null): Enemy {
  const e: Enemy = {
    id: w.nextId++,
    kind,
    pos: clone(pos),
    prevPos: clone(pos),
    yaw,
    hp: ENEMIES[kind].hp,
    weapon,
    // Stagger first shots so a room of gunners doesn't fire in unison.
    cooldown: nextFloat(w.rng.ai) * 0.6,
    stun: 0,
    ai: { state: 'idle', timer: 0, losTimer: nextFloat(w.rng.ai) * 0.1, hasLos: false, strafeDir: nextFloat(w.rng.ai) < 0.5 ? -1 : 1 },
  };
  w.enemies.push(e);
  return e;
}

/** Fires any wave whose trigger is satisfied and spawns its enemies. */
export function updateWaves(w: WorldState, events: SimEvent[]): void {
  const p = w.player.pos;
  for (const wave of w.level.def.waves) {
    if (w.level.firedWaves.includes(wave.id)) continue;
    const t = wave.trigger;
    const fire =
      t.kind === 'start' ||
      (t.kind === 'killed' && w.kills >= t.count) ||
      (t.kind === 'zone' && p.x >= t.min.x && p.x <= t.max.x && p.y >= t.min.y && p.y <= t.max.y && p.z >= t.min.z && p.z <= t.max.z);
    if (!fire) continue;
    w.level.firedWaves.push(wave.id);
    const rest: PendingEnemy[] = [];
    for (const pe of w.level.pending) {
      if (pe.wave === wave.id) spawnEnemy(w, pe.kind, pe.pos, pe.yaw, pe.weapon);
      else rest.push(pe);
    }
    w.level.pending = rest;
    events.push({ type: 'wave', id: wave.id });
  }
}

/** Deep copy for keyframes and restarts. The level def is shared (it is immutable). */
export function cloneWorld(w: WorldState): WorldState {
  const def = w.level.def;
  const copy = structuredClone({ ...w, level: { ...w.level, def: null } }) as unknown as WorldState;
  copy.level.def = def;
  return copy;
}
