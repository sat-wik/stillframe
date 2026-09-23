import { BULLET_CLASH_RADIUS, ENEMIES, PLAYER, THROW, WEAPONS } from '../content/defs';
import { tickEnemy } from './ai';
import { movingPointsClosest, resolveCapsule, segmentCapsule, segmentVsLevel, separateCircles } from './collision';
import { add, clone, copyInto, lerp, scale } from './vec';
import { throwItem, updateThrown } from './throw';
import { fireWeapon, muzzleFrom } from './weapons';
import { updateWaves } from './world';
import { STEP_DT, type Enemy, type SimEvent, type StepInput, type WorldState } from './types';

const MAX_PITCH = 1.45;
/** Cosine of the half-angle in front of the player that a punch or grab reaches. */
const REACH_CONE = 0.5;

/**
 * Advances the world by exactly one fixed step (1/120 s of game time).
 * Pure apart from mutating `w`: no DOM, no wall clock, no Math.random.
 */
export function step(w: WorldState, input: StepInput): SimEvent[] {
  const events: SimEvent[] = [];
  if (w.outcome !== 'playing') return events;

  w.step++;
  w.gameTime = w.step * STEP_DT;

  updatePlayer(w, input, events);
  updateWaves(w, events);
  for (const e of w.enemies) copyInto(e.prevPos, e.pos);
  for (const e of w.enemies) tickEnemy(w, e, events);
  separateCharacters(w);
  updateThrown(w, events, (e) => dropWeapon(w, e));
  updateBullets(w, events);
  updateOutcome(w, events);
  return events;
}

export function playerEye(w: WorldState) {
  return { x: w.player.pos.x, y: w.player.pos.y + PLAYER.eyeHeight, z: w.player.pos.z };
}

function updatePlayer(w: WorldState, input: StepInput, events: SimEvent[]): void {
  const p = w.player;
  copyInto(p.prevPos, p.pos);
  if (!p.alive) return;

  p.yaw = input.yaw;
  p.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, input.pitch));
  p.cooldown = Math.max(0, p.cooldown - STEP_DT);
  p.punchCooldown = Math.max(0, p.punchCooldown - STEP_DT);

  let mx = input.moveX;
  let my = input.moveY;
  const m = Math.hypot(mx, my);
  if (m > 1) {
    mx /= m;
    my /= m;
  }
  const sin = Math.sin(p.yaw);
  const cos = Math.cos(p.yaw);
  // forward = (-sin, -cos), right = (cos, -sin) on the XZ plane
  p.pos.x += (-sin * my + cos * mx) * PLAYER.speed * STEP_DT;
  p.pos.z += (-cos * my - sin * mx) * PLAYER.speed * STEP_DT;
  resolveCapsule(p.pos, PLAYER.radius, PLAYER.height, w.level.boxes, w.level.cylinders, w.level.def.bounds);

  // LMB fires a loaded gun, or throws a bottle or chair.
  if (input.fire) {
    if (p.weapon && p.ammo > 0 && p.cooldown <= 0) {
      const eye = playerEye(w);
      fireWeapon(w, p.weapon, 'player', 0, muzzleFrom(eye, p.yaw, p.pitch, 0.4), p.yaw, p.pitch, 0, events);
      p.ammo--;
      p.cooldown = WEAPONS[p.weapon].cooldown;
    } else if (p.item && p.punchCooldown <= 0) {
      throwHeld(w, events);
    }
  }

  // RMB throws whatever is in hand; empty-handed it grabs, or else punches.
  if (input.alt && p.punchCooldown <= 0) {
    if (p.weapon || p.item) throwHeld(w, events);
    else if (!tryGrab(w, events)) punch(w, events);
  }
}

function throwHeld(w: WorldState, events: SimEvent[]): void {
  const p = w.player;
  const eye = playerEye(w);
  if (p.weapon) throwItem(w, 'gun', p.weapon, p.ammo, eye, p.yaw, p.pitch, events);
  else if (p.item) throwItem(w, p.item, null, 0, eye, p.yaw, p.pitch, events);
  p.weapon = null;
  p.item = null;
  p.ammo = 0;
  p.punchCooldown = THROW.cooldown;
}

/** The nearest thing within reach and in front of the player, if any. */
function inReach<T extends { pos: { x: number; z: number } }>(w: WorldState, items: readonly T[], reach: number): T | null {
  const p = w.player;
  const fx = -Math.sin(p.yaw);
  const fz = -Math.cos(p.yaw);
  let best: T | null = null;
  let bestD = Infinity;
  for (const it of items) {
    const dx = it.pos.x - p.pos.x;
    const dz = it.pos.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > reach || d >= bestD) continue;
    if (d > 0.3 && (dx * fx + dz * fz) / d < REACH_CONE) continue;
    best = it;
    bestD = d;
  }
  return best;
}

/** Picks up the nearest prop in reach: a gun (even empty, to throw) or a throwable. */
function tryGrab(w: WorldState, events: SimEvent[]): boolean {
  const prop = inReach(w, w.props, PLAYER.punchRange);
  if (!prop) return false;
  const p = w.player;
  if (prop.kind === 'gun' && prop.weapon) {
    p.weapon = prop.weapon;
    p.ammo = prop.ammo;
  } else if (prop.kind !== 'gun') {
    p.item = prop.kind;
  } else return false;
  w.props = w.props.filter((pr) => pr !== prop);
  p.punchCooldown = PLAYER.punchCooldown;
  events.push({ type: 'pickup', kind: prop.kind, weapon: prop.weapon });
  return true;
}

