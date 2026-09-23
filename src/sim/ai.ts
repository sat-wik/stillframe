import { ENEMIES, WEAPONS } from '../content/defs';
import { nextFloat } from '../rng/rng';
import { lineOfSight, resolveCapsule } from './collision';
import { distXZ, yawTowards, type Vec3 } from './vec';
import { fireWeapon, muzzleFrom } from './weapons';
import { STEP_DT, type Enemy, type SimEvent, type WorldState } from './types';

// Small finite state machines per enemy type, ticked in game time so they slow
// with the world (spec section 5.4). A disarmed enemy fights like a grunt.

const LOS_INTERVAL = 0.1;
const MELEE_REACH = 1.5;
const SIGHT_RANGE = 40;

export function enemyEye(e: Enemy): Vec3 {
  return { x: e.pos.x, y: e.pos.y + ENEMIES[e.kind].height * 0.85, z: e.pos.z };
}

export function playerChest(w: WorldState): Vec3 {
  return { x: w.player.pos.x, y: w.player.pos.y + 1.2, z: w.player.pos.z };
}

export function tickEnemy(w: WorldState, e: Enemy, events: SimEvent[]): void {
  const def = ENEMIES[e.kind];
  const dt = STEP_DT;
  const ai = e.ai;
  e.cooldown = Math.max(0, e.cooldown - dt);
  if (e.stun > 0) {
    e.stun = Math.max(0, e.stun - dt);
    return;
  }

  const target = playerChest(w);
  const dist = distXZ(e.pos, w.player.pos);
  ai.losTimer -= dt;
  if (ai.losTimer <= 0) {
    ai.losTimer += LOS_INTERVAL;
    ai.hasLos = dist <= SIGHT_RANGE && lineOfSight(enemyEye(e), target, w.level.boxes, w.level.cylinders);
  }

  const ranged = e.weapon !== null;
  const reach = MELEE_REACH + def.radius * 0.5;
  const facePlayer = () => {
    e.yaw = yawTowards(e.pos, w.player.pos);
  };

  switch (ai.state) {
    case 'idle':
      if (ai.hasLos) ai.state = 'approach';
      break;

    case 'approach': {
      if (ai.hasLos) facePlayer();
      if (ranged) {
        if (ai.hasLos && dist <= def.maxRange && e.cooldown <= 0) {
          enter(e, 'aim', def.aimTime);
          break;
        }
        if (!ai.hasLos || dist > def.maxRange) moveTowards(w, e, w.player.pos, def.speed);
        else if (dist < def.minRange) moveTowards(w, e, w.player.pos, -def.speed);
        else strafe(w, e, def.speed * 0.6);
      } else {
        if (dist <= reach && e.cooldown <= 0) {
          enter(e, 'aim', def.aimTime);
          break;
        }
        moveTowards(w, e, w.player.pos, def.speed);
      }
      break;
    }

    case 'aim':
      // The telegraph: the enemy stops and tracks the player before committing.
      facePlayer();
      if (ranged ? !ai.hasLos : dist > reach + 0.5) {
        ai.state = 'approach';
        break;
      }
      ai.timer -= dt;
      if (ai.timer <= 0) {
        ai.state = 'fire';
        fire(w, e, dist, reach, events);
      }
      break;

    case 'fire':
      // The shot itself happens on the transition out of aim; this state lasts
      // one step so the diagram, the debug overlay and the tests all see it.
      enter(e, 'reposition', ranged ? Math.max(0.2, def.fireInterval - def.aimTime) : 0.5);
      break;

    case 'reposition':
      ai.timer -= dt;
      if (ranged && e.kind === 'gunner') strafe(w, e, def.speed * 0.8);
      else if (ranged) moveTowards(w, e, w.player.pos, def.speed * 0.5);
      if (ai.timer <= 0) {
        if (ranged && ai.hasLos && dist <= def.maxRange && e.cooldown <= 0) enter(e, 'aim', def.aimTime);
        else ai.state = 'approach';
      }
      break;
  }
}

function enter(e: Enemy, state: Enemy['ai']['state'], timer: number): void {
  e.ai.state = state;
  e.ai.timer = timer;
}

function fire(w: WorldState, e: Enemy, dist: number, reach: number, events: SimEvent[]): void {
  const def = ENEMIES[e.kind];
  if (e.weapon) {
    const eye = enemyEye(e);
    const target = playerChest(w);
    // Aim at the player's current position; no predictive leading in v1.
    const yaw = yawTowards(eye, target);
    const pitch = Math.atan2(target.y - eye.y, Math.max(1e-6, Math.hypot(target.x - eye.x, target.z - eye.z)));
    fireWeapon(w, e.weapon, 'enemy', e.id, muzzleFrom(eye, yaw, pitch, def.radius + 0.1), yaw, pitch, def.spreadDeg, events);
    // Cooldown covers the gap before the next telegraph, so shot-to-shot time
    // is fireInterval including the aim.
    e.cooldown = Math.max(def.fireInterval - def.aimTime, WEAPONS[e.weapon].cooldown);
  } else {
    const hit = dist <= reach + 0.3 && w.player.alive;
    events.push({ type: 'punch', hit, pos: { ...e.pos } });
    if (hit) {
      w.player.alive = false;
      w.killedBy = { kind: 'punch', shooter: e.id };
      events.push({ type: 'hit', target: 'player', pos: { ...w.player.pos } });
    }
    e.cooldown = def.fireInterval;
  }
  e.ai.strafeDir = nextFloat(w.rng.ai) < 0.5 ? -1 : 1;
}

function moveTowards(w: WorldState, e: Enemy, goal: Vec3, speed: number): void {
  const dx = goal.x - e.pos.x;
  const dz = goal.z - e.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return;
  step(w, e, (dx / d) * speed, (dz / d) * speed);
}

function strafe(w: WorldState, e: Enemy, speed: number): void {
  const dx = w.player.pos.x - e.pos.x;
  const dz = w.player.pos.z - e.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return;
  const before = { x: e.pos.x, z: e.pos.z };
  step(w, e, (-dz / d) * speed * e.ai.strafeDir, (dx / d) * speed * e.ai.strafeDir);
  // Blocked by a wall: flip direction next time.
  const moved = Math.hypot(e.pos.x - before.x, e.pos.z - before.z);
  if (moved < speed * STEP_DT * 0.25) e.ai.strafeDir = -e.ai.strafeDir;
}

function step(w: WorldState, e: Enemy, vx: number, vz: number): void {
  const def = ENEMIES[e.kind];
  e.pos.x += vx * STEP_DT;
  e.pos.z += vz * STEP_DT;
  resolveCapsule(e.pos, def.radius, def.height, w.level.boxes, w.level.cylinders, w.level.def.bounds);
}
