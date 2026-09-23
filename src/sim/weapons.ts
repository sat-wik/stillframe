import { WEAPONS, type WeaponId } from '../content/defs';
import { nextFloat, nextGaussian } from '../rng/rng';
import { add, clone, dirFromYawPitch, scale, type Vec3 } from './vec';
import type { SimEvent, WorldState } from './types';

const DEG = Math.PI / 180;

/**
 * Spawns the bullets for one trigger pull. Player pellets spread uniformly in
 * the weapon's cone; enemy shots add a gaussian aim error of `spreadDeg`.
 * All randomness comes from the `spread` stream.
 */
export function fireWeapon(
  w: WorldState,
  weapon: WeaponId,
  owner: 'player' | 'enemy',
  shooter: number,
  muzzle: Vec3,
  yaw: number,
  pitch: number,
  spreadDeg: number,
  events: SimEvent[],
): void {
  const def = WEAPONS[weapon];
  const halfCone = (def.coneDeg / 2) * DEG;
  for (let i = 0; i < def.pellets; i++) {
    let dy = 0;
    let dp = 0;
    if (def.pellets > 1) {
      // Uniform point in a disk, mapped to yaw/pitch offsets.
      const r = Math.sqrt(nextFloat(w.rng.spread)) * halfCone;
      const a = nextFloat(w.rng.spread) * Math.PI * 2;
      dy = Math.cos(a) * r;
      dp = Math.sin(a) * r;
    }
    if (spreadDeg > 0) {
      dy += nextGaussian(w.rng.spread) * spreadDeg * DEG;
      dp += nextGaussian(w.rng.spread) * spreadDeg * DEG;
    }
    const dir = dirFromYawPitch(yaw + dy, pitch + dp);
    w.bullets.push({
      id: w.nextId++,
      owner,
      shooter,
      pos: clone(muzzle),
      prevPos: clone(muzzle),
      origin: clone(muzzle),
      vel: scale(dir, def.bulletSpeed),
      ttl: def.bulletTtl,
    });
  }
  events.push({ type: 'shot', owner, weapon, pos: clone(muzzle) });
}

export function muzzleFrom(eye: Vec3, yaw: number, pitch: number, forward = 0.45): Vec3 {
  return add(eye, scale(dirFromYawPitch(yaw, pitch), forward));
}