function punch(w: WorldState, events: SimEvent[]): void {
  const p = w.player;
  p.punchCooldown = PLAYER.punchCooldown;
  const target = inReach(w, w.enemies, PLAYER.punchRange + 0.4);
  events.push({ type: 'punch', by: 'player', hit: target !== null, pos: clone(p.pos) });
  if (!target) return;
  if (target.weapon) {
    // Punching an armed enemy disarms them; the gun drops where they stand.
    dropWeapon(w, target);
    events.push({ type: 'disarm', id: target.id, pos: clone(target.pos) });
    target.stun = 0.5;
    target.ai.state = 'approach';
  } else {
    damageEnemy(w, target, events);
  }
}

function dropWeapon(w: WorldState, e: Enemy): void {
  if (!e.weapon) return;
  w.props.push({ id: w.nextId++, kind: 'gun', pos: { x: e.pos.x, y: 0, z: e.pos.z }, weapon: e.weapon, ammo: WEAPONS[e.weapon].ammo });
  e.weapon = null;
}

function damageEnemy(w: WorldState, e: Enemy, events: SimEvent[]): void {
  e.hp--;
  events.push({ type: 'hit', target: 'enemy', pos: clone(e.pos) });
  if (e.hp > 0) return;
  dropWeapon(w, e);
  w.enemies = w.enemies.filter((x) => x !== e);
  w.kills++;
  events.push({ type: 'enemyDeath', id: e.id, kind: e.kind, pos: clone(e.pos) });
}

function separateCharacters(w: WorldState): void {
  const p = w.player;
  for (let i = 0; i < w.enemies.length; i++) {
    const a = w.enemies[i]!;
    const ra = ENEMIES[a.kind].radius;
    for (let j = i + 1; j < w.enemies.length; j++) {
      const b = w.enemies[j]!;
      separateCircles(a.pos, ra, b.pos, ENEMIES[b.kind].radius);
    }
    if (p.alive) separateCircles(p.pos, PLAYER.radius, a.pos, ra, 0.3);
  }
  for (const e of w.enemies) {
    const def = ENEMIES[e.kind];
    resolveCapsule(e.pos, def.radius, def.height, w.level.boxes, w.level.cylinders, w.level.def.bounds);
  }
  resolveCapsule(p.pos, PLAYER.radius, PLAYER.height, w.level.boxes, w.level.cylinders, w.level.def.bounds);
}

function updateBullets(w: WorldState, events: SimEvent[]): void {
  const { boxes, cylinders, def } = w.level;
  const dead = new Set<number>();

  for (const b of w.bullets) {
    copyInto(b.prevPos, b.pos);
    b.pos = add(b.pos, scale(b.vel, STEP_DT));
    b.ttl -= STEP_DT;
  }

  // Player bullets destroy enemy bullets on contact.
  for (const a of w.bullets) {
    if (a.owner !== 'player') continue;
    for (const b of w.bullets) {
      if (b.owner !== 'enemy' || dead.has(b.id) || dead.has(a.id)) continue;
      const c = movingPointsClosest(a.prevPos, a.pos, b.prevPos, b.pos);
      if (c.dist > BULLET_CLASH_RADIUS) continue;
      dead.add(a.id);
      dead.add(b.id);
      events.push({ type: 'hit', target: 'bullet', pos: lerp(a.prevPos, a.pos, c.t) });
    }
  }

  for (const b of w.bullets) {
    if (dead.has(b.id)) continue;
    let tHit = segmentVsLevel(b.prevPos, b.pos, boxes, cylinders);
    let hitKind: 'wall' | 'enemy' | 'player' = 'wall';
    let hitEnemy: Enemy | null = null;

    // Floor plane.
    if (b.pos.y < 0 && b.prevPos.y >= 0) {
      const t = b.prevPos.y / (b.prevPos.y - b.pos.y);
      if (tHit === null || t < tHit) tHit = t;
    }

    if (b.owner === 'player') {
      for (const e of w.enemies) {
        const ed = ENEMIES[e.kind];
        const t = segmentCapsule(b.prevPos, b.pos, e.pos, ed.radius, ed.height);
        if (t !== null && (tHit === null || t < tHit)) {
          tHit = t;
          hitKind = 'enemy';
          hitEnemy = e;
        }
      }
    } else if (w.player.alive) {
      const t = segmentCapsule(b.prevPos, b.pos, w.player.pos, PLAYER.hitRadius, PLAYER.height);
      if (t !== null && (tHit === null || t < tHit)) {
        tHit = t;
        hitKind = 'player';
      }
    }

    if (tHit !== null) {
      dead.add(b.id);
      const at = lerp(b.prevPos, b.pos, tHit);
      if (hitKind === 'enemy' && hitEnemy) damageEnemy(w, hitEnemy, events);
      else if (hitKind === 'player') {
        w.player.alive = false;
        w.killedBy = { kind: 'bullet', origin: clone(b.origin), shooter: b.shooter };
        events.push({ type: 'hit', target: 'player', pos: at });
      } else events.push({ type: 'hit', target: 'wall', pos: at });
      continue;
    }

    const out = b.pos.x < -5 || b.pos.z < -5 || b.pos.x > def.bounds.w + 5 || b.pos.z > def.bounds.d + 5 || b.pos.y > def.bounds.h + 20;
    if (b.ttl <= 0 || out) dead.add(b.id);
  }

  if (dead.size) w.bullets = w.bullets.filter((b) => !dead.has(b.id));
}

function updateOutcome(w: WorldState, events: SimEvent[]): void {
  if (!w.player.alive) {
    w.outcome = 'lost';
  } else if (w.enemies.length === 0 && w.level.pending.length === 0) {
    w.outcome = 'won';
  } else return;
  events.push({ type: 'outcome', outcome: w.outcome });
}
