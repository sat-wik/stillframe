import { ENEMIES, THROW, WEAPONS } from '../content/defs';
import { segmentCapsule } from './collision';
import { clone, dirFromYawPitch, lerp } from './vec';
import { STEP_DT, type Box, type Cylinder, type Enemy, type PropKind, type SimEvent, type Thrown, type Vec3, type WorldState } from './types';

// Thrown objects: a ballistic arc with axis-separated bounces off boxes,
// cylinders, the floor and the level bounds. No rotation physics; the spin is
// visual only (spec section 5.2).

export function throwItem(w: WorldState, kind: PropKind, weapon: Thrown['weapon'], ammo: number, from: Vec3, yaw: number, pitch: number, events: SimEvent[]): void {
  const dir = dirFromYawPitch(yaw, pitch + THROW.loft);
  const pos = { x: from.x + dir.x * 0.4, y: from.y + dir.y * 0.4 - 0.1, z: from.z + dir.z * 0.4 };
  w.thrown.push({
    id: w.nextId++,
    kind,
    weapon,
    ammo,
    pos,
    prevPos: clone(pos),
    vel: { x: dir.x * THROW.speed, y: dir.y * THROW.speed, z: dir.z * THROW.speed },
    age: 0,
    spent: false,
  });
  events.push({ type: 'throw', kind, pos: clone(pos) });
}

function inSolid(p: Vec3, r: number, boxes: readonly Box[], cylinders: readonly Cylinder[]): boolean {
  for (const b of boxes) {
    if (p.x > b.min.x - r && p.x < b.max.x + r && p.y > b.min.y - r && p.y < b.max.y + r && p.z > b.min.z - r && p.z < b.max.z + r) return true;
  }
  for (const c of cylinders) {
    if (p.y < c.center.y - r || p.y > c.center.y + c.h + r) continue;
    if ((p.x - c.center.x) ** 2 + (p.z - c.center.z) ** 2 < (c.r + r) ** 2) return true;
  }
  return false;
}

/** Stuns and disarms an enemy hit by a thrown object. */
function strike(w: WorldState, t: Thrown, e: Enemy, at: Vec3, events: SimEvent[], dropWeapon: (e: Enemy) => void): void {
  t.spent = true;
  e.stun = Math.max(e.stun, THROW.stun);
  e.ai.state = 'approach';
  if (e.weapon) {
    dropWeapon(e);
    events.push({ type: 'disarm', id: e.id, pos: clone(e.pos) });
  }
  // Knock the object back off the target.
  t.vel.x *= -0.25;
  t.vel.z *= -0.25;
  t.vel.y = Math.max(t.vel.y, 1);
  events.push({ type: 'impact', kind: t.kind, target: 'enemy', broke: t.kind === 'bottle', pos: at });
}

export function updateThrown(w: WorldState, events: SimEvent[], dropWeapon: (e: Enemy) => void): void {
  if (w.thrown.length === 0) return;
  const { boxes, cylinders, def } = w.level;
  const r = THROW.radius;
  const settled: Thrown[] = [];
  const broken = new Set<number>();

  for (const t of w.thrown) {
    t.prevPos = clone(t.pos);
    t.age += STEP_DT;
    t.vel.y -= THROW.gravity * STEP_DT;

    // Enemies first, along the whole step, so fast throws can't pass through.
    if (!t.spent) {
      const next = { x: t.pos.x + t.vel.x * STEP_DT, y: t.pos.y + t.vel.y * STEP_DT, z: t.pos.z + t.vel.z * STEP_DT };
      let best: { e: Enemy; tt: number } | null = null;
      for (const e of w.enemies) {
        const ed = ENEMIES[e.kind];
        const tt = segmentCapsule(t.pos, next, e.pos, ed.radius + r, ed.height);
        if (tt !== null && (!best || tt < best.tt)) best = { e, tt };
      }
      if (best) {
        const at = lerp(t.pos, next, best.tt);
        strike(w, t, best.e, at, events, dropWeapon);
        if (t.kind === 'bottle') {
          broken.add(t.id);
          continue;
        }
      }
    }

    // Move one axis at a time; an axis that lands inside geometry bounces.
    let hitWall = false;
    for (const axis of ['x', 'y', 'z'] as const) {
      const before = t.pos[axis];
      t.pos[axis] += t.vel[axis] * STEP_DT;
      const outOfBounds =
        (axis === 'x' && (t.pos.x < r || t.pos.x > def.bounds.w - r)) ||
        (axis === 'z' && (t.pos.z < r || t.pos.z > def.bounds.d - r)) ||
        (axis === 'y' && t.pos.y < r);
      if (outOfBounds || inSolid(t.pos, r, boxes, cylinders)) {
        t.pos[axis] = axis === 'y' && t.pos.y < r ? r : before;
        const impactSpeed = Math.abs(t.vel[axis]);
        t.vel[axis] = -t.vel[axis] * THROW.restitution;
        if (axis === 'y') {
          t.vel.x *= THROW.floorFriction;
          t.vel.z *= THROW.floorFriction;
        }
        if (impactSpeed > 2) hitWall = true;
      }
    }
    if (hitWall) {
      const broke = t.kind === 'bottle';
      events.push({ type: 'impact', kind: t.kind, target: 'wall', broke, pos: clone(t.pos) });
      if (broke) {
        broken.add(t.id);
        continue;
      }
    }

    const onFloor = t.pos.y <= r + 1e-6;
    const slow = Math.hypot(t.vel.x, t.vel.y, t.vel.z) < THROW.restSpeed;
    if ((onFloor && slow) || t.age >= THROW.maxFlight) settled.push(t);
  }

  if (broken.size || settled.length) {
    const done = new Set([...broken, ...settled.map((t) => t.id)]);
    w.thrown = w.thrown.filter((t) => !done.has(t.id));
    for (const t of settled) {
      w.props.push({ id: t.id, kind: t.kind, pos: { x: t.pos.x, y: 0, z: t.pos.z }, weapon: t.weapon, ammo: t.weapon ? Math.min(t.ammo, WEAPONS[t.weapon].ammo) : 0 });
    }
  }
}
